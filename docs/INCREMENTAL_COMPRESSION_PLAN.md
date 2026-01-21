# Incremental Delta Compression Implementation Plan

## Overview

This document outlines a multi-phase plan to implement incremental delta compression for the Memory System. Instead of re-compressing entire sessions each time, this feature will only compress NEW messages since the last compression, creating "parts" that can be independently versioned.

### The Problem

Currently, when creating compression versions, the ENTIRE session is re-compressed each time:

```
Session grows:     100 msgs -> 150 msgs -> 200 msgs

compressed_v1:     [====================] 100 msgs compressed
compressed_v2:     [==============================] 150 msgs (re-compresses first 100!)
compressed_v3:     [========================================] 200 msgs (re-compresses all!)
```

This is wasteful - we're re-compressing already compressed content, costing API tokens and time.

### The Solution

Only compress NEW messages since the last compression:

```
Session grows:     100 msgs -> 150 msgs -> 200 msgs

part1_v1:          [====================] msgs 1-100
part2_v1:                               [==========] msgs 101-150 (delta only!)
part3_v1:                                           [==========] msgs 151-200 (delta only!)
```

### Naming Convention

```
compressed_part{N}_v{M}.jsonl

Where:
- N = part number (1 = oldest, incrementing for newer message ranges)
- M = compression version/level (v1 = light, v2 = moderate, v3 = aggressive, etc.)

Examples:
- compressed_part1_v1.jsonl  (messages 1-100, light compression)
- compressed_part1_v2.jsonl  (messages 1-100, aggressive compression)
- compressed_part2_v1.jsonl  (messages 101-150, light compression)
```

---

## Current State Analysis

### Directory Structure (Existing)

```
~/.claude-memory/projects/{projectId}/
├── originals/           # Copies of original session files (linkedFile)
│   └── {sessionId}.jsonl
├── summaries/           # Compression versions directory
│   └── {sessionId}/
│       ├── v001_tiered-standard_10k.md
│       ├── v001_tiered-standard_10k.jsonl
│       └── ...
├── composed/            # Combined context files
│   └── {compositionName}/
└── manifest.json        # Project manifest with session metadata
```

### Key Files to Modify

| File | Purpose | Changes Needed |
|------|---------|----------------|
| `backend/src/services/memory-versions.js` | Version creation, naming, storage | Major - add part tracking, delta detection |
| `backend/src/services/memory-manifest.js` | Manifest schema, session tracking | Moderate - extend compression record schema |
| `backend/src/services/memory-sync.js` | Sync tracking between original and copy | Minor - ensure delta range detection works |
| `backend/src/services/memory-session.js` | Session registration | Minor - track linkedFile properly |
| `backend/src/services/composition-engine.js` | Multi-session composition | Major - combine parts intelligently |
| `frontend/src/components/memory/CreateCompressionDialog.vue` | Compression UI | Major - add part/delta options |
| `frontend/src/components/memory/SessionDetails.vue` | Session details UI | Moderate - show parts separately |

### Critical Bug to Fix

**Issue**: `createCompressionVersion()` currently uses `session.originalFile` (Claude's file at `~/.claude/projects/...`) instead of `session.linkedFile` (memory copy at `~/.claude-memory/.../originals/`).

**Why it matters**: The memory copy (`linkedFile`) is kept in sync and should always have the complete message history. Using `originalFile` may read stale data or fail if the original was moved/deleted.

**Location**: `backend/src/services/memory-versions.js` line 358:
```javascript
// CURRENT (Bug)
parsed = await parseJsonlFile(session.originalFile);

// SHOULD BE
parsed = await parseJsonlFile(session.linkedFile);
```

---

## Phase 1: Foundation - Schema and Bug Fixes

**Goal**: Update data structures and fix the linkedFile bug without changing behavior.

### Task 1.1: Fix originalFile/linkedFile Bug

**File**: `/home/dac/github/cc_context_eng/backend/src/services/memory-versions.js`

**Changes**:
```javascript
// Line ~358 in createCompressionVersion()
// BEFORE:
parsed = await parseJsonlFile(session.originalFile);

// AFTER:
// Use linkedFile (memory copy) which is kept in sync
const sourceFile = session.linkedFile || session.originalFile;
if (!await fs.pathExists(sourceFile)) {
  const error = new Error(`Session file not found: ${sourceFile}`);
  error.code = 'SESSION_FILE_NOT_FOUND';
  error.status = 404;
  throw error;
}
parsed = await parseJsonlFile(sourceFile);
```

**Acceptance Criteria**:
- [ ] Compression reads from `linkedFile` when available
- [ ] Falls back to `originalFile` for backwards compatibility
- [ ] Existing compressions still work
- [ ] Tests pass

### Task 1.2: Extend Compression Record Schema

**File**: `/home/dac/github/cc_context_eng/backend/src/services/memory-manifest.js`

**Add to `validateSessionEntry()` (around line 114)**:

```javascript
// Compression part tracking validation (new fields)
if (session.compressions && Array.isArray(session.compressions)) {
  for (const comp of session.compressions) {
    // New part-based fields (optional for backwards compatibility)
    if (comp.partNumber !== undefined) {
      if (typeof comp.partNumber !== 'number' || comp.partNumber < 1) {
        errors.push('compression.partNumber must be a positive number');
      }
    }
    if (comp.messageRange !== undefined) {
      if (typeof comp.messageRange !== 'object') {
        errors.push('compression.messageRange must be an object');
      } else {
        const range = comp.messageRange;
        if (range.startTimestamp && typeof range.startTimestamp !== 'string') {
          errors.push('compression.messageRange.startTimestamp must be an ISO string');
        }
        if (range.endTimestamp && typeof range.endTimestamp !== 'string') {
          errors.push('compression.messageRange.endTimestamp must be an ISO string');
        }
        if (range.startIndex !== undefined && typeof range.startIndex !== 'number') {
          errors.push('compression.messageRange.startIndex must be a number');
        }
        if (range.endIndex !== undefined && typeof range.endIndex !== 'number') {
          errors.push('compression.messageRange.endIndex must be a number');
        }
        if (range.messageCount !== undefined && typeof range.messageCount !== 'number') {
          errors.push('compression.messageRange.messageCount must be a number');
        }
      }
    }
  }
}
```

**New Compression Record Schema** (documentation):

```typescript
interface CompressionRecord {
  // Existing fields
  versionId: string;           // e.g., "v001" - unique within session
  file: string;                // Filename without extension
  createdAt: string;           // ISO timestamp
  settings: CompressionSettings;
  inputTokens: number;
  inputMessages: number;
  outputTokens: number;
  outputMessages: number;
  compressionRatio: number;
  processingTimeMs: number;
  keepitStats: object;
  fileSizes: { md: number, jsonl: number };
  tierResults: object | null;

  // NEW fields for incremental compression
  partNumber?: number;         // 1, 2, 3... (1 = oldest messages)
  compressionLevel?: number;   // 1 = light, 2 = moderate, 3 = aggressive
  messageRange?: {
    startTimestamp: string;    // ISO timestamp of first message in this part
    endTimestamp: string;      // ISO timestamp of last message in this part
    startIndex: number;        // 0-based index in full session
    endIndex: number;          // Exclusive end index
    messageCount: number;      // Number of messages in this part
  };
  isFullSession?: boolean;     // True for legacy compressions covering entire session
}
```

**Acceptance Criteria**:
- [ ] Schema validation passes for new fields
- [ ] Existing compressions without new fields still validate
- [ ] Manifest migration preserves existing data

### Task 1.3: Add Migration for Existing Compressions

**File**: `/home/dac/github/cc_context_eng/backend/src/services/memory-migration.js`

**Add migration** to mark existing compressions as `isFullSession: true`:

```javascript
// Add to migrations array
{
  version: '1.3.0',
  description: 'Mark existing compressions as full-session for incremental compression support',
  migrate: async (manifest) => {
    for (const session of Object.values(manifest.sessions || {})) {
      for (const compression of session.compressions || []) {
        if (compression.partNumber === undefined) {
          // Legacy compression - mark as covering full session
          compression.isFullSession = true;
          compression.partNumber = 1;
          compression.messageRange = {
            startIndex: 0,
            endIndex: session.originalMessages,
            messageCount: session.originalMessages,
            startTimestamp: session.firstTimestamp,
            endTimestamp: session.lastSyncedTimestamp || session.lastTimestamp
          };
        }
      }
    }
    return manifest;
  }
}
```

**Acceptance Criteria**:
- [ ] Migration runs on first load after upgrade
- [ ] Existing compressions gain `isFullSession: true`
- [ ] Existing compressions have populated `messageRange`

---

## Phase 2: Delta Detection and Part Creation

**Goal**: Implement core delta compression logic.

### Task 2.1: Create Delta Detection Service

**New File**: `/home/dac/github/cc_context_eng/backend/src/services/memory-delta.js`

```javascript
/**
 * Memory Delta Detection Service
 *
 * Handles detection of new messages that need compression
 * and management of compression parts.
 */

import { getSession } from './memory-manifest.js';

/**
 * Get the highest part number for a session's compressions
 *
 * @param {Object} session - Session object from manifest
 * @returns {number} Highest part number (0 if no parts exist)
 */
export function getHighestPartNumber(session) {
  if (!session.compressions || session.compressions.length === 0) {
    return 0;
  }

  return Math.max(
    ...session.compressions
      .filter(c => c.partNumber !== undefined)
      .map(c => c.partNumber),
    0
  );
}

/**
 * Get the latest compression part for a session
 * Returns the part with the highest part number
 *
 * @param {Object} session - Session object from manifest
 * @returns {Object|null} Latest compression part or null
 */
export function getLatestPart(session) {
  if (!session.compressions || session.compressions.length === 0) {
    return null;
  }

  const highestPartNumber = getHighestPartNumber(session);
  if (highestPartNumber === 0) return null;

  // Get all versions of the highest part number
  const latestParts = session.compressions.filter(
    c => c.partNumber === highestPartNumber
  );

  // Return the most recently created version of this part
  // CRITICAL: Use new Date() for proper comparison
  return latestParts.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  )[0];
}

/**
 * Detect messages that need to be compressed (delta)
 *
 * @param {Array} allMessages - All messages from the session (sorted by timestamp)
 * @param {Object} session - Session object from manifest
 * @returns {Object} Delta information
 */
export function detectDelta(allMessages, session) {
  const latestPart = getLatestPart(session);

  // If no existing parts, all messages are the delta
  if (!latestPart || !latestPart.messageRange) {
    return {
      hasDelta: allMessages.length > 0,
      deltaMessages: allMessages,
      startIndex: 0,
      endIndex: allMessages.length,
      startTimestamp: allMessages[0]?.timestamp || null,
      endTimestamp: allMessages[allMessages.length - 1]?.timestamp || null,
      isFirstPart: true,
      previousPartNumber: 0
    };
  }

  const lastEndTimestamp = latestPart.messageRange.endTimestamp;
  const lastEndIndex = latestPart.messageRange.endIndex;
  const lastEndDate = new Date(lastEndTimestamp);

  // Find messages AFTER the last compressed range
  // CRITICAL: Use new Date() for proper timestamp comparison
  const deltaMessages = allMessages.filter((msg, idx) => {
    // Use index if available and reliable
    if (idx >= lastEndIndex) return true;

    // Fall back to timestamp comparison
    if (msg.timestamp) {
      const msgDate = new Date(msg.timestamp);
      return msgDate > lastEndDate;
    }

    return false;
  });

  // Sort delta messages by timestamp (oldest first)
  deltaMessages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

  return {
    hasDelta: deltaMessages.length > 0,
    deltaMessages,
    startIndex: lastEndIndex,
    endIndex: lastEndIndex + deltaMessages.length,
    startTimestamp: deltaMessages[0]?.timestamp || null,
    endTimestamp: deltaMessages[deltaMessages.length - 1]?.timestamp || null,
    isFirstPart: false,
    previousPartNumber: latestPart.partNumber
  };
}

/**
 * Get all parts for a session, organized by part number
 *
 * @param {Object} session - Session object from manifest
 * @returns {Map<number, Array>} Map of part number to versions
 */
export function getPartsByNumber(session) {
  const parts = new Map();

  for (const compression of session.compressions || []) {
    const partNumber = compression.partNumber || 1;
    if (!parts.has(partNumber)) {
      parts.set(partNumber, []);
    }
    parts.get(partNumber).push(compression);
  }

  // Sort versions within each part by compression level
  for (const versions of parts.values()) {
    versions.sort((a, b) => (a.compressionLevel || 1) - (b.compressionLevel || 1));
  }

  return parts;
}

/**
 * Get all versions of a specific part
 *
 * @param {Object} session - Session object from manifest
 * @param {number} partNumber - Part number to get
 * @returns {Array} Array of compression versions for this part
 */
export function getPartVersions(session, partNumber) {
  return (session.compressions || []).filter(
    c => (c.partNumber || 1) === partNumber
  );
}

/**
 * Check if a part can be re-compressed at a different level
 *
 * @param {Object} session - Session object from manifest
 * @param {number} partNumber - Part number to check
 * @param {number} compressionLevel - Target compression level
 * @returns {boolean} True if this level doesn't exist yet
 */
export function canRecompressPart(session, partNumber, compressionLevel) {
  const existingVersions = getPartVersions(session, partNumber);
  return !existingVersions.some(v => v.compressionLevel === compressionLevel);
}

/**
 * Generate a new version ID for a part
 *
 * @param {Object} session - Session object from manifest
 * @param {number} partNumber - Part number
 * @returns {string} Version ID like "part1_v001"
 */
export function generatePartVersionId(session, partNumber) {
  const existingVersions = getPartVersions(session, partNumber);
  const nextVersion = existingVersions.length + 1;
  return `part${partNumber}_v${String(nextVersion).padStart(3, '0')}`;
}
```

**Acceptance Criteria**:
- [ ] `detectDelta()` correctly identifies new messages
- [ ] Handles case where no compressions exist (first part)
- [ ] Handles case where compressions exist (subsequent parts)
- [ ] Uses proper Date comparison (not ISO string subtraction)

### Task 2.2: Update Version Filename Generator

**File**: `/home/dac/github/cc_context_eng/backend/src/services/memory-versions.js`

**Modify `generateVersionFilename()`**:

```javascript
/**
 * Generate a version filename following the new part-based pattern
 * Format: part{N}_v{M}_{mode}-{preset}_{tokens}k
 * Example: part1_v001_tiered-standard_10k
 *
 * For legacy full-session compressions:
 * Format: v{id}_{mode}-{preset}_{tokens}k
 */
export function generateVersionFilename(versionId, settings, tokenCount, partNumber = null) {
  const mode = settings.mode || 'uniform';
  const preset = settings.tierPreset || settings.aggressiveness || 'custom';
  const tokens = Math.max(1, Math.round(tokenCount / 1000));

  if (partNumber !== null && partNumber > 0) {
    // New part-based format
    return `part${partNumber}_${versionId}_${mode}-${preset}_${tokens}k`;
  }

  // Legacy format for backwards compatibility
  return `${versionId}_${mode}-${preset}_${tokens}k`;
}
```

**Acceptance Criteria**:
- [ ] New filenames include part number
- [ ] Legacy compressions still work with old format
- [ ] Filenames are filesystem-safe

### Task 2.3: Create Delta Compression Function

**File**: `/home/dac/github/cc_context_eng/backend/src/services/memory-versions.js`

**Add new function `createDeltaCompression()`**:

```javascript
/**
 * Create a compression version for delta (new messages only)
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {Object} settings - Compression settings
 * @returns {Object} Compression record for the new part
 */
export async function createDeltaCompression(projectId, sessionId, settings) {
  // Validate settings (same as createCompressionVersion)
  const validation = validateCompressionSettings(settings);
  if (!validation.valid) {
    const error = new Error(`Invalid compression settings: ${validation.errors.join('; ')}`);
    error.code = 'INVALID_SETTINGS';
    error.status = 400;
    throw error;
  }

  // Acquire session lock
  let lock;
  try {
    lock = await acquireSessionLock(projectId, sessionId, OperationType.COMPRESSION);
  } catch (lockError) {
    if (lockError.code === 'COMPRESSION_IN_PROGRESS') {
      lockError.status = 409;
    }
    throw lockError;
  }

  try {
    // Load manifest and get session
    const manifest = await loadManifest(projectId);
    const session = manifest.sessions[sessionId];

    if (!session) {
      const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
      error.code = 'SESSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    // Ensure directory structure exists
    await ensureDirectoryStructure(projectId);

    // Use linkedFile (memory copy) instead of originalFile
    const sourceFile = session.linkedFile || session.originalFile;
    if (!await fs.pathExists(sourceFile)) {
      const error = new Error(`Session file not found: ${sourceFile}`);
      error.code = 'SESSION_FILE_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    // Parse the session file
    let parsed;
    try {
      parsed = await parseJsonlFile(sourceFile);
    } catch (parseError) {
      const error = new Error(`Failed to parse session file: ${parseError.message}`);
      error.code = 'SESSION_PARSE_ERROR';
      error.status = 400;
      throw error;
    }

    // Detect delta
    const delta = detectDelta(parsed.messages, session);

    if (!delta.hasDelta) {
      const error = new Error('No new messages to compress. Session is already fully compressed.');
      error.code = 'NO_DELTA';
      error.status = 400;
      throw error;
    }

    if (delta.deltaMessages.length < 2) {
      const error = new Error('Delta must have at least 2 messages to compress');
      error.code = 'INSUFFICIENT_MESSAGES';
      error.status = 400;
      throw error;
    }

    // Determine part number
    const partNumber = delta.previousPartNumber + 1;

    // Generate version ID for this part
    const versionId = generatePartVersionId(session, partNumber);

    // Get UUIDs for delta messages only
    const deltaUuids = delta.deltaMessages.map(m => m.uuid);

    // Create a modified parsed object with only delta messages
    const deltaParsed = {
      ...parsed,
      messages: delta.deltaMessages,
      totalMessages: delta.deltaMessages.length
    };

    // Call summarizer with delta messages only
    let result;
    const startTime = Date.now();

    try {
      if (settings.mode === 'tiered') {
        result = await summarizeAndIntegrateWithTiers(deltaParsed, deltaUuids, {
          tiers: settings.customTiers || undefined,
          tierPreset: settings.tierPreset || 'standard',
          model: settings.model || 'opus',
          removeNonConversation: true,
          skipFirstMessages: settings.skipFirstMessages || 0
        });
      } else {
        result = await summarizeAndIntegrate(deltaParsed, deltaUuids, {
          compactionRatio: settings.compactionRatio || 10,
          aggressiveness: settings.aggressiveness || 'moderate',
          model: settings.model || 'opus',
          removeNonConversation: true,
          skipFirstMessages: settings.skipFirstMessages || 0
        });
      }
    } catch (summarizeError) {
      const error = new Error(`Compression failed: ${summarizeError.message}`);
      error.code = 'COMPRESSION_FAILED';
      error.status = 500;
      throw error;
    }

    const processingTime = Date.now() - startTime;

    // Calculate output stats
    const outputTokens = countOutputTokens(result.messages);
    const outputMessages = result.messages.length;
    const inputTokens = calculateDeltaTokens(delta.deltaMessages);
    const compressionRatio = outputTokens > 0 ? inputTokens / outputTokens : 1;

    // Generate filename and save files
    const filename = generateVersionFilename(versionId, settings, outputTokens, partNumber);
    const savedFiles = await saveVersionFiles(projectId, sessionId, filename, result);

    // Determine compression level from settings
    const compressionLevel = determineCompressionLevel(settings);

    // Create compression record with new fields
    const compressionRecord = {
      versionId,
      file: filename,
      createdAt: new Date().toISOString(),
      settings: {
        mode: settings.mode,
        ...(settings.mode === 'uniform' ? {
          compactionRatio: settings.compactionRatio || 10,
          aggressiveness: settings.aggressiveness || 'moderate'
        } : {
          tierPreset: settings.tierPreset || 'standard',
          customTiers: settings.customTiers || null
        }),
        model: settings.model || 'opus',
        skipFirstMessages: settings.skipFirstMessages || 0,
        keepitMode: settings.keepitMode || 'ignore',
        sessionDistance: settings.sessionDistance || null
      },
      inputTokens,
      inputMessages: delta.deltaMessages.length,
      outputTokens,
      outputMessages,
      compressionRatio: Number(compressionRatio.toFixed(2)),
      processingTimeMs: processingTime,
      keepitStats: {
        preserved: 0,
        summarized: 0,
        weights: {}
      },
      fileSizes: {
        md: savedFiles.mdSize,
        jsonl: savedFiles.jsonlSize
      },
      tierResults: result.tierResults || null,

      // NEW incremental compression fields
      partNumber,
      compressionLevel,
      isFullSession: false,
      messageRange: {
        startTimestamp: delta.startTimestamp,
        endTimestamp: delta.endTimestamp,
        startIndex: delta.startIndex,
        endIndex: delta.endIndex,
        messageCount: delta.deltaMessages.length
      }
    };

    // Update manifest with new compression
    session.compressions = session.compressions || [];
    session.compressions.push(compressionRecord);
    session.lastAccessed = new Date().toISOString();
    manifest.sessions[sessionId] = session;
    await saveManifest(projectId, manifest);

    return compressionRecord;

  } finally {
    if (lock) {
      lock.release();
    }
  }
}

/**
 * Determine compression level from settings
 * 1 = light, 2 = moderate, 3 = aggressive
 */
function determineCompressionLevel(settings) {
  if (settings.mode === 'tiered') {
    const preset = settings.tierPreset || 'standard';
    if (preset === 'gentle') return 1;
    if (preset === 'standard') return 2;
    if (preset === 'aggressive') return 3;
    return 2; // custom defaults to moderate
  }

  const aggr = settings.aggressiveness || 'moderate';
  if (aggr === 'minimal') return 1;
  if (aggr === 'moderate') return 2;
  if (aggr === 'aggressive') return 3;
  return 2;
}

/**
 * Calculate tokens for a subset of messages
 */
function calculateDeltaTokens(messages) {
  let totalChars = 0;
  for (const msg of messages) {
    const text = extractTextContent(msg);
    totalChars += text.length;
  }
  // Rough estimation: 1 token ~= 4 characters
  return Math.ceil(totalChars / 4);
}
```

**Acceptance Criteria**:
- [ ] Creates compression for delta messages only
- [ ] Correctly tracks part number and message range
- [ ] Uses `linkedFile` instead of `originalFile`
- [ ] Handles case where no delta exists
- [ ] Proper locking and error handling

### Task 2.4: Add Re-compression of Existing Part

**File**: `/home/dac/github/cc_context_eng/backend/src/services/memory-versions.js`

**Add function `recompressPart()`**:

```javascript
/**
 * Re-compress an existing part at a different compression level
 * This creates a new version of the same message range
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {number} partNumber - Part number to re-compress
 * @param {Object} settings - New compression settings
 * @returns {Object} New compression record
 */
export async function recompressPart(projectId, sessionId, partNumber, settings) {
  // Validate settings
  const validation = validateCompressionSettings(settings);
  if (!validation.valid) {
    const error = new Error(`Invalid compression settings: ${validation.errors.join('; ')}`);
    error.code = 'INVALID_SETTINGS';
    error.status = 400;
    throw error;
  }

  // Acquire lock
  let lock;
  try {
    lock = await acquireSessionLock(projectId, sessionId, OperationType.COMPRESSION);
  } catch (lockError) {
    if (lockError.code === 'COMPRESSION_IN_PROGRESS') {
      lockError.status = 409;
    }
    throw lockError;
  }

  try {
    const manifest = await loadManifest(projectId);
    const session = manifest.sessions[sessionId];

    if (!session) {
      const error = new Error(`Session ${sessionId} not found`);
      error.code = 'SESSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    // Find existing version of this part to get message range
    const existingParts = getPartVersions(session, partNumber);
    if (existingParts.length === 0) {
      const error = new Error(`Part ${partNumber} not found for session ${sessionId}`);
      error.code = 'PART_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const existingPart = existingParts[0];
    const messageRange = existingPart.messageRange;

    if (!messageRange) {
      const error = new Error(`Part ${partNumber} has no message range - cannot re-compress`);
      error.code = 'INVALID_PART';
      error.status = 400;
      throw error;
    }

    // Check if this compression level already exists
    const newLevel = determineCompressionLevel(settings);
    if (!canRecompressPart(session, partNumber, newLevel)) {
      const error = new Error(
        `Part ${partNumber} already has a version at compression level ${newLevel}`
      );
      error.code = 'VERSION_EXISTS';
      error.status = 409;
      throw error;
    }

    // Load and parse source file
    const sourceFile = session.linkedFile || session.originalFile;
    const parsed = await parseJsonlFile(sourceFile);

    // Extract messages for this part's range
    const partMessages = parsed.messages.slice(
      messageRange.startIndex,
      messageRange.endIndex
    );

    if (partMessages.length < 2) {
      const error = new Error('Part must have at least 2 messages');
      error.code = 'INSUFFICIENT_MESSAGES';
      error.status = 400;
      throw error;
    }

    // Generate new version ID
    const versionId = generatePartVersionId(session, partNumber);

    // Create parsed object for this part
    const partParsed = {
      ...parsed,
      messages: partMessages,
      totalMessages: partMessages.length
    };

    const partUuids = partMessages.map(m => m.uuid);

    // Compress
    let result;
    const startTime = Date.now();

    if (settings.mode === 'tiered') {
      result = await summarizeAndIntegrateWithTiers(partParsed, partUuids, {
        tiers: settings.customTiers || undefined,
        tierPreset: settings.tierPreset || 'standard',
        model: settings.model || 'opus',
        removeNonConversation: true,
        skipFirstMessages: settings.skipFirstMessages || 0
      });
    } else {
      result = await summarizeAndIntegrate(partParsed, partUuids, {
        compactionRatio: settings.compactionRatio || 10,
        aggressiveness: settings.aggressiveness || 'moderate',
        model: settings.model || 'opus',
        removeNonConversation: true,
        skipFirstMessages: settings.skipFirstMessages || 0
      });
    }

    const processingTime = Date.now() - startTime;

    // Calculate stats
    const outputTokens = countOutputTokens(result.messages);
    const outputMessages = result.messages.length;
    const compressionRatio = outputTokens > 0 ? existingPart.inputTokens / outputTokens : 1;

    // Save files
    const filename = generateVersionFilename(versionId, settings, outputTokens, partNumber);
    const savedFiles = await saveVersionFiles(projectId, sessionId, filename, result);

    // Create record
    const compressionRecord = {
      versionId,
      file: filename,
      createdAt: new Date().toISOString(),
      settings: {
        mode: settings.mode,
        ...(settings.mode === 'uniform' ? {
          compactionRatio: settings.compactionRatio || 10,
          aggressiveness: settings.aggressiveness || 'moderate'
        } : {
          tierPreset: settings.tierPreset || 'standard',
          customTiers: settings.customTiers || null
        }),
        model: settings.model || 'opus',
        skipFirstMessages: settings.skipFirstMessages || 0,
        keepitMode: settings.keepitMode || 'ignore',
        sessionDistance: settings.sessionDistance || null
      },
      inputTokens: existingPart.inputTokens,
      inputMessages: existingPart.inputMessages,
      outputTokens,
      outputMessages,
      compressionRatio: Number(compressionRatio.toFixed(2)),
      processingTimeMs: processingTime,
      keepitStats: { preserved: 0, summarized: 0, weights: {} },
      fileSizes: { md: savedFiles.mdSize, jsonl: savedFiles.jsonlSize },
      tierResults: result.tierResults || null,
      partNumber,
      compressionLevel: newLevel,
      isFullSession: false,
      messageRange // Same range as original part
    };

    session.compressions.push(compressionRecord);
    session.lastAccessed = new Date().toISOString();
    await saveManifest(projectId, manifest);

    return compressionRecord;

  } finally {
    if (lock) {
      lock.release();
    }
  }
}
```

**Acceptance Criteria**:
- [ ] Can re-compress an existing part at a different level
- [ ] Prevents duplicate compression levels for same part
- [ ] Uses same message range as original part
- [ ] Generates unique version ID

---

## Phase 3: API Routes and Service Integration

**Goal**: Expose delta compression through REST API.

### Task 3.1: Add Delta Compression Routes

**File**: `/home/dac/github/cc_context_eng/backend/src/routes/memory.js`

**Add new routes**:

```javascript
// Get delta status (what new messages exist)
router.get('/projects/:projectId/sessions/:sessionId/delta', async (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const session = await getSession(projectId, sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const sourceFile = session.linkedFile || session.originalFile;
    const parsed = await parseJsonlFile(sourceFile);
    const delta = detectDelta(parsed.messages, session);

    res.json({
      sessionId,
      hasDelta: delta.hasDelta,
      deltaMessageCount: delta.deltaMessages?.length || 0,
      deltaRange: delta.hasDelta ? {
        startIndex: delta.startIndex,
        endIndex: delta.endIndex,
        startTimestamp: delta.startTimestamp,
        endTimestamp: delta.endTimestamp
      } : null,
      currentPartCount: getHighestPartNumber(session),
      nextPartNumber: delta.previousPartNumber + 1
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Create delta compression (compress new messages only)
router.post('/projects/:projectId/sessions/:sessionId/delta', async (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const settings = req.body;

    const result = await createDeltaCompression(projectId, sessionId, settings);
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Re-compress existing part at different level
router.post('/projects/:projectId/sessions/:sessionId/parts/:partNumber/recompress', async (req, res) => {
  try {
    const { projectId, sessionId, partNumber } = req.params;
    const settings = req.body;

    const result = await recompressPart(projectId, sessionId, parseInt(partNumber), settings);
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Get all parts for a session (organized by part number)
router.get('/projects/:projectId/sessions/:sessionId/parts', async (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const session = await getSession(projectId, sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const partsByNumber = getPartsByNumber(session);

    // Convert Map to array for JSON serialization
    const parts = [];
    for (const [partNumber, versions] of partsByNumber) {
      parts.push({
        partNumber,
        messageRange: versions[0]?.messageRange || null,
        versions: versions.map(v => ({
          versionId: v.versionId,
          file: v.file,
          compressionLevel: v.compressionLevel,
          outputTokens: v.outputTokens,
          outputMessages: v.outputMessages,
          compressionRatio: v.compressionRatio,
          createdAt: v.createdAt
        }))
      });
    }

    // Sort by part number
    parts.sort((a, b) => a.partNumber - b.partNumber);

    res.json({
      sessionId,
      totalParts: parts.length,
      parts
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});
```

**Acceptance Criteria**:
- [ ] GET `/delta` returns accurate delta information
- [ ] POST `/delta` creates new part for delta messages
- [ ] POST `/parts/:partNumber/recompress` re-compresses existing part
- [ ] GET `/parts` returns organized part information
- [ ] Proper error handling and status codes

### Task 3.2: Update Existing Compression Route

**File**: `/home/dac/github/cc_context_eng/backend/src/routes/memory.js`

**Modify the existing compression endpoint** to support mode selection:

```javascript
// Create compression version - support both full and delta modes
router.post('/projects/:projectId/sessions/:sessionId/compressions', async (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const settings = req.body;

    // Check if delta mode is requested
    const compressionMode = settings.compressionMode || 'full';
    delete settings.compressionMode; // Remove from settings passed to compressor

    let result;
    if (compressionMode === 'delta') {
      result = await createDeltaCompression(projectId, sessionId, settings);
    } else {
      // Legacy full-session compression
      result = await createCompressionVersion(projectId, sessionId, settings);
    }

    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});
```

**Acceptance Criteria**:
- [ ] Existing compression still works (backwards compatible)
- [ ] `compressionMode: 'delta'` triggers delta compression
- [ ] `compressionMode: 'full'` (or omitted) triggers full compression

---

## Phase 4: Composition Engine Updates

**Goal**: Update composition to intelligently select and combine parts.

### Task 4.1: Update Version Selection for Parts

**File**: `/home/dac/github/cc_context_eng/backend/src/services/composition-engine.js`

**Add part-aware selection logic**:

```javascript
/**
 * Select the best versions of all parts for a session
 * Returns an array of versions (one per part) that fit the budget
 *
 * @param {Object} session - Session object from manifest
 * @param {Object} criteria - Selection criteria
 * @returns {Array} Array of selected version objects
 */
export function selectBestVersionsForParts(session, criteria) {
  const partsByNumber = getPartsByNumber(session);
  const selectedVersions = [];

  // If no parts exist, fall back to original
  if (partsByNumber.size === 0) {
    return [{
      versionId: 'original',
      partNumber: 1,
      isOriginal: true,
      outputTokens: session.originalTokens,
      outputMessages: session.originalMessages
    }];
  }

  // Calculate per-part budget
  const perPartBudget = criteria.maxTokens
    ? Math.floor(criteria.maxTokens / partsByNumber.size)
    : Infinity;

  // Select best version for each part
  for (const [partNumber, versions] of partsByNumber) {
    // Score and select best version for this part
    const scored = versions
      .map(v => ({
        version: v,
        score: scoreVersion(v, { ...criteria, maxTokens: perPartBudget })
      }))
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0 && scored[0].score >= 0.3) {
      selectedVersions.push({
        ...scored[0].version,
        partNumber
      });
    }
  }

  return selectedVersions;
}

/**
 * Generate composed output from multiple parts
 * Parts are concatenated in order (part 1 first, then part 2, etc.)
 */
export async function composeFromParts(projectId, sessionId, selectedVersions, outputFormat) {
  const session = await getSession(projectId, sessionId);
  const versionsDir = getVersionsPath(projectId, sessionId);

  const allMessages = [];

  // Sort by part number
  selectedVersions.sort((a, b) => (a.partNumber || 1) - (b.partNumber || 1));

  for (const version of selectedVersions) {
    if (version.isOriginal) {
      // Read original messages for this part's range
      const sourceFile = session.linkedFile || session.originalFile;
      const parsed = await parseJsonlFile(sourceFile);
      const range = version.messageRange || { startIndex: 0, endIndex: parsed.messages.length };
      const partMessages = parsed.messages.slice(range.startIndex, range.endIndex);
      allMessages.push(...partMessages);
    } else {
      // Read compressed version
      const compression = session.compressions.find(c => c.versionId === version.versionId);
      if (compression) {
        const jsonlPath = path.join(versionsDir, `${compression.file}.jsonl`);
        if (await fs.pathExists(jsonlPath)) {
          const records = await readJsonlAsArray(jsonlPath);
          const messages = records.filter(r => r.type === 'user' || r.type === 'assistant');
          allMessages.push(...messages);
        }
      }
    }
  }

  return allMessages;
}
```

**Acceptance Criteria**:
- [ ] Selects appropriate version for each part
- [ ] Respects per-part budget allocation
- [ ] Combines parts in correct order
- [ ] Handles mixed original/compressed parts

### Task 4.2: Update `composeContext()` for Part Support

**File**: `/home/dac/github/cc_context_eng/backend/src/services/composition-engine.js`

**Modify `composeContext()` to handle parts**:

```javascript
// In composeContext(), update the component processing loop:

for (let i = 0; i < components.length; i++) {
  const comp = components[i];
  const session = manifest.sessions[comp.sessionId];
  const budget = allocations[i];

  let selectedVersions;
  let totalTokenContribution = 0;
  let totalMessageContribution = 0;

  if (comp.versionId && comp.versionId !== 'auto') {
    // Specific version requested - use as before
    // ... existing logic
  } else if (comp.usePartSelection) {
    // NEW: Part-aware selection
    selectedVersions = selectBestVersionsForParts(session, {
      maxTokens: budget,
      preserveKeepits: true
    });

    for (const v of selectedVersions) {
      totalTokenContribution += v.outputTokens;
      totalMessageContribution += v.outputMessages;
    }
  } else {
    // ... existing auto-selection logic
  }

  selectedComponents.push({
    sessionId: comp.sessionId,
    versionId: comp.versionId || 'auto-parts',
    selectedVersions, // NEW: array of part versions
    order: i,
    tokenContribution: totalTokenContribution,
    messageContribution: totalMessageContribution,
    allocatedBudget: budget
  });
}
```

**Acceptance Criteria**:
- [ ] `usePartSelection: true` enables part-aware selection
- [ ] Multiple parts are correctly combined
- [ ] Total token count is accurate across parts
- [ ] Backwards compatible with single-version selection

---

## Phase 5: Frontend Updates

**Goal**: Update UI to support delta compression and part management.

### Task 5.1: Add Delta Status to Session Details

**File**: `/home/dac/github/cc_context_eng/frontend/src/components/memory/SessionDetails.vue`

**Add delta status display and action button**:

```vue
<!-- Add after metadata section -->
<div v-if="deltaStatus" class="delta-section">
  <div class="section-header">
    <h4>New Messages</h4>
    <span v-if="deltaStatus.hasDelta" class="delta-badge">
      {{ deltaStatus.deltaMessageCount }} new
    </span>
  </div>

  <div v-if="deltaStatus.hasDelta" class="delta-info">
    <p>
      {{ deltaStatus.deltaMessageCount }} messages have been added since the last compression.
    </p>
    <div class="delta-actions">
      <button @click="$emit('create-delta-compression')" class="btn-primary-small">
        Compress New Messages
      </button>
      <span class="action-hint">Creates Part {{ deltaStatus.nextPartNumber }}</span>
    </div>
  </div>

  <div v-else class="delta-synced">
    <span class="synced-icon">check</span>
    <span>All messages are compressed ({{ deltaStatus.currentPartCount }} parts)</span>
  </div>
</div>
```

**Add to script setup**:

```javascript
const deltaStatus = ref(null);

async function loadDeltaStatus() {
  try {
    deltaStatus.value = await memoryStore.getDeltaStatus(props.projectId, props.session.sessionId);
  } catch (err) {
    console.warn('Failed to load delta status:', err);
  }
}

onMounted(() => {
  loadDeltaStatus();
});
```

**Acceptance Criteria**:
- [ ] Shows count of new uncompressed messages
- [ ] Shows "Compress New Messages" button when delta exists
- [ ] Shows "synced" status when no delta

### Task 5.2: Update VersionList for Parts Display

**File**: `/home/dac/github/cc_context_eng/frontend/src/components/memory/VersionList.vue`

**Group versions by part number**:

```vue
<template>
  <div class="version-list">
    <!-- Original pseudo-version -->
    <div v-if="showOriginal" class="version-item original">
      <!-- existing original display -->
    </div>

    <!-- Group by part -->
    <div v-for="part in groupedParts" :key="part.partNumber" class="part-group">
      <div class="part-header">
        <span class="part-number">Part {{ part.partNumber }}</span>
        <span class="part-range" v-if="part.messageRange">
          Messages {{ part.messageRange.startIndex + 1 }}-{{ part.messageRange.endIndex }}
        </span>
        <button
          @click="$emit('recompress-part', part.partNumber)"
          class="btn-icon-small"
          title="Re-compress this part at different level"
        >
          +
        </button>
      </div>

      <div v-for="version in part.versions" :key="version.versionId" class="version-item">
        <div class="version-info">
          <span class="version-id">{{ version.versionId }}</span>
          <span class="compression-level" :class="'level-' + version.compressionLevel">
            {{ getLevelLabel(version.compressionLevel) }}
          </span>
        </div>
        <div class="version-stats">
          <span>{{ formatTokens(version.outputTokens) }} tokens</span>
          <span>{{ version.compressionRatio }}x</span>
        </div>
        <div class="version-actions">
          <button @click="$emit('view', version)">View</button>
          <button @click="$emit('delete', version)" class="btn-danger-small">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  versions: { type: Array, default: () => [] },
  showOriginal: { type: Boolean, default: true }
});

const groupedParts = computed(() => {
  const groups = new Map();

  for (const v of props.versions) {
    if (v.isOriginal) continue;
    const partNum = v.partNumber || 1;
    if (!groups.has(partNum)) {
      groups.set(partNum, {
        partNumber: partNum,
        messageRange: v.messageRange,
        versions: []
      });
    }
    groups.get(partNum).versions.push(v);
  }

  // Sort versions within each part by compression level
  for (const group of groups.values()) {
    group.versions.sort((a, b) => (a.compressionLevel || 1) - (b.compressionLevel || 1));
  }

  // Return sorted by part number
  return Array.from(groups.values()).sort((a, b) => a.partNumber - b.partNumber);
});

function getLevelLabel(level) {
  if (level === 1) return 'Light';
  if (level === 2) return 'Moderate';
  if (level === 3) return 'Aggressive';
  return 'Custom';
}
</script>
```

**Acceptance Criteria**:
- [ ] Versions grouped by part number
- [ ] Part header shows message range
- [ ] Re-compress button for each part
- [ ] Clear compression level indicators

### Task 5.3: Update CreateCompressionDialog for Delta Mode

**File**: `/home/dac/github/cc_context_eng/frontend/src/components/memory/CreateCompressionDialog.vue`

**Add compression mode selection**:

```vue
<!-- Add at top of dialog, after original-info -->
<div class="compression-mode-toggle">
  <label :class="{ active: compressionMode === 'full' }">
    <input type="radio" value="full" v-model="compressionMode" />
    <span>Full Session</span>
    <small>Compress all messages</small>
  </label>
  <label :class="{ active: compressionMode === 'delta' }" :disabled="!deltaAvailable">
    <input type="radio" value="delta" v-model="compressionMode" :disabled="!deltaAvailable" />
    <span>New Messages Only</span>
    <small v-if="deltaAvailable">{{ deltaCount }} messages</small>
    <small v-else>No new messages</small>
  </label>
</div>

<!-- Show delta info when delta mode selected -->
<div v-if="compressionMode === 'delta'" class="delta-info-box">
  <p>This will create <strong>Part {{ nextPartNumber }}</strong> containing only the
    {{ deltaCount }} new messages since the last compression.</p>
</div>
```

**Update script**:

```javascript
const compressionMode = ref('full');
const deltaAvailable = ref(false);
const deltaCount = ref(0);
const nextPartNumber = ref(1);

onMounted(async () => {
  // Load delta status
  try {
    const delta = await memoryStore.getDeltaStatus(props.projectId, props.sessionId);
    deltaAvailable.value = delta.hasDelta;
    deltaCount.value = delta.deltaMessageCount;
    nextPartNumber.value = delta.nextPartNumber;
  } catch (err) {
    console.warn('Failed to load delta status:', err);
  }
});

function buildSettings() {
  const base = {
    // ... existing settings
    compressionMode: compressionMode.value // Add this
  };
  // ... rest of function
}
```

**Acceptance Criteria**:
- [ ] Toggle between Full Session and Delta modes
- [ ] Delta mode disabled when no new messages
- [ ] Shows which part number will be created
- [ ] Settings passed correctly to API

### Task 5.4: Add Memory Store Methods

**File**: `/home/dac/github/cc_context_eng/frontend/src/stores/memory.js`

**Add new methods**:

```javascript
// Get delta status for a session
async getDeltaStatus(projectId, sessionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/delta`
  );
  if (!response.ok) {
    throw new Error(`Failed to get delta status: ${response.statusText}`);
  }
  return response.json();
},

// Get parts for a session
async getSessionParts(projectId, sessionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/parts`
  );
  if (!response.ok) {
    throw new Error(`Failed to get session parts: ${response.statusText}`);
  }
  return response.json();
},

// Re-compress a specific part
async recompressPart(projectId, sessionId, partNumber, settings) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/parts/${partNumber}/recompress`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to re-compress part');
  }
  return response.json();
}
```

**Acceptance Criteria**:
- [ ] All new API endpoints accessible from store
- [ ] Proper error handling
- [ ] Return data matches API responses

---

## Phase 6: Testing and Documentation

**Goal**: Comprehensive testing and documentation.

### Task 6.1: Unit Tests for Delta Detection

**New File**: `/home/dac/github/cc_context_eng/backend/tests/memory-delta.test.js`

```javascript
import { describe, it, expect } from 'vitest';
import {
  detectDelta,
  getHighestPartNumber,
  getLatestPart,
  getPartsByNumber,
  canRecompressPart,
  generatePartVersionId
} from '../src/services/memory-delta.js';

describe('Delta Detection', () => {
  it('should detect all messages as delta when no compressions exist', () => {
    const messages = [
      { uuid: '1', timestamp: '2026-01-01T10:00:00Z', type: 'user' },
      { uuid: '2', timestamp: '2026-01-01T10:01:00Z', type: 'assistant' }
    ];
    const session = { compressions: [] };

    const result = detectDelta(messages, session);

    expect(result.hasDelta).toBe(true);
    expect(result.deltaMessages.length).toBe(2);
    expect(result.isFirstPart).toBe(true);
  });

  it('should detect only new messages after last compression', () => {
    const messages = [
      { uuid: '1', timestamp: '2026-01-01T10:00:00Z', type: 'user' },
      { uuid: '2', timestamp: '2026-01-01T10:01:00Z', type: 'assistant' },
      { uuid: '3', timestamp: '2026-01-01T11:00:00Z', type: 'user' },
      { uuid: '4', timestamp: '2026-01-01T11:01:00Z', type: 'assistant' }
    ];
    const session = {
      compressions: [{
        partNumber: 1,
        messageRange: {
          startIndex: 0,
          endIndex: 2,
          endTimestamp: '2026-01-01T10:01:00Z'
        }
      }]
    };

    const result = detectDelta(messages, session);

    expect(result.hasDelta).toBe(true);
    expect(result.deltaMessages.length).toBe(2);
    expect(result.deltaMessages[0].uuid).toBe('3');
    expect(result.isFirstPart).toBe(false);
    expect(result.previousPartNumber).toBe(1);
  });

  it('should return no delta when all messages are compressed', () => {
    const messages = [
      { uuid: '1', timestamp: '2026-01-01T10:00:00Z', type: 'user' },
      { uuid: '2', timestamp: '2026-01-01T10:01:00Z', type: 'assistant' }
    ];
    const session = {
      compressions: [{
        partNumber: 1,
        messageRange: {
          startIndex: 0,
          endIndex: 2,
          endTimestamp: '2026-01-01T10:01:00Z'
        }
      }]
    };

    const result = detectDelta(messages, session);

    expect(result.hasDelta).toBe(false);
    expect(result.deltaMessages.length).toBe(0);
  });

  // Add more test cases for edge cases:
  // - Timestamp ties
  // - Missing timestamps
  // - Multiple parts
  // - etc.
});

describe('Part Management', () => {
  it('should get highest part number correctly', () => {
    const session = {
      compressions: [
        { partNumber: 1 },
        { partNumber: 2 },
        { partNumber: 1 }  // Another version of part 1
      ]
    };

    expect(getHighestPartNumber(session)).toBe(2);
  });

  it('should check if part can be re-compressed', () => {
    const session = {
      compressions: [
        { partNumber: 1, compressionLevel: 1 },
        { partNumber: 1, compressionLevel: 2 }
      ]
    };

    expect(canRecompressPart(session, 1, 3)).toBe(true);
    expect(canRecompressPart(session, 1, 2)).toBe(false);
  });
});
```

**Acceptance Criteria**:
- [ ] All delta detection scenarios tested
- [ ] Part management functions tested
- [ ] Edge cases covered
- [ ] Tests pass

### Task 6.2: Integration Tests

**New File**: `/home/dac/github/cc_context_eng/backend/tests/incremental-compression.test.js`

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDeltaCompression, recompressPart } from '../src/services/memory-versions.js';
import { registerSession } from '../src/services/memory-session.js';
import { syncNewMessages } from '../src/services/memory-sync.js';
// ... test setup

describe('Incremental Compression Integration', () => {
  it('should create initial part from full session', async () => {
    // Register session, create first compression
    // Verify part 1 is created correctly
  });

  it('should create delta part after sync', async () => {
    // Sync new messages
    // Create delta compression
    // Verify part 2 is created with correct range
  });

  it('should re-compress existing part at different level', async () => {
    // Create aggressive version of part 1
    // Verify same message range, different output
  });

  it('should compose from multiple parts', async () => {
    // Create composition from session with multiple parts
    // Verify parts are combined correctly
  });
});
```

**Acceptance Criteria**:
- [ ] Full workflow tested end-to-end
- [ ] Integration with sync verified
- [ ] Composition with parts tested
- [ ] Tests pass

### Task 6.3: Update API Documentation

**File**: `/home/dac/github/cc_context_eng/docs/API.md` (create or update)

Document all new endpoints:
- `GET /projects/:projectId/sessions/:sessionId/delta`
- `POST /projects/:projectId/sessions/:sessionId/delta`
- `GET /projects/:projectId/sessions/:sessionId/parts`
- `POST /projects/:projectId/sessions/:sessionId/parts/:partNumber/recompress`

**Acceptance Criteria**:
- [ ] All new endpoints documented
- [ ] Request/response schemas documented
- [ ] Example usage provided

---

## Implementation Order Summary

| Phase | Tasks | Dependencies | Estimated Effort |
|-------|-------|--------------|------------------|
| 1 | 1.1, 1.2, 1.3 | None | 1-2 days |
| 2 | 2.1, 2.2, 2.3, 2.4 | Phase 1 | 2-3 days |
| 3 | 3.1, 3.2 | Phase 2 | 1 day |
| 4 | 4.1, 4.2 | Phase 3 | 1-2 days |
| 5 | 5.1, 5.2, 5.3, 5.4 | Phase 4 | 2-3 days |
| 6 | 6.1, 6.2, 6.3 | Phase 5 | 1-2 days |

**Total Estimated Effort**: 8-13 days

---

## Risk Mitigation

1. **Backwards Compatibility**
   - All existing compressions marked as `isFullSession: true`
   - Migration handles old schema gracefully
   - API accepts both old and new request formats

2. **Data Integrity**
   - Session locking prevents concurrent compressions
   - Message ranges validated before compression
   - Timestamp comparison uses `new Date()` (not string subtraction)

3. **Performance**
   - Delta detection is O(n) in message count
   - Only delta messages processed for compression
   - File operations use existing optimized paths

4. **User Experience**
   - Clear UI indication of delta vs full compression
   - Part grouping makes version management intuitive
   - Graceful fallbacks if delta not available

---

## Future Enhancements (Out of Scope)

- Automatic delta compression on sync (configurable)
- Part deletion with cascade handling
- Intelligent part merging (combine small parts)
- Compression scheduling/queuing
- Token budget optimization across parts
