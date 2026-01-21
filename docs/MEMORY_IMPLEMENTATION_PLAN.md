# Memory System Implementation Plan

## Overview

This document provides a detailed, atomic implementation plan for integrating the Memory System into the Claude Code Context Manager (cc_context_eng) project. Each task is designed to be:

- Completable in 1-4 hours
- Independently testable
- Clear in its acceptance criteria
- Explicit about dependencies

**Total estimated tasks:** 70 atomic tasks across 10 phases
**Estimated total effort:** 130-170 hours (10-14 weeks for a single developer)

> **Revision Note:** This plan was updated on 2026-01-21 to address all findings from the MEMORY_PLAN_REVIEW.md review document.

---

## Phase 1: Storage Foundation

### Goal: Establish the basic storage infrastructure and configuration management

### Prerequisites: None (this is the foundation)

---

#### Task 1.1: Create Memory Storage Service - Directory Structure

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/services/memory-storage.js` - Create new file

**Implementation details**:
1. Create the MemoryStorage class with methods for directory management
2. Implement `ensureDirectoryStructure(projectId)` to create:
   - `~/.claude-memory/`
   - `~/.claude-memory/projects/{projectId}/`
   - `~/.claude-memory/projects/{projectId}/originals/`
   - `~/.claude-memory/projects/{projectId}/summaries/`
   - `~/.claude-memory/projects/{projectId}/composed/`
   - `~/.claude-memory/cache/`
3. Use `fs-extra` for async directory operations (matches existing patterns)
4. Export singleton instance and utility functions

**Code patterns to follow**:
```javascript
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const MEMORY_ROOT = path.join(os.homedir(), '.claude-memory');

export async function ensureMemoryRoot() { ... }
export async function getProjectDir(projectId) { ... }
```

**Acceptance criteria**:
- [ ] Running `ensureDirectoryStructure('test-project')` creates all required directories
- [ ] Function is idempotent (can run multiple times safely)
- [ ] Handles permission errors gracefully with meaningful error messages

**Tests required**:
- Unit test: Directory creation with mock fs
- Integration test: Create directories in temp folder, verify structure

**Dependencies**: None

---

#### Task 1.2: Global Configuration Management

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/services/memory-storage.js` - Add config methods
- `backend/src/services/memory-config.js` - Create new file (optional, can be in memory-storage.js)

**Implementation details**:
1. Create default config object matching design spec:
```javascript
const DEFAULT_CONFIG = {
  version: "1.0.0",
  createdAt: null, // Set on first creation
  storage: {
    compressionRetention: "all"
  },
  defaults: {
    compressionPreset: "standard",
    keepitDecayEnabled: true,
    autoRegisterSessions: false,
    model: "opus"
  },
  keepitDecay: {
    compressionBase: { light: 0.1, moderate: 0.3, aggressive: 0.5 },
    maxSessionDistance: 10,
    pinnedWeight: 1.0
  }
};
```
2. Implement `loadGlobalConfig()` - reads or creates config.json
3. Implement `saveGlobalConfig(config)` - writes config with validation
4. Implement `getConfigValue(path)` - get nested config values (e.g., "defaults.model")

**Acceptance criteria**:
- [ ] First call to `loadGlobalConfig()` creates config.json with defaults
- [ ] Subsequent calls load existing config
- [ ] Config validation rejects invalid values (e.g., negative maxSessionDistance)
- [ ] Config changes persist across process restarts

**Tests required**:
- Unit test: Config creation, loading, saving
- Unit test: Validation rejects bad config values

**Dependencies**: Task 1.1

---

#### Task 1.3: Project Manifest Schema and CRUD Operations

**Estimated effort**: 3 hours

**Files to create/modify**:
- `backend/src/services/memory-manifest.js` - Create new file

**Implementation details**:
1. Define manifest schema matching design document:
```javascript
const MANIFEST_SCHEMA = {
  version: "1.0.0",
  projectId: null,
  originalPath: null,
  displayName: null,
  createdAt: null,
  lastModified: null,
  sessions: {},
  compositions: {},
  settings: {
    defaultCompressionPreset: "standard",
    autoRegisterNewSessions: false,
    keepitDecayEnabled: true
  }
};
```
2. Implement CRUD operations:
   - `loadManifest(projectId)` - Load or create new manifest
   - `saveManifest(projectId, manifest)` - Save manifest with validation
   - `getManifestPath(projectId)` - Get path to manifest.json
3. Add schema validation using simple type checking
4. Handle concurrent access with file locking (use `proper-lockfile` or similar)

**Acceptance criteria**:
- [ ] `loadManifest()` creates new manifest if none exists
- [ ] `saveManifest()` validates schema before writing
- [ ] Manifest includes version for future migrations
- [ ] File locking prevents corruption during concurrent writes

**Tests required**:
- Unit test: Manifest creation with default values
- Unit test: Manifest loading from existing file
- Unit test: Schema validation rejects invalid manifests
- Integration test: Concurrent saves don't corrupt manifest
- Stress test: Rapid concurrent manifest access

**Dependencies**: Task 1.1, Task 1.2

---

#### Task 1.3a: Manifest Migration Framework

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/services/memory-migration.js` - Create new file

**Implementation details**:
1. Create migration framework for future schema changes:
```javascript
const MIGRATIONS = {
  '1.0.0': {
    // Base version, no migration needed
  },
  '1.1.0': {
    migrate: async (manifest) => {
      // Example future migration
      // Add new fields with defaults
      manifest.sessions = manifest.sessions || {};
      for (const session of Object.values(manifest.sessions)) {
        session.newField = session.newField ?? 'default';
      }
      return manifest;
    }
  }
};

export async function migrateManifest(manifest) {
  const currentVersion = manifest.version || '1.0.0';
  const targetVersion = CURRENT_SCHEMA_VERSION;

  if (currentVersion === targetVersion) return manifest;

  // Apply migrations in order
  const versions = Object.keys(MIGRATIONS).sort(semverCompare);
  let migrated = { ...manifest };

  for (const version of versions) {
    if (semverCompare(version, currentVersion) > 0 &&
        semverCompare(version, targetVersion) <= 0) {
      migrated = await MIGRATIONS[version].migrate(migrated);
      migrated.version = version;
    }
  }

  return migrated;
}
```
2. Integrate migration into `loadManifest()` to auto-migrate on load
3. Add backup before migration

**Acceptance criteria**:
- [ ] Migrations applied automatically on manifest load
- [ ] Old manifests upgraded to current schema
- [ ] Backup created before migration
- [ ] Failed migrations don't corrupt data

**Tests required**:
- Unit test: Migration from v1.0.0 to v1.1.0 (mock)
- Unit test: No migration when already current
- Unit test: Backup creation before migration

**Dependencies**: Task 1.3

---

#### Task 1.4: Session Registration - Core Logic

**Estimated effort**: 3 hours

**Files to create/modify**:
- `backend/src/services/memory-session.js` - Create new file

**Implementation details**:
1. Implement `registerSession(projectId, sessionId, originalFilePath)`:
   - Verify original file exists at `~/.claude/projects/{projectId}/{sessionId}.jsonl`
   - Parse session using existing `jsonl-parser.js` to extract metadata
   - Calculate original token count and message count
   - Extract first/last timestamps from messages
   - Create symlink or copy to `originals/` folder
   - Create session entry in manifest
2. Extract metadata fields:
   - `gitBranch` from first message
   - `projectName` from cwd
   - `claudeVersion` from version field
3. Implement `unregisterSession(projectId, sessionId)`:
   - Remove symlink/copy from originals
   - Remove session from manifest (preserves summaries folder)

**Code pattern**:
```javascript
import { parseJsonlFile } from './jsonl-parser.js';
import { loadManifest, saveManifest } from './memory-manifest.js';

export async function registerSession(projectId, sessionId, originalFilePath) {
  const parsed = await parseJsonlFile(originalFilePath);
  const manifest = await loadManifest(projectId);

  const sessionEntry = {
    sessionId,
    originalFile: originalFilePath,
    originalTokens: calculateTotalTokens(parsed),
    originalMessages: parsed.totalMessages,
    firstTimestamp: getFirstTimestamp(parsed),
    lastTimestamp: getLastTimestamp(parsed),
    registeredAt: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    metadata: extractMetadata(parsed),
    keepitMarkers: [], // Will be populated in Phase 3
    compressions: []
  };

  manifest.sessions[sessionId] = sessionEntry;
  await saveManifest(projectId, manifest);

  return sessionEntry;
}
```

**Acceptance criteria**:
- [ ] Session registration extracts all required metadata
- [ ] Symlink is created correctly (or copy if symlinks not supported)
- [ ] Falls back to file copy if symlink creation fails (Windows compatibility)
- [ ] Session appears in manifest after registration
- [ ] Unregistration removes symlink but preserves manifest entry option
- [ ] Error returned if session already registered (409 Conflict)

**Tests required**:
- Unit test: Metadata extraction from parsed session
- Integration test: Full registration flow with real JSONL file
- Integration test: Symlink fallback to copy on Windows
- Unit test: Already-registered session returns appropriate error

**Dependencies**: Task 1.3, Task 1.3a

---

#### Task 1.5: Session Registration - API Endpoint

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Create new file
- `backend/src/server.js` - Add memory routes

**Implementation details**:
1. Create Express router for memory endpoints
2. Implement `POST /api/memory/projects/:projectId/sessions/:sessionId`:
   - Validate projectId and sessionId parameters
   - Call `registerSession()` from memory-session.js
   - Return session entry on success
3. Implement `DELETE /api/memory/projects/:projectId/sessions/:sessionId`:
   - Call `unregisterSession()`
   - Return success status
4. Add error handling middleware for memory routes

**API patterns to follow** (from existing routes):
```javascript
router.post('/:projectId/sessions/:sessionId', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;
    // Implementation
    res.json(result);
  } catch (error) {
    next(error);
  }
});
```

**Acceptance criteria**:
- [ ] POST endpoint registers session and returns session entry
- [ ] DELETE endpoint unregisters session
- [ ] 404 returned for non-existent project/session
- [ ] 409 returned if session already registered

**Tests required**:
- API test: Register session endpoint
- API test: Unregister session endpoint
- API test: Error cases (not found, already exists)

**Dependencies**: Task 1.4

---

#### Task 1.6: List Projects and Sessions in Memory

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add list endpoints

**Implementation details**:
1. Implement `GET /api/memory/projects`:
   - Scan `~/.claude-memory/projects/` directory
   - Load manifest for each project
   - Return list with session counts, last modified dates
2. Implement `GET /api/memory/projects/:projectId`:
   - Load manifest for project
   - Return full project details including session list
3. Implement `GET /api/memory/projects/:projectId/sessions`:
   - Load manifest and return sessions array
   - Include compression version counts per session

**Acceptance criteria**:
- [ ] List projects returns all projects in memory system
- [ ] Get project returns full manifest data
- [ ] List sessions returns all registered sessions with version counts

**Tests required**:
- API test: List empty projects
- API test: List projects with sessions
- API test: Get project details

**Dependencies**: Task 1.5

---

## Phase 2: Compression Version Management

### Goal: Integrate with existing summarizer to create and manage compression versions

### Prerequisites: Phase 1 complete

---

#### Task 2.1: Version Storage and Naming Service

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/services/memory-versions.js` - Create new file

**Implementation details**:
1. Implement version naming function:
```javascript
export function generateVersionFilename(versionId, settings, tokenCount) {
  const mode = settings.mode;
  const preset = settings.tierPreset || settings.aggressiveness || 'custom';
  const tokens = Math.round(tokenCount / 1000);
  return `${versionId}_${mode}-${preset}_${tokens}k`;
}
// Example: v001_tiered-standard_10k
```
2. Implement `getNextVersionId(sessionId)`:
   - Load versions.json for session
   - Return next sequential ID (v001, v002, etc.)
3. Implement `getVersionsPath(projectId, sessionId)`:
   - Returns path to `summaries/{sessionId}/`
4. Implement `ensureVersionsDir(projectId, sessionId)`:
   - Creates session summaries directory if needed

**Acceptance criteria**:
- [ ] Version filenames follow spec pattern
- [ ] Version IDs are sequential and zero-padded
- [ ] Versions directory is created when needed

**Tests required**:
- Unit test: Filename generation with various settings
- Unit test: Sequential version ID generation

**Dependencies**: Task 1.3

---

#### Task 2.2: Create Compression Version - Core Logic

**Estimated effort**: 4 hours

**Files to create/modify**:
- `backend/src/services/memory-versions.js` - Add compression creation

**Implementation details**:
1. Implement `createCompressionVersion(projectId, sessionId, settings)`:
   - Load original session from registered path
   - Call existing summarizer based on mode (uniform/tiered)
   - Generate version filename
   - Save compressed output as .md and .jsonl files
   - Create CompressionRecord with all metadata
   - Update versions.json
   - Update manifest with new compression entry
2. Leverage existing summarizer functions:
   - `summarizeAndIntegrate()` for uniform mode
   - `summarizeAndIntegrateWithTiers()` for tiered mode
3. Calculate and store:
   - outputTokens, outputMessages
   - compressionRatio (input/output)
   - keepitStats (placeholder for Phase 3)

**Code pattern**:
```javascript
export async function createCompressionVersion(projectId, sessionId, settings) {
  const manifest = await loadManifest(projectId);
  const session = manifest.sessions[sessionId];

  if (!session) throw new Error('Session not registered');

  const parsed = await parseJsonlFile(session.originalFile);
  const versionId = await getNextVersionId(projectId, sessionId);

  // Call appropriate summarizer
  let result;
  if (settings.mode === 'tiered') {
    result = await summarizeAndIntegrateWithTiers(parsed, allUuids, settings);
  } else {
    result = await summarizeAndIntegrate(parsed, allUuids, settings);
  }

  // Save outputs
  const filename = generateVersionFilename(versionId, settings, outputTokens);
  await saveVersionFiles(projectId, sessionId, filename, result);

  // Create compression record
  const record = { versionId, file: filename, ... };

  // Update manifest
  session.compressions.push(record);
  await saveManifest(projectId, manifest);

  return record;
}
```

**Acceptance criteria**:
- [ ] Uniform compression creates valid version
- [ ] Tiered compression creates valid version
- [ ] Both .md and .jsonl files are generated
- [ ] CompressionRecord contains all required fields
- [ ] Manifest is updated with new compression

**Tests required**:
- Unit test: Compression record creation
- Integration test: Full compression with real session

**Dependencies**: Task 2.1

---

#### Task 2.3: Create Compression Version - API Endpoint

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add version creation endpoint

**Implementation details**:
1. Implement `POST /api/memory/sessions/:sessionId/versions`:
   - Accept settings in request body
   - Validate settings schema
   - Call `createCompressionVersion()`
   - Return compression record
2. Request body schema:
```javascript
{
  mode: 'uniform' | 'tiered',
  compactionRatio?: number,      // For uniform
  aggressiveness?: string,        // For uniform
  tierPreset?: string,            // For tiered
  customTiers?: TierConfig[],     // For tiered
  model: string,
  skipFirstMessages: number,
  keepitMode: 'decay' | 'preserve-all' | 'ignore',
  sessionDistance?: number
}
```

**Acceptance criteria**:
- [ ] Endpoint creates compression version
- [ ] Invalid settings return 400 error
- [ ] Progress indication for long operations (consider SSE in future)

**Tests required**:
- API test: Create uniform compression
- API test: Create tiered compression
- API test: Validation errors

**Dependencies**: Task 2.2

---

#### Task 2.4: List Compression Versions

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add list endpoint

**Implementation details**:
1. Implement `GET /api/memory/sessions/:sessionId/versions`:
   - Load manifest and return compressions array for session
   - Include file sizes by reading from disk
   - Include "original" as pseudo-version option with originalTokens
2. Implement `GET /api/memory/sessions/:sessionId/versions/:versionId`:
   - Return specific version details including all CompressionRecord fields
   - Include download URLs for .md and .jsonl files
   - Include keepitStats breakdown
   - Support `versionId=original` to return original session metadata
   - Response schema:
   ```javascript
   {
     versionId: string,
     file: string,
     createdAt: string,
     settings: CompressionSettings,
     outputTokens: number,
     outputMessages: number,
     compressionRatio: number,
     keepitStats: {
       preserved: number,
       summarized: number,
       weights: Record<string, number>
     },
     fileSizes: {
       md: number,
       jsonl: number
     },
     downloadUrls: {
       md: string,
       jsonl: string
     }
   }
   ```

**Acceptance criteria**:
- [ ] List returns all versions for session including "original" option
- [ ] Individual version endpoint returns full CompressionRecord with file sizes
- [ ] 404 for non-existent version
- [ ] Original pseudo-version returns session metadata

**Tests required**:
- API test: List versions
- API test: Get specific version details
- API test: Get original pseudo-version
- API test: 404 for non-existent version

**Dependencies**: Task 2.3

---

#### Task 2.5: Get Version Content

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add content endpoints

**Implementation details**:
1. Implement `GET /api/memory/sessions/:sessionId/versions/:versionId/content`:
   - Query param `format=md|jsonl` (default: md)
   - Return file contents
2. Implement `GET /api/memory/sessions/:sessionId/versions/:versionId/download`:
   - Set appropriate Content-Disposition header
   - Stream file to client

**Acceptance criteria**:
- [ ] Can retrieve markdown content
- [ ] Can retrieve JSONL content
- [ ] Download endpoint triggers file download

**Tests required**:
- API test: Get markdown content
- API test: Get JSONL content
- API test: Download with correct headers

**Dependencies**: Task 2.4

---

#### Task 2.6: Delete Compression Version

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add delete endpoint
- `backend/src/services/memory-versions.js` - Add delete logic

**Implementation details**:
1. Implement `deleteCompressionVersion(projectId, sessionId, versionId)`:
   - Check if version is used in any compositions
   - If used, return error or require force flag
   - Delete .md and .jsonl files
   - Remove from manifest compressions array
2. Implement `DELETE /api/memory/sessions/:sessionId/versions/:versionId`:
   - Query param `force=true` to delete even if used
   - Return updated session entry

**Acceptance criteria**:
- [ ] Delete removes files and manifest entry
- [ ] Error if version is used in composition (without force)
- [ ] Force flag allows deletion of used versions

**Tests required**:
- API test: Delete unused version
- API test: Prevent deletion of used version
- API test: Force deletion

**Dependencies**: Task 2.4

---

## Phase 3: Keepit Markers

### Goal: Implement keepit marker detection, extraction, and decay calculation

### Prerequisites: Phase 2 complete

---

#### Task 3.1: Keepit Pattern Detection and Extraction

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/services/keepit-parser.js` - Create new file

**Implementation details**:
1. Implement pattern matching:
```javascript
const KEEPIT_PATTERN = /##keepit(\d+\.\d{2})##([\s\S]*?)(?=##keepit|\n\n|$)/gi;

export function extractKeepitMarkers(text) {
  const markers = [];
  let match;

  while ((match = KEEPIT_PATTERN.exec(text)) !== null) {
    markers.push({
      weight: parseFloat(match[1]),
      content: match[2].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }

  return markers;
}
```
2. Implement `findKeepitsInSession(parsed)`:
   - Iterate through all messages
   - Extract keepits from text content blocks
   - Return array of KeepitMarker objects with message UUIDs
3. Handle edge cases:
   - Nested keepits
   - Keepits spanning multiple lines
   - Malformed weights (clamp to 0-1)

**Acceptance criteria**:
- [ ] Detects standard keepit markers (##keepit0.80##content)
- [ ] Correctly extracts weight as float
- [ ] Extracts content until next marker or paragraph break
- [ ] Returns marker positions for highlighting

**Tests required**:
- Unit test: Simple marker extraction
- Unit test: Multiple markers in one message
- Unit test: Edge cases (nested, multiline, malformed)

**Dependencies**: None (can be done in parallel)

---

#### Task 3.2: Weight Validation and Normalization

**Estimated effort**: 1 hour

**Files to create/modify**:
- `backend/src/services/keepit-parser.js` - Add validation functions

**Implementation details**:
1. Implement weight validation:
```javascript
export function validateWeight(weight) {
  if (typeof weight !== 'number' || isNaN(weight)) return 0.5;
  if (weight < 0) return 0;
  if (weight > 1) return 1;
  return Math.round(weight * 100) / 100;
}

export const WEIGHT_PRESETS = {
  PINNED: 1.00,
  CRITICAL: 0.90,
  IMPORTANT: 0.75,
  NOTABLE: 0.50,
  MINOR: 0.25,
  HINT: 0.10
};
```
2. Implement `normalizeKeepitMarker(raw)`:
   - Validates and normalizes weight
   - Generates unique markerId
   - Extracts context (surrounding text for display)

**Acceptance criteria**:
- [ ] Invalid weights are clamped to 0-1 range
- [ ] Weights are rounded to 2 decimal places
- [ ] Preset weights are exported for UI use

**Tests required**:
- Unit test: Weight validation edge cases
- Unit test: Marker normalization

**Dependencies**: Task 3.1

---

#### Task 3.3: Decay Calculation Algorithm

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/services/keepit-decay.js` - Create new file

**Implementation details**:
1. Implement the decay formula from design doc:
```javascript
export function calculateSurvivalThreshold(compressionRatio, sessionDistance, aggressiveness) {
  const compressionBase = {
    light: 0.1,
    moderate: 0.3,
    aggressive: 0.5
  }[getAggressivenessLevel(compressionRatio, aggressiveness)];

  const ratioPenalty = compressionRatio / 100;
  const maxDistance = 10;
  const distanceFactor = Math.min(sessionDistance, maxDistance) / maxDistance;

  return compressionBase + (ratioPenalty * distanceFactor);
}

export function shouldKeepitSurvive(weight, sessionDistance, compressionRatio, aggressiveness) {
  // Pinned content ALWAYS survives
  if (weight >= 1.0) return true;

  const threshold = calculateSurvivalThreshold(compressionRatio, sessionDistance, aggressiveness);
  return weight >= threshold;
}
```
2. Implement `previewDecay(markers, settings)`:
   - Takes array of markers and compression settings
   - Returns which markers will survive vs be summarized
   - Includes threshold calculation for transparency

**Acceptance criteria**:
- [ ] Pinned (1.0) always survives
- [ ] Threshold increases with compression ratio and distance
- [ ] Preview accurately predicts survival

**Tests required**:
- Unit test: Example calculations from design doc
- Unit test: Edge cases (weight exactly at threshold)

**Dependencies**: Task 3.2

---

#### Task 3.4: Integration with Summarizer - Preserve/Summarize Decisions

**Estimated effort**: 4 hours

**Files to create/modify**:
- `backend/src/services/summarizer.js` - Modify to support keepits
- `backend/src/services/keepit-decay.js` - Add summarizer integration

**Implementation details**:
1. Modify `buildSummarizationPrompt()` to include keepit instructions:
```javascript
function buildSummarizationPrompt(messages, options) {
  const { keepitMarkers, keepitMode } = options;

  let keepitInstructions = '';
  if (keepitMode === 'preserve-all') {
    keepitInstructions = `
## CRITICAL: Preserve ##keepit## Content
The following marked content MUST be preserved verbatim in your summaries:
${keepitMarkers.filter(m => m.survive).map(m => `- ${m.content.substring(0, 100)}...`).join('\n')}
`;
  } else if (keepitMode === 'decay') {
    const surviving = keepitMarkers.filter(m => m.survive);
    const summarized = keepitMarkers.filter(m => !m.survive);
    keepitInstructions = `
## IMPORTANT: ##keepit## Markers
PRESERVE these marked sections verbatim:
${surviving.map(m => `- ${m.content.substring(0, 100)}...`).join('\n')}

These may be summarized normally:
${summarized.map(m => `- ${m.content.substring(0, 50)}...`).join('\n')}
`;
  }

  // Insert into prompt
  ...
}
```
2. Track which keepits survived in compression result
3. Update compression record with keepitStats

**Acceptance criteria**:
- [ ] Surviving keepits are preserved verbatim in output
- [ ] Summarized keepits are still mentioned (condensed)
- [ ] keepitStats accurately reflects what happened

**Tests required**:
- Integration test: Compression with keepits in preserve-all mode
- Integration test: Compression with decay mode
- Test: Verify surviving content is preserved

**Dependencies**: Task 3.3, Task 2.2

---

#### Task 3.4a: Keepit Preservation Verification

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/services/keepit-verifier.js` - Create new file
- `backend/src/services/memory-versions.js` - Add verification call

**Implementation details**:
1. Create post-compression verification:
```javascript
export async function verifyKeepitPreservation(
  originalKeepits,
  compressedContent,
  survivalDecisions
) {
  const results = {
    verified: [],
    missing: [],
    warnings: []
  };

  for (const keepit of originalKeepits) {
    const decision = survivalDecisions.find(d => d.markerId === keepit.markerId);

    if (decision?.survives) {
      // Check if content exists verbatim in output
      const found = compressedContent.includes(keepit.content.trim());

      if (found) {
        results.verified.push({
          markerId: keepit.markerId,
          status: 'preserved'
        });
      } else {
        // Check for partial match (LLM may have slightly reformatted)
        const partialMatch = findPartialMatch(keepit.content, compressedContent);
        if (partialMatch.similarity >= 0.9) {
          results.warnings.push({
            markerId: keepit.markerId,
            status: 'modified',
            similarity: partialMatch.similarity,
            original: keepit.content.substring(0, 100),
            found: partialMatch.match.substring(0, 100)
          });
        } else {
          results.missing.push({
            markerId: keepit.markerId,
            status: 'missing',
            expectedContent: keepit.content.substring(0, 100)
          });
        }
      }
    }
  }

  return results;
}

function findPartialMatch(needle, haystack) {
  // Use Levenshtein distance or similar for fuzzy matching
  // Return best match and similarity score
}
```
2. Integrate into compression workflow - run after LLM response
3. Log warnings for modified content, fail on missing critical content
4. Add verification results to CompressionRecord

**Acceptance criteria**:
- [ ] Verification runs automatically after each compression
- [ ] Surviving keepits are verified to exist in output
- [ ] Missing keepits logged with warning
- [ ] Option to fail compression if verification fails
- [ ] Verification results stored in compression record

**Tests required**:
- Unit test: Verification with perfect preservation
- Unit test: Verification with slight modifications
- Unit test: Verification with missing content
- Integration test: Full compression with verification

**Dependencies**: Task 3.4

---

#### Task 3.5: Keepit Detection on Session Registration

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/services/memory-session.js` - Add keepit extraction

**Implementation details**:
1. Modify `registerSession()` to extract keepits:
```javascript
export async function registerSession(projectId, sessionId, originalFilePath) {
  const parsed = await parseJsonlFile(originalFilePath);

  // Extract keepit markers from all messages
  const keepitMarkers = findKeepitsInSession(parsed);

  const sessionEntry = {
    // ... existing fields
    keepitMarkers: keepitMarkers.map(k => ({
      markerId: generateMarkerId(),
      messageUuid: k.messageUuid,
      weight: k.weight,
      content: k.content,
      position: { start: k.startIndex, end: k.endIndex },
      context: extractContext(k, parsed),
      createdAt: new Date().toISOString(),
      survivedIn: [],
      summarizedIn: []
    }))
  };

  // ... rest of registration
}
```

**Acceptance criteria**:
- [ ] Registration extracts all keepits from session
- [ ] Keepits include message UUID reference
- [ ] Context extraction provides surrounding text

**Tests required**:
- Integration test: Register session with keepits

**Dependencies**: Task 3.1, Task 1.4

---

#### Task 3.6: Keepit Management API Endpoints

**Estimated effort**: 3 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add keepit endpoints
- `backend/src/services/keepit-updater.js` - Create new file

**Implementation details**:
1. Implement `GET /api/memory/sessions/:sessionId/keepits`:
   - Return all keepit markers for session
2. Implement `PUT /api/memory/sessions/:sessionId/keepits/:markerId`:
   - Update weight for a marker
   - **CRITICAL**: Per design doc Section 5.4, this modifies the ORIGINAL session file
   - Implementation approach:
   ```javascript
   export async function updateKeepitWeight(sessionId, markerId, newWeight) {
     const manifest = await loadManifest(projectId);
     const session = manifest.sessions[sessionId];
     const marker = session.keepitMarkers.find(m => m.markerId === markerId);

     if (!marker) throw new KeepitNotFoundError(markerId);

     // 1. Read original JSONL file
     const originalPath = session.originalFile;
     const lines = await readJsonlLines(originalPath);

     // 2. Find and update the message containing this keepit
     const messageIndex = lines.findIndex(l =>
       l.uuid === marker.messageUuid
     );

     if (messageIndex === -1) throw new MessageNotFoundError(marker.messageUuid);

     // 3. Update the keepit pattern in the message content
     const oldPattern = `##keepit${marker.weight.toFixed(2)}##`;
     const newPattern = `##keepit${newWeight.toFixed(2)}##`;
     lines[messageIndex].content = lines[messageIndex].content.replace(
       oldPattern + marker.content,
       newPattern + marker.content
     );

     // 4. Write back to original file (with backup)
     await backupFile(originalPath);
     await writeJsonlLines(originalPath, lines);

     // 5. Update manifest
     marker.weight = newWeight;
     await saveManifest(projectId, manifest);

     return marker;
   }
   ```
   - Create backup before modifying original file
   - Update manifest to reflect new weight
3. Implement `POST /api/memory/decay/preview`:
   - Request body: { sessionId, settings }
   - Return survival predictions for all markers

**Acceptance criteria**:
- [ ] List keepits returns all markers with survival history
- [ ] Update weight modifies ORIGINAL session file (per design)
- [ ] Backup created before modifying original file
- [ ] Manifest updated to reflect weight change
- [ ] Decay preview shows threshold and predictions

**Tests required**:
- API test: List keepits
- API test: Update weight (verify original file modified)
- API test: Verify backup created on weight update
- API test: Decay preview

**Dependencies**: Task 3.5

---

## Phase 4: Composition Engine

### Goal: Implement multi-session composition with version selection

### Prerequisites: Phase 2, Phase 3 complete

---

#### Task 4.1: Version Selection Algorithm

**Estimated effort**: 3 hours

**Files to create/modify**:
- `backend/src/services/memory-composition.js` - Create new file

**Implementation details**:
1. Implement version scoring from design doc:
```javascript
export function scoreVersion(version, criteria) {
  let score = 1.0;

  // Token budget fit (most important)
  if (criteria.maxTokens) {
    if (version.outputTokens > criteria.maxTokens) {
      score *= 0.1; // Over budget penalty
    } else {
      const utilization = version.outputTokens / criteria.maxTokens;
      score *= 0.5 + (utilization * 0.5);
    }
  }

  // Ratio preference
  if (criteria.preferredRatio) {
    const ratioDiff = Math.abs(version.compressionRatio - criteria.preferredRatio);
    score *= Math.max(0.5, 1 - (ratioDiff / 50));
  }

  // Keepit preservation
  if (criteria.preserveKeepits && version.keepitStats) {
    const total = version.keepitStats.preserved + version.keepitStats.summarized;
    const rate = total > 0 ? version.keepitStats.preserved / total : 1;
    score *= 0.5 + (rate * 0.5);
  }

  return score;
}

export function selectBestVersion(session, criteria) {
  // If no versions, need new compression
  if (!session.compressions || session.compressions.length === 0) {
    return 'need-new-compression';
  }

  // If original fits, use it
  if (!criteria.maxTokens || session.originalTokens <= criteria.maxTokens) {
    return 'original';
  }

  // Score and select
  const scored = session.compressions
    .map(v => ({ version: v, score: scoreVersion(v, criteria) }))
    .sort((a, b) => b.score - a.score);

  return scored[0].score >= 0.5 ? scored[0].version : 'need-new-compression';
}
```

**Acceptance criteria**:
- [ ] Scoring weights token budget highest
- [ ] Original selected if it fits budget
- [ ] Need-new-compression returned when no suitable version exists

**Tests required**:
- Unit test: Scoring with various criteria
- Unit test: Best version selection scenarios

**Dependencies**: Task 2.2

---

#### Task 4.2: Token Budget Allocation

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/services/memory-composition.js` - Add allocation logic

**Implementation details**:
1. Implement budget allocation strategies:
```javascript
export function allocateTokenBudget(components, totalBudget, strategy = 'equal') {
  switch (strategy) {
    case 'equal':
      return components.map(() => Math.floor(totalBudget / components.length));

    case 'proportional':
      // Allocate based on original session sizes
      const totalOriginal = components.reduce((sum, c) => sum + c.originalTokens, 0);
      return components.map(c =>
        Math.floor((c.originalTokens / totalOriginal) * totalBudget)
      );

    case 'recency':
      // More budget to recent sessions
      const weights = components.map((_, i) => components.length - i);
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      return weights.map(w => Math.floor((w / totalWeight) * totalBudget));

    default:
      throw new Error(`Unknown allocation strategy: ${strategy}`);
  }
}
```

**Acceptance criteria**:
- [ ] Equal allocation divides evenly
- [ ] Proportional respects original sizes
- [ ] Recency gives more to recent sessions

**Tests required**:
- Unit test: Each allocation strategy
- Unit test: Budget totals match input

**Dependencies**: Task 4.1

---

#### Task 4.3: Multi-Session Composition Logic

**Estimated effort**: 4 hours

**Files to create/modify**:
- `backend/src/services/memory-composition.js` - Add composition logic

**Implementation details**:
1. Implement `composeContext(projectId, request)`:
```javascript
export async function composeContext(projectId, request) {
  const { name, components, totalTokenBudget, outputFormat } = request;
  const manifest = await loadManifest(projectId);

  // Allocate budget
  const allocations = allocateTokenBudget(
    components.map(c => manifest.sessions[c.sessionId]),
    totalTokenBudget,
    request.allocationStrategy || 'equal'
  );

  const selectedComponents = [];

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    const session = manifest.sessions[comp.sessionId];
    const budget = allocations[i];

    let selectedVersion;

    if (comp.versionId && comp.versionId !== 'auto') {
      selectedVersion = session.compressions.find(v => v.versionId === comp.versionId);
    } else if (comp.recompressSettings) {
      selectedVersion = await createCompressionVersion(projectId, comp.sessionId, {
        ...comp.recompressSettings,
        sessionDistance: i + 1
      });
    } else {
      selectedVersion = selectBestVersion(session, {
        maxTokens: budget,
        preserveKeepits: true
      });

      if (selectedVersion === 'need-new-compression') {
        selectedVersion = await createCompressionVersion(projectId, comp.sessionId, {
          mode: 'uniform',
          compactionRatio: Math.ceil(session.originalTokens / budget),
          aggressiveness: 'moderate',
          model: request.model || 'opus',
          sessionDistance: i + 1
        });
      }
    }

    selectedComponents.push({
      sessionId: comp.sessionId,
      versionId: selectedVersion === 'original' ? 'original' : selectedVersion.versionId,
      order: i,
      tokenContribution: selectedVersion === 'original'
        ? session.originalTokens
        : selectedVersion.outputTokens
    });
  }

  // Generate output files
  const outputPath = await generateComposedOutput(projectId, name, selectedComponents, outputFormat);

  // Create composition record
  const record = {
    compositionId: generateUuid(),
    name,
    createdAt: new Date().toISOString(),
    components: selectedComponents,
    outputFile: outputPath,
    totalTokens: selectedComponents.reduce((sum, c) => sum + c.tokenContribution, 0),
    totalMessages: 0, // Calculate from actual output
    usedInSessions: []
  };

  // Save to manifest
  manifest.compositions[record.compositionId] = record;
  await saveManifest(projectId, manifest);

  return record;
}
```

**Acceptance criteria**:
- [ ] Composition selects appropriate versions
- [ ] On-demand compression created when needed
- [ ] Output files generated correctly
- [ ] Composition record saved to manifest

**Tests required**:
- Integration test: Compose with existing versions
- Integration test: Compose triggering new compression
- Integration test: Mixed auto and specific versions

**Dependencies**: Task 4.2, Task 2.2

---

#### Task 4.4: Output Generation (MD/JSONL)

**Estimated effort**: 3 hours

**Files to create/modify**:
- `backend/src/services/memory-composition.js` - Add output generation
- `backend/src/utils/markdown-export.js` - Reuse existing patterns

**Implementation details**:
1. Implement `generateComposedOutput(projectId, name, components, format)`:
   - Create composition directory: `composed/{name}/`
   - For each component, read version content
   - Concatenate with clear session boundaries
   - Generate both .md and .jsonl if format='both'
2. Add session headers in markdown:
```markdown
---
## Session: {sessionId}
### Date: {timestamp} | Tokens: {tokenCount} | Compression: {ratio}
---

{content}
```
3. For JSONL, merge message arrays with metadata

**Acceptance criteria**:
- [ ] Markdown output has clear session boundaries
- [ ] JSONL output is valid and can be parsed
- [ ] composition.json metadata file created

**Tests required**:
- Unit test: Markdown generation with headers
- Unit test: JSONL merging
- Integration test: Full output generation

**Dependencies**: Task 4.3

---

#### Task 4.5: Composition API Endpoints

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add composition endpoints

**Implementation details**:
1. Implement `POST /api/memory/projects/:projectId/compositions`:
   - Request body matches CompositionRequest schema
   - Returns ComposedContextRecord
2. Implement `GET /api/memory/projects/:projectId/compositions`:
   - List all compositions for project
3. Implement `GET /api/memory/compositions/:compositionId`:
   - Return composition details with download URLs
4. Implement `DELETE /api/memory/compositions/:compositionId`:
   - Delete composition files and manifest entry

**Acceptance criteria**:
- [ ] Create composition endpoint works
- [ ] List returns all compositions
- [ ] Delete removes files and record

**Tests required**:
- API test: Create composition
- API test: List compositions
- API test: Delete composition

**Dependencies**: Task 4.4

---

## Phase 5: Backend API Completion

### Goal: Complete all remaining backend endpoints and error handling

### Prerequisites: Phase 4 complete

---

#### Task 5.0: Concurrent Operation Handling

**Estimated effort**: 3 hours

**Files to create/modify**:
- `backend/src/services/memory-lock.js` - Create new file
- `backend/src/services/memory-versions.js` - Add lock integration
- `backend/src/services/memory-manifest.js` - Add lock integration

**Implementation details**:
1. Create operation lock manager:
```javascript
import { Lock } from 'proper-lockfile';

// Track in-progress operations per session
const operationLocks = new Map();

export async function acquireSessionLock(sessionId, operation) {
  const lockKey = `${sessionId}:${operation}`;

  if (operationLocks.has(lockKey)) {
    throw new CompressionInProgressError(sessionId);
  }

  operationLocks.set(lockKey, {
    startedAt: new Date().toISOString(),
    operation
  });

  return {
    release: () => operationLocks.delete(lockKey)
  };
}

export async function acquireManifestLock(projectId) {
  const manifestPath = getManifestPath(projectId);
  return Lock(manifestPath, {
    retries: {
      retries: 5,
      factor: 2,
      minTimeout: 100,
      maxTimeout: 1000
    },
    stale: 30000 // Consider stale after 30s
  });
}

export function getActiveOperations(sessionId) {
  const active = [];
  for (const [key, value] of operationLocks) {
    if (key.startsWith(sessionId)) {
      active.push(value);
    }
  }
  return active;
}
```
2. Wrap compression creation with session lock
3. Wrap manifest writes with file lock
4. Return 409 Conflict if operation already in progress
5. Add timeout handling for stale locks

**Acceptance criteria**:
- [ ] Concurrent compressions for same session are blocked
- [ ] Concurrent manifest writes are serialized
- [ ] Clear error message when operation in progress
- [ ] Stale locks are automatically released
- [ ] Active operations can be queried

**Tests required**:
- Unit test: Lock acquisition and release
- Integration test: Concurrent compression attempts
- Integration test: Stale lock recovery
- Stress test: Rapid concurrent operations

**Dependencies**: Task 2.2, Task 1.3

---

#### Task 5.1: Error Handling Middleware

**Estimated effort**: 3 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add error handling
- `backend/src/services/memory-errors.js` - Create new file

**Implementation details**:
1. Create custom error classes with standardized response format:
```javascript
export class MemoryError extends Error {
  constructor(message, code, statusCode = 500, details = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toResponse() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details
      }
    };
  }
}

export class SessionNotFoundError extends MemoryError {
  constructor(sessionId) {
    super(`Session ${sessionId} not found`, 'SESSION_NOT_FOUND', 404, { sessionId });
  }
}

export class SessionAlreadyRegisteredError extends MemoryError {
  constructor(sessionId) {
    super(`Session ${sessionId} is already registered`, 'SESSION_ALREADY_REGISTERED', 409, { sessionId });
  }
}

export class VersionNotFoundError extends MemoryError {
  constructor(sessionId, versionId) {
    super(`Version ${versionId} not found for session ${sessionId}`, 'VERSION_NOT_FOUND', 404, { sessionId, versionId });
  }
}

export class CompressionInProgressError extends MemoryError {
  constructor(sessionId) {
    super(`Compression already in progress for session ${sessionId}`, 'COMPRESSION_IN_PROGRESS', 409, { sessionId });
  }
}

export class InvalidSettingsError extends MemoryError {
  constructor(message, validationErrors) {
    super(message, 'INVALID_SETTINGS', 400, { validationErrors });
  }
}

export class KeepitNotFoundError extends MemoryError {
  constructor(markerId) {
    super(`Keepit marker ${markerId} not found`, 'KEEPIT_NOT_FOUND', 404, { markerId });
  }
}

export class DiskSpaceError extends MemoryError {
  constructor(requiredBytes, availableBytes) {
    super('Insufficient disk space', 'DISK_SPACE_EXHAUSTED', 507, { requiredBytes, availableBytes });
  }
}

export class OriginalFileNotFoundError extends MemoryError {
  constructor(filePath) {
    super(`Original session file not found: ${filePath}`, 'ORIGINAL_FILE_NOT_FOUND', 404, { filePath });
  }
}

export class ManifestCorruptionError extends MemoryError {
  constructor(projectId, reason) {
    super(`Manifest corruption detected for project ${projectId}`, 'MANIFEST_CORRUPTION', 500, { projectId, reason });
  }
}

export class ModelRateLimitError extends MemoryError {
  constructor(retryAfter) {
    super('Model API rate limit exceeded', 'MODEL_RATE_LIMIT', 429, { retryAfter });
  }
}
```
2. Add error handling middleware for memory routes
3. Standardize all error responses to format: `{ error: { code, message, details? } }`

**Acceptance criteria**:
- [ ] Custom errors have appropriate HTTP status codes
- [ ] Error responses follow standard format: `{ error: { code, message, details? } }`
- [ ] Stack traces only in development mode
- [ ] All error scenarios covered (not found, conflict, validation, disk space, etc.)

**Tests required**:
- Unit test: Error class instantiation
- API test: Error response format for each error type
- API test: Stack trace hidden in production

**Dependencies**: None (can be done early)

---

#### Task 5.2: Request Validation Middleware

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/middleware/validation.js` - Create new file
- `backend/src/routes/memory.js` - Apply validation

**Implementation details**:
1. Create validation schemas for all endpoints:
```javascript
import Joi from 'joi'; // or use simple validation

export const compressionSettingsSchema = {
  mode: { type: 'string', enum: ['uniform', 'tiered'], required: true },
  compactionRatio: { type: 'number', min: 2, max: 50 },
  aggressiveness: { type: 'string', enum: ['minimal', 'moderate', 'aggressive'] },
  tierPreset: { type: 'string', enum: ['gentle', 'standard', 'aggressive', 'custom'] },
  customTiers: { type: 'array' },
  model: { type: 'string', default: 'opus' },
  skipFirstMessages: { type: 'number', min: 0, default: 0 },
  keepitMode: { type: 'string', enum: ['decay', 'preserve-all', 'ignore'], default: 'decay' },
  sessionDistance: { type: 'number', min: 1, max: 10, default: 1 }
};
```
2. Apply validation middleware to routes

**Acceptance criteria**:
- [ ] Invalid requests return 400 with clear error messages
- [ ] Valid requests pass through unchanged
- [ ] Default values are applied

**Tests required**:
- Unit test: Schema validation
- API test: Invalid request handling

**Dependencies**: Task 5.1

---

#### Task 5.3: API Documentation and OpenAPI Spec

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add JSDoc comments
- `docs/API.md` - Create API documentation (optional)

**Implementation details**:
1. Add comprehensive JSDoc to all endpoints
2. Document request/response schemas
3. Include example requests and responses

**Acceptance criteria**:
- [ ] All endpoints have JSDoc documentation
- [ ] Request/response schemas documented
- [ ] Error codes documented

**Tests required**: None (documentation task)

**Dependencies**: All API tasks complete

---

#### Task 5.4: Storage Usage Statistics API

**Estimated effort**: 2 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add statistics endpoint
- `backend/src/services/memory-stats.js` - Create new file

**Implementation details**:
1. Implement `GET /api/memory/projects/:projectId/stats`:
```javascript
export async function getProjectStats(projectId) {
  const manifest = await loadManifest(projectId);
  const projectDir = getProjectDir(projectId);

  const stats = {
    projectId,
    sessions: {
      total: Object.keys(manifest.sessions).length,
      withCompressions: 0,
      totalOriginalTokens: 0,
      totalCompressedTokens: 0
    },
    storage: {
      originalsSize: 0,
      summariesSize: 0,
      composedSize: 0,
      totalSize: 0
    },
    compressions: {
      total: 0,
      byMode: { uniform: 0, tiered: 0 },
      averageRatio: 0
    },
    compositions: {
      total: Object.keys(manifest.compositions).length
    },
    keepits: {
      total: 0,
      byWeight: {}
    }
  };

  // Calculate stats from manifest and file system
  for (const session of Object.values(manifest.sessions)) {
    stats.sessions.totalOriginalTokens += session.originalTokens;
    if (session.compressions.length > 0) {
      stats.sessions.withCompressions++;
    }
    stats.compressions.total += session.compressions.length;
    stats.keepits.total += session.keepitMarkers.length;
    // ... etc
  }

  // Get directory sizes
  stats.storage.originalsSize = await getDirSize(path.join(projectDir, 'originals'));
  stats.storage.summariesSize = await getDirSize(path.join(projectDir, 'summaries'));
  stats.storage.composedSize = await getDirSize(path.join(projectDir, 'composed'));
  stats.storage.totalSize = stats.storage.originalsSize +
    stats.storage.summariesSize + stats.storage.composedSize;

  return stats;
}
```
2. Include cache size in global stats
3. Add endpoint for global memory stats across all projects

**Acceptance criteria**:
- [ ] Project stats include session, compression, and keepit counts
- [ ] Storage sizes calculated from file system
- [ ] Compression ratio statistics included
- [ ] Global stats endpoint available

**Tests required**:
- API test: Get project stats
- Unit test: Stats calculation logic

**Dependencies**: Task 1.3, Task 1.6

---

#### Task 5.5: Import/Export Memory Data

**Estimated effort**: 3 hours

**Files to create/modify**:
- `backend/src/routes/memory.js` - Add import/export endpoints
- `backend/src/services/memory-export.js` - Create new file

**Implementation details**:
1. Implement `GET /api/memory/projects/:projectId/export`:
   - Export manifest and all compression files as ZIP
   - Include manifest.json, all summaries, and compositions
   - Option to exclude large files (originals)
2. Implement `POST /api/memory/projects/:projectId/import`:
   - Accept ZIP file upload
   - Validate manifest schema
   - Merge or replace existing data (configurable)
   - Resolve file path conflicts
```javascript
export async function exportProject(projectId, options = {}) {
  const { includeOriginals = false } = options;
  const projectDir = getProjectDir(projectId);
  const archive = archiver('zip');

  archive.file(path.join(projectDir, 'manifest.json'), { name: 'manifest.json' });
  archive.directory(path.join(projectDir, 'summaries'), 'summaries');
  archive.directory(path.join(projectDir, 'composed'), 'composed');

  if (includeOriginals) {
    archive.directory(path.join(projectDir, 'originals'), 'originals');
  }

  return archive;
}

export async function importProject(projectId, zipBuffer, options = {}) {
  const { mode = 'merge' } = options; // 'merge' or 'replace'

  // Extract and validate
  const extracted = await extractZip(zipBuffer);
  const importManifest = JSON.parse(extracted['manifest.json']);

  // Validate schema version
  if (!isCompatibleVersion(importManifest.version)) {
    throw new InvalidImportError('Incompatible manifest version');
  }

  // Merge or replace
  if (mode === 'replace') {
    await clearProjectData(projectId);
  }

  // Import files and update manifest
  // ...
}
```

**Acceptance criteria**:
- [ ] Export creates valid ZIP with all memory data
- [ ] Import validates manifest before processing
- [ ] Merge mode preserves existing data
- [ ] Replace mode clears before import
- [ ] File path conflicts handled gracefully

**Tests required**:
- API test: Export project
- API test: Import project (merge mode)
- API test: Import project (replace mode)
- Unit test: Manifest validation on import

**Dependencies**: Task 1.3, Task 5.1

---

## Phase 6: Frontend - Memory Store

### Goal: Create Pinia store for memory system state management

### Prerequisites: Phase 5 complete (backend APIs available)

---

#### Task 6.1: Memory Store - Basic Structure

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/stores/memory.js` - Create new file

**Implementation details**:
1. Create Pinia store following existing patterns:
```javascript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useMemoryStore = defineStore('memory', () => {
  // State
  const projects = ref([]);
  const currentProject = ref(null);
  const sessions = ref([]);
  const currentSession = ref(null);
  const versions = ref([]);
  const compositions = ref([]);

  // Loading states
  const loading = ref({
    projects: false,
    sessions: false,
    versions: false,
    compositions: false,
    compression: false
  });

  const error = ref(null);

  // Getters
  const hasProjects = computed(() => projects.value.length > 0);
  const currentSessionVersions = computed(() =>
    currentSession.value ? versions.value : []
  );

  // Actions (implemented in subsequent tasks)
  async function loadProjects() { ... }
  async function loadSessions(projectId) { ... }
  async function loadVersions(sessionId) { ... }

  return {
    projects, currentProject, sessions, currentSession,
    versions, compositions, loading, error,
    hasProjects, currentSessionVersions,
    loadProjects, loadSessions, loadVersions
  };
});
```

**Acceptance criteria**:
- [ ] Store exports all required state
- [ ] Loading states for async operations
- [ ] Error state for error handling

**Tests required**:
- Unit test: Store initialization
- Unit test: Computed properties

**Dependencies**: None (can start when APIs are defined)

---

#### Task 6.2: Memory API Client Functions

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/utils/memory-api.js` - Create new file

**Implementation details**:
1. Create API client functions following existing `api.js` patterns:
```javascript
const API_BASE = '/api/memory';

export async function getMemoryProjects() {
  const response = await fetch(`${API_BASE}/projects`);
  if (!response.ok) throw new Error('Failed to fetch memory projects');
  return response.json();
}

export async function getMemoryProject(projectId) { ... }
export async function registerSession(projectId, sessionId) { ... }
export async function unregisterSession(projectId, sessionId) { ... }

export async function getSessionVersions(sessionId) { ... }
export async function createVersion(sessionId, settings) { ... }
export async function deleteVersion(sessionId, versionId) { ... }
export async function getVersionContent(sessionId, versionId, format) { ... }

export async function previewDecay(sessionId, settings) { ... }
export async function getSessionKeepits(sessionId) { ... }
export async function updateKeepitWeight(sessionId, markerId, weight) { ... }

export async function createComposition(projectId, request) { ... }
export async function getCompositions(projectId) { ... }
export async function deleteComposition(compositionId) { ... }
```

**Acceptance criteria**:
- [ ] All API endpoints have client functions
- [ ] Error handling matches existing patterns
- [ ] Request bodies properly formatted

**Tests required**:
- Mock API tests for each function

**Dependencies**: Task 5.3 (API documentation)

---

#### Task 6.3: Memory Store - Actions Implementation

**Estimated effort**: 3 hours

**Files to create/modify**:
- `frontend/src/stores/memory.js` - Add action implementations

**Implementation details**:
1. Implement all store actions using API client:
```javascript
async function loadProjects() {
  loading.value.projects = true;
  error.value = null;
  try {
    projects.value = await getMemoryProjects();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value.projects = false;
  }
}

async function registerSessionToMemory(projectId, sessionId) {
  loading.value.sessions = true;
  try {
    const session = await registerSession(projectId, sessionId);
    // Update local state
    const project = projects.value.find(p => p.id === projectId);
    if (project) {
      project.sessionCount++;
    }
    sessions.value.push(session);
    return session;
  } catch (err) {
    error.value = err.message;
    throw err;
  } finally {
    loading.value.sessions = false;
  }
}

async function createCompressionVersion(sessionId, settings) {
  loading.value.compression = true;
  try {
    const version = await createVersion(sessionId, settings);
    versions.value.push(version);
    return version;
  } catch (err) {
    error.value = err.message;
    throw err;
  } finally {
    loading.value.compression = false;
  }
}

// ... etc for all actions
```

**Acceptance criteria**:
- [ ] All actions update state correctly
- [ ] Loading states managed properly
- [ ] Errors are captured and surfaced

**Tests required**:
- Unit test: Each action with mocked API

**Dependencies**: Task 6.2

---

## Phase 7: Frontend - Memory Browser UI

### Goal: Create the main Memory Browser interface

### Prerequisites: Phase 6 complete

---

#### Task 7.1: Memory Browser Component - Layout

**Estimated effort**: 3 hours

**Files to create/modify**:
- `frontend/src/components/MemoryBrowser.vue` - Create new file

**Implementation details**:
1. Create two-panel layout matching design mockup:
```vue
<template>
  <div class="memory-browser">
    <div class="memory-header">
      <h2>Memory Browser</h2>
      <div class="project-selector">
        <select v-model="selectedProjectId" @change="loadProjectSessions">
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ p.displayName }}
          </option>
        </select>
      </div>
    </div>

    <div class="memory-content">
      <div class="sessions-panel">
        <SessionList
          :sessions="sessions"
          :selected="selectedSessionId"
          @select="selectSession"
        />
      </div>

      <div class="details-panel">
        <SessionDetails
          v-if="selectedSession"
          :session="selectedSession"
          :versions="versions"
          @create-version="openCompressionDialog"
        />
      </div>
    </div>
  </div>
</template>
```
2. Style to match existing application design

**Acceptance criteria**:
- [ ] Two-panel layout displays correctly
- [ ] Project selector works
- [ ] Sessions list shows memory-registered sessions

**Tests required**:
- Component test: Renders with mock data
- Component test: Project selection updates sessions

**Dependencies**: Task 6.3

---

#### Task 7.2: Session List Component

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/memory/SessionList.vue` - Create new file

**Implementation details**:
1. Create session list with grouping by date:
```vue
<template>
  <div class="session-list">
    <div v-for="(group, month) in groupedSessions" :key="month" class="session-group">
      <h4 class="group-header">{{ month }}</h4>
      <div
        v-for="session in group"
        :key="session.sessionId"
        class="session-item"
        :class="{ selected: session.sessionId === selected, 'has-versions': session.compressions.length > 0 }"
        @click="$emit('select', session.sessionId)"
      >
        <span class="session-indicator" :title="session.compressions.length + ' versions'">
          {{ session.compressions.length > 0 ? '[M]' : '[ ]' }}
        </span>
        <span class="session-id">{{ session.sessionId.substring(0, 8) }}</span>
        <span class="session-tokens">{{ formatTokens(session.originalTokens) }}</span>
      </div>
    </div>
  </div>
</template>
```
2. Group sessions by month
3. Show version count indicator

**Acceptance criteria**:
- [ ] Sessions grouped by month
- [ ] Version indicator shows for sessions with compressions
- [ ] Selection emits event

**Tests required**:
- Component test: Grouping logic
- Component test: Selection event

**Dependencies**: Task 7.1

---

#### Task 7.3: Session Details Component

**Estimated effort**: 3 hours

**Files to create/modify**:
- `frontend/src/components/memory/SessionDetails.vue` - Create new file

**Implementation details**:
1. Display session metadata and versions:
```vue
<template>
  <div class="session-details">
    <h3>{{ session.sessionId.substring(0, 8) }}...</h3>

    <div class="metadata-section">
      <div class="meta-row">
        <span class="label">Original:</span>
        <span>{{ formatTokens(session.originalTokens) }} tokens | {{ session.originalMessages }} messages</span>
      </div>
      <div class="meta-row">
        <span class="label">Date:</span>
        <span>{{ formatDate(session.firstTimestamp) }}</span>
      </div>
      <div class="meta-row">
        <span class="label">Registered:</span>
        <span>{{ formatDate(session.registeredAt) }}</span>
      </div>
    </div>

    <div class="versions-section">
      <h4>Compressions</h4>
      <VersionList
        :versions="versions"
        @view="viewVersion"
        @delete="confirmDeleteVersion"
      />
      <button class="btn-create" @click="$emit('create-version')">
        + Create Compression
      </button>
    </div>

    <div class="keepits-section">
      <h4>Keepit Markers ({{ session.keepitMarkers.length }})</h4>
      <KeepitList :markers="session.keepitMarkers" />
    </div>

    <div class="actions-section">
      <button @click="viewOriginal">View Original</button>
    </div>
  </div>
</template>
```

**Acceptance criteria**:
- [ ] Shows all session metadata
- [ ] Lists compression versions
- [ ] Shows keepit marker summary

**Tests required**:
- Component test: Renders session details
- Component test: Actions emit events

**Dependencies**: Task 7.2

---

#### Task 7.4: Version List Component

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/memory/VersionList.vue` - Create new file

**Implementation details**:
1. Display compression versions with actions:
```vue
<template>
  <div class="version-list">
    <div v-for="version in versions" :key="version.versionId" class="version-item">
      <div class="version-info">
        <span class="version-id">{{ version.versionId }}</span>
        <span class="version-mode">{{ version.settings.mode }}-{{ version.settings.tierPreset || version.settings.aggressiveness }}</span>
        <span class="version-tokens">{{ formatTokens(version.outputTokens) }}</span>
        <span class="version-ratio">{{ version.compressionRatio.toFixed(1) }}:1</span>
      </div>
      <div class="version-actions">
        <button @click="$emit('view', version)" title="View content">
          <ViewIcon />
        </button>
        <button @click="$emit('delete', version)" title="Delete version">
          <DeleteIcon />
        </button>
      </div>
    </div>
    <div v-if="versions.length === 0" class="no-versions">
      No compression versions yet
    </div>
  </div>
</template>
```

**Acceptance criteria**:
- [ ] Lists all versions with metadata
- [ ] View and delete actions work
- [ ] Empty state shown when no versions

**Tests required**:
- Component test: Renders version list
- Component test: Actions emit correct events

**Dependencies**: Task 7.3

---

#### Task 7.5: Create Compression Dialog

**Estimated effort**: 3 hours

**Files to create/modify**:
- `frontend/src/components/memory/CreateCompressionDialog.vue` - Create new file

**Implementation details**:
1. Modal dialog for compression settings (reuse existing SanitizationPanel patterns):
```vue
<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="compression-dialog">
      <h3>Create Compression - {{ sessionId }}</h3>

      <div class="original-info">
        Original: {{ formatTokens(originalTokens) }} | {{ originalMessages }} messages
      </div>

      <div class="mode-toggle">
        <label :class="{ active: !useTiers }">
          <input type="radio" :value="false" v-model="useTiers" />
          Uniform
        </label>
        <label :class="{ active: useTiers }">
          <input type="radio" :value="true" v-model="useTiers" />
          Variable (Tiered)
        </label>
      </div>

      <!-- Uniform settings -->
      <div v-if="!useTiers" class="uniform-settings">
        <!-- Similar to SanitizationPanel -->
      </div>

      <!-- Tiered settings -->
      <div v-else class="tiered-settings">
        <!-- Similar to SanitizationPanel -->
      </div>

      <!-- Keepit handling -->
      <div class="keepit-settings">
        <label>Session Distance:</label>
        <input type="number" v-model.number="sessionDistance" min="1" max="10" />

        <div class="decay-preview" v-if="decayPreview">
          <span>Markers: {{ decayPreview.total }} | Will preserve: {{ decayPreview.surviving }}</span>
        </div>
      </div>

      <!-- Preview -->
      <div v-if="preview" class="compression-preview">
        <div>Estimated output: ~{{ preview.estimatedTokens }} tokens</div>
        <div>Compression ratio: ~{{ preview.estimatedRatio }}:1</div>
      </div>

      <div class="dialog-actions">
        <button @click="$emit('close')">Cancel</button>
        <button @click="createCompression" :disabled="creating">
          {{ creating ? 'Creating...' : 'Create Compression' }}
        </button>
      </div>
    </div>
  </div>
</template>
```

**Acceptance criteria**:
- [ ] Settings match SanitizationPanel patterns
- [ ] Decay preview shows keepit survival
- [ ] Creates compression on submit

**Tests required**:
- Component test: Settings changes
- Component test: Form submission

**Dependencies**: Task 7.4

---

#### Task 7.6: Version Comparison View

**Estimated effort**: 3 hours

**Files to create/modify**:
- `frontend/src/components/memory/VersionComparisonDialog.vue` - Create new file

**Implementation details**:
1. Create side-by-side comparison dialog:
```vue
<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="version-comparison">
      <h3>Compare Versions - {{ sessionId }}</h3>

      <div class="comparison-header">
        <div class="version-select left">
          <label>Version A:</label>
          <select v-model="versionA">
            <option value="original">Original ({{ formatTokens(session.originalTokens) }})</option>
            <option v-for="v in versions" :key="v.versionId" :value="v.versionId">
              {{ v.versionId }} - {{ formatTokens(v.outputTokens) }}
            </option>
          </select>
        </div>
        <div class="version-select right">
          <label>Version B:</label>
          <select v-model="versionB">
            <option value="original">Original ({{ formatTokens(session.originalTokens) }})</option>
            <option v-for="v in versions" :key="v.versionId" :value="v.versionId">
              {{ v.versionId }} - {{ formatTokens(v.outputTokens) }}
            </option>
          </select>
        </div>
      </div>

      <div class="comparison-stats">
        <div class="stat">
          <span class="label">Token difference:</span>
          <span :class="tokenDiffClass">{{ tokenDiff }}</span>
        </div>
        <div class="stat">
          <span class="label">Keepits preserved:</span>
          <span>{{ keepitComparison }}</span>
        </div>
      </div>

      <div class="comparison-content">
        <div class="content-panel left">
          <div class="content-text" v-html="highlightedContentA"></div>
        </div>
        <div class="content-panel right">
          <div class="content-text" v-html="highlightedContentB"></div>
        </div>
      </div>

      <div class="dialog-actions">
        <button @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
```
2. Highlight differences between versions
3. Show keepit preservation comparison
4. Add token count and ratio comparison

**Acceptance criteria**:
- [ ] Side-by-side comparison of any two versions
- [ ] Original can be compared against compressions
- [ ] Token counts and differences displayed
- [ ] Keepit preservation comparison shown

**Tests required**:
- Component test: Version selection
- Component test: Difference highlighting

**Dependencies**: Task 7.4, Task 2.4

---

#### Task 7.7: Bulk Version Management

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/memory/BulkVersionManager.vue` - Create new file

**Implementation details**:
1. Add bulk selection and management UI:
```vue
<template>
  <div class="bulk-version-manager">
    <div class="bulk-header">
      <label class="select-all">
        <input type="checkbox" v-model="selectAll" @change="toggleAll" />
        Select All
      </label>
      <span class="selected-count" v-if="selectedVersions.length > 0">
        {{ selectedVersions.length }} selected
        ({{ formatBytes(selectedSize) }})
      </span>
    </div>

    <div class="version-list">
      <div
        v-for="version in versions"
        :key="version.versionId"
        class="version-row"
        :class="{ selected: isSelected(version) }"
      >
        <input
          type="checkbox"
          :checked="isSelected(version)"
          @change="toggleVersion(version)"
        />
        <span class="version-id">{{ version.versionId }}</span>
        <span class="version-mode">{{ version.settings.mode }}</span>
        <span class="version-tokens">{{ formatTokens(version.outputTokens) }}</span>
        <span class="version-date">{{ formatDate(version.createdAt) }}</span>
        <span class="version-used" :class="{ 'in-use': version.usedInCompositions > 0 }">
          {{ version.usedInCompositions > 0 ? 'In use' : 'Unused' }}
        </span>
      </div>
    </div>

    <div class="bulk-actions">
      <button
        @click="deleteSelected"
        :disabled="selectedVersions.length === 0 || hasInUseVersions"
        class="btn-danger"
      >
        Delete Selected
      </button>
      <span v-if="hasInUseVersions" class="warning">
        Cannot delete versions in use by compositions
      </span>
    </div>
  </div>
</template>
```
2. Show usage tracking (which compositions use each version)
3. Prevent deletion of in-use versions without force flag
4. Calculate and display total size of selected versions

**Acceptance criteria**:
- [ ] Multi-select versions for bulk operations
- [ ] Usage tracking displayed per version
- [ ] Bulk delete with confirmation
- [ ] In-use versions protected from deletion

**Tests required**:
- Component test: Selection logic
- Component test: Bulk delete flow

**Dependencies**: Task 7.4, Task 2.6

---

## Phase 8: Frontend - Composition Builder UI

### Goal: Create the visual composition builder interface

### Prerequisites: Phase 7 complete

---

#### Task 8.1: Composition Builder Component - Layout

**Estimated effort**: 3 hours

**Files to create/modify**:
- `frontend/src/components/memory/CompositionBuilder.vue` - Create new file

**Implementation details**:
1. Create composition builder matching design mockup:
```vue
<template>
  <div class="composition-builder">
    <div class="builder-header">
      <h3>Compose Context</h3>
      <input v-model="compositionName" placeholder="Composition name..." />
    </div>

    <div class="budget-section">
      <label>Token Budget:</label>
      <input type="number" v-model.number="totalBudget" />
      <div class="budget-bar">
        <div
          class="budget-used"
          :style="{ width: (usedTokens / totalBudget * 100) + '%' }"
        ></div>
      </div>
      <span>{{ usedTokens }} / {{ totalBudget }} tokens</span>
    </div>

    <div class="components-section">
      <h4>Components</h4>
      <ComponentsList
        :components="components"
        @update="updateComponent"
        @remove="removeComponent"
        @reorder="reorderComponents"
      />
      <button @click="openSessionPicker">+ Add Session</button>
    </div>

    <div class="output-section">
      <label>Output Format:</label>
      <div class="format-options">
        <label><input type="checkbox" v-model="outputMarkdown" /> Markdown</label>
        <label><input type="checkbox" v-model="outputJsonl" /> JSONL</label>
      </div>
    </div>

    <div class="builder-actions">
      <button @click="previewComposition">Preview</button>
      <button @click="createComposition" :disabled="!canCreate">
        Compose
      </button>
    </div>
  </div>
</template>
```

**Acceptance criteria**:
- [ ] Budget visualization works
- [ ] Components can be added/removed/reordered
- [ ] Output format selection works

**Tests required**:
- Component test: Budget calculation
- Component test: Component management

**Dependencies**: Task 7.5

---

#### Task 8.2: Component Item in Builder

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/memory/CompositionComponent.vue` - Create new file

**Implementation details**:
1. Individual component card:
```vue
<template>
  <div class="composition-component" :class="{ dragging }">
    <div class="drag-handle" @mousedown="startDrag">⋮⋮</div>

    <div class="component-info">
      <span class="session-name">{{ component.sessionId.substring(0, 8) }}...</span>
      <span class="session-date">{{ formatDate(session.firstTimestamp) }}</span>
    </div>

    <div class="version-selector">
      <select v-model="selectedVersion" @change="updateVersion">
        <option value="auto">Auto-select</option>
        <option v-for="v in availableVersions" :key="v.versionId" :value="v.versionId">
          {{ v.versionId }} - {{ formatTokens(v.outputTokens) }}
        </option>
        <option value="recompress">Recompress...</option>
      </select>
    </div>

    <div class="allocation">
      <input
        type="number"
        v-model.number="tokenAllocation"
        @change="updateAllocation"
      />
      <span>tokens</span>
    </div>

    <button class="remove-btn" @click="$emit('remove')">×</button>
  </div>
</template>
```

**Acceptance criteria**:
- [ ] Version selection works
- [ ] Token allocation editable
- [ ] Drag handle for reordering

**Tests required**:
- Component test: Version selection
- Component test: Allocation changes

**Dependencies**: Task 8.1

---

#### Task 8.3: Token Budget Visualization

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/memory/TokenBudgetBar.vue` - Create new file

**Implementation details**:
1. Visual bar showing budget allocation:
```vue
<template>
  <div class="token-budget-bar">
    <div class="bar-container">
      <div
        v-for="(segment, idx) in segments"
        :key="idx"
        class="bar-segment"
        :style="{
          width: segment.width + '%',
          backgroundColor: segment.color
        }"
        :title="segment.label"
      ></div>
    </div>
    <div class="bar-legend">
      <span v-for="(segment, idx) in segments" :key="idx">
        <span class="legend-color" :style="{ backgroundColor: segment.color }"></span>
        {{ segment.label }}: {{ segment.tokens }}
      </span>
    </div>
  </div>
</template>
```
2. Color-code by session
3. Show remaining/overflow

**Acceptance criteria**:
- [ ] Visual bar updates with allocation changes
- [ ] Overflow shown in red
- [ ] Legend shows breakdown

**Tests required**:
- Component test: Segment calculation
- Component test: Overflow handling

**Dependencies**: Task 8.2

---

#### Task 8.4: Session Picker Dialog

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/memory/SessionPickerDialog.vue` - Create new file

**Implementation details**:
1. Dialog to select sessions to add:
```vue
<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="session-picker">
      <h3>Add Session to Composition</h3>

      <div class="search-bar">
        <input v-model="search" placeholder="Search sessions..." />
      </div>

      <div class="sessions-list">
        <div
          v-for="session in filteredSessions"
          :key="session.sessionId"
          class="session-option"
          :class="{ selected: isSelected(session), disabled: isAlreadyAdded(session) }"
          @click="toggleSelection(session)"
        >
          <span class="session-id">{{ session.sessionId.substring(0, 8) }}</span>
          <span class="session-date">{{ formatDate(session.firstTimestamp) }}</span>
          <span class="session-tokens">{{ formatTokens(session.originalTokens) }}</span>
          <span v-if="session.compressions.length > 0" class="version-count">
            {{ session.compressions.length }} versions
          </span>
        </div>
      </div>

      <div class="dialog-actions">
        <button @click="$emit('close')">Cancel</button>
        <button @click="addSelected" :disabled="selectedSessions.length === 0">
          Add {{ selectedSessions.length }} Session(s)
        </button>
      </div>
    </div>
  </div>
</template>
```

**Acceptance criteria**:
- [ ] Lists available sessions
- [ ] Search/filter works
- [ ] Multi-select supported

**Tests required**:
- Component test: Filtering
- Component test: Selection

**Dependencies**: Task 8.3

---

#### Task 8.5: Composition Preview

**Estimated effort**: 3 hours

**Files to create/modify**:
- `frontend/src/components/memory/CompositionPreview.vue` - Create new file

**Implementation details**:
1. Create preview dialog shown before composition creation:
```vue
<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="composition-preview">
      <h3>Composition Preview</h3>

      <div class="preview-summary">
        <div class="summary-row">
          <span class="label">Name:</span>
          <span>{{ compositionName }}</span>
        </div>
        <div class="summary-row">
          <span class="label">Components:</span>
          <span>{{ components.length }} sessions</span>
        </div>
        <div class="summary-row">
          <span class="label">Total Tokens:</span>
          <span :class="{ 'over-budget': totalTokens > budget }">
            {{ formatTokens(totalTokens) }} / {{ formatTokens(budget) }}
          </span>
        </div>
      </div>

      <div class="warnings" v-if="warnings.length > 0">
        <h4>Warnings</h4>
        <ul>
          <li v-for="(warning, idx) in warnings" :key="idx" class="warning">
            {{ warning }}
          </li>
        </ul>
      </div>

      <div class="component-breakdown">
        <h4>Component Breakdown</h4>
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Session</th>
              <th>Version</th>
              <th>Tokens</th>
              <th>Keepits</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(comp, idx) in previewComponents" :key="idx">
              <td>{{ idx + 1 }}</td>
              <td>{{ comp.sessionId.substring(0, 8) }}...</td>
              <td>{{ comp.versionId }}</td>
              <td>{{ formatTokens(comp.tokenContribution) }}</td>
              <td>{{ comp.keepitStats?.preserved || 0 }} preserved</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="content-preview" v-if="showContentPreview">
        <h4>Content Preview (first 1000 chars)</h4>
        <pre class="preview-content">{{ contentPreview }}</pre>
      </div>

      <div class="dialog-actions">
        <button @click="$emit('close')">Cancel</button>
        <label>
          <input type="checkbox" v-model="showContentPreview" />
          Show content preview
        </label>
        <button
          @click="$emit('confirm')"
          :disabled="hasErrors"
          class="btn-primary"
        >
          Create Composition
        </button>
      </div>
    </div>
  </div>
</template>
```
2. Calculate and display:
   - Total token count
   - Over-budget warnings
   - Missing version warnings
   - Keepit preservation summary
3. Optional content preview (first N characters of combined output)

**Acceptance criteria**:
- [ ] Preview shows all components with token contributions
- [ ] Warnings displayed for over-budget or missing versions
- [ ] Optional content preview available
- [ ] Cannot proceed if critical errors exist

**Tests required**:
- Component test: Preview calculation
- Component test: Warning generation
- Component test: Content preview toggle

**Dependencies**: Task 8.1, Task 4.3

---

#### Task 8.6: Allocation Strategy Selector

**Estimated effort**: 1 hour

**Files to create/modify**:
- `frontend/src/components/memory/AllocationStrategySelector.vue` - Create new file

**Implementation details**:
1. Create dropdown/toggle for allocation strategy:
```vue
<template>
  <div class="allocation-strategy">
    <label>Token Allocation Strategy:</label>
    <select v-model="strategy" @change="$emit('update:strategy', strategy)">
      <option value="equal">Equal - Same tokens per session</option>
      <option value="proportional">Proportional - Based on original size</option>
      <option value="recency">Recency - More tokens to recent sessions</option>
      <option value="manual">Manual - Custom allocation</option>
    </select>

    <div class="strategy-description">
      <p v-if="strategy === 'equal'">
        Each session gets {{ formatTokens(budget / componentCount) }} tokens.
      </p>
      <p v-else-if="strategy === 'proportional'">
        Larger sessions get proportionally more tokens.
      </p>
      <p v-else-if="strategy === 'recency'">
        Recent sessions prioritized. Oldest gets least.
      </p>
      <p v-else-if="strategy === 'manual'">
        Adjust each component's allocation manually below.
      </p>
    </div>
  </div>
</template>
```

**Acceptance criteria**:
- [ ] All three strategies selectable
- [ ] Manual mode enables per-component editing
- [ ] Strategy description shown

**Tests required**:
- Component test: Strategy selection

**Dependencies**: Task 8.1

---

## Phase 9: Frontend - Keepit Editor

### Goal: Create UI for viewing and editing keepit markers

### Prerequisites: Phase 8 complete

---

#### Task 9.1: Keepit List Component

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/memory/KeepitList.vue` - Create new file

**Implementation details**:
1. List keepit markers with weight badges:
```vue
<template>
  <div class="keepit-list">
    <div
      v-for="marker in markers"
      :key="marker.markerId"
      class="keepit-item"
      :class="'weight-' + getWeightClass(marker.weight)"
    >
      <span class="weight-badge">{{ marker.weight.toFixed(2) }}</span>
      <div class="keepit-content">
        <span class="content-preview">{{ marker.content.substring(0, 100) }}...</span>
        <span class="context-info">in message {{ marker.messageUuid.substring(0, 8) }}</span>
      </div>
      <div class="survival-info">
        <span v-if="marker.survivedIn.length > 0" class="survived">
          Survived: {{ marker.survivedIn.length }}
        </span>
        <span v-if="marker.summarizedIn.length > 0" class="summarized">
          Summarized: {{ marker.summarizedIn.length }}
        </span>
      </div>
      <button @click="$emit('edit', marker)">Edit</button>
    </div>
  </div>
</template>
```

**Acceptance criteria**:
- [ ] Shows all markers with weights
- [ ] Color-coded by weight level
- [ ] Survival history shown

**Tests required**:
- Component test: Rendering markers
- Component test: Weight class assignment

**Dependencies**: Task 7.3

---

#### Task 9.2: Keepit Editor Dialog

**Estimated effort**: 3 hours

**Files to create/modify**:
- `frontend/src/components/memory/KeepitEditor.vue` - Create new file

**Implementation details**:
1. Dialog for editing keepit weight with decay preview:
```vue
<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="keepit-editor">
      <h3>Edit Keepit Marker</h3>

      <div class="content-preview">
        <label>Content:</label>
        <div class="content-text">{{ marker.content }}</div>
      </div>

      <div class="weight-editor">
        <label>Weight:</label>
        <input
          type="number"
          v-model.number="weight"
          min="0"
          max="1"
          step="0.05"
        />
        <div class="weight-slider">
          <input type="range" v-model.number="weight" min="0" max="1" step="0.01" />
        </div>
        <div class="preset-buttons">
          <button
            v-for="(value, name) in presets"
            :key="name"
            @click="weight = value"
            :class="{ active: weight === value }"
          >
            {{ name }}
          </button>
        </div>
      </div>

      <div class="decay-preview">
        <h4>Decay Preview</h4>
        <table>
          <tr>
            <th>Distance</th>
            <th>30:1</th>
            <th>50:1</th>
          </tr>
          <tr v-for="d in [1, 5, 10]" :key="d">
            <td>{{ d }}</td>
            <td :class="survives(d, 30) ? 'survives' : 'summarized'">
              {{ survives(d, 30) ? 'SURVIVES' : 'Summarized' }}
            </td>
            <td :class="survives(d, 50) ? 'survives' : 'summarized'">
              {{ survives(d, 50) ? 'SURVIVES' : 'Summarized' }}
            </td>
          </tr>
        </table>
      </div>

      <div class="dialog-actions">
        <button @click="$emit('close')">Cancel</button>
        <button @click="saveWeight">Save Weight</button>
      </div>
    </div>
  </div>
</template>
```

**Acceptance criteria**:
- [ ] Weight editable via input and slider
- [ ] Preset buttons work
- [ ] Decay preview updates in real-time

**Tests required**:
- Component test: Weight editing
- Component test: Decay calculation display

**Dependencies**: Task 9.1

---

#### Task 9.3: Message Keepit Highlighting

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/SessionViewer.vue` - Add keepit highlighting
- `frontend/src/components/memory/KeepitHighlight.vue` - Create new file

**Implementation details**:
1. Add keepit detection and highlighting in message display:
```vue
<!-- In message content rendering -->
<template>
  <span v-for="(segment, idx) in parsedContent" :key="idx">
    <span v-if="segment.type === 'text'">{{ segment.text }}</span>
    <span
      v-else-if="segment.type === 'keepit'"
      class="keepit-highlight"
      :class="'weight-' + getWeightClass(segment.weight)"
      :title="'Keepit weight: ' + segment.weight"
    >
      <span class="keepit-badge">{{ segment.weight.toFixed(2) }}</span>
      {{ segment.content }}
    </span>
  </span>
</template>
```
2. Parse message content to detect keepit patterns
3. Apply visual highlighting with weight indication

**Acceptance criteria**:
- [ ] Keepits highlighted in message view
- [ ] Weight shown on hover/badge
- [ ] Color-coded by weight level

**Tests required**:
- Component test: Content parsing
- Component test: Highlighting display

**Dependencies**: Task 3.1 (pattern from backend)

---

## Phase 10: Integration & Polish

### Goal: Integrate Memory System with existing workflows and polish UX

### Prerequisites: Phase 9 complete

---

#### Task 10.1: SessionEditor Integration - Add to Memory Button

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/SessionEditor.vue` - Add memory integration

**Implementation details**:
1. Add "Add to Memory" button in session actions:
```vue
<!-- In SessionEditor actions section -->
<button
  v-if="!isInMemory"
  @click="addToMemory"
  class="btn-memory"
>
  📥 Add to Memory
</button>
<span v-else class="memory-indicator">
  ✓ In Memory ({{ versionCount }} versions)
</span>
```
2. Check if session is already registered
3. Call memory store action on click

**Acceptance criteria**:
- [ ] Button shown for unregistered sessions
- [ ] Indicator shown for registered sessions
- [ ] Registration works from session view

**Tests required**:
- Component test: Button visibility logic
- Integration test: Registration flow

**Dependencies**: Task 6.3

---

#### Task 10.2: SanitizationPanel Integration - Create Memory Compression

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/SanitizationPanel.vue` - Add memory option

**Implementation details**:
1. Add option to save summarization as memory version:
```vue
<!-- After summarization options -->
<div class="output-mode-options">
  <!-- Existing options -->
  <label class="output-option" :class="{ active: outputMode === 'memory' }">
    <input type="radio" value="memory" v-model="outputMode" />
    <span class="output-option-icon">📦</span>
    <span class="output-option-text">Save to Memory</span>
  </label>
</div>
```
2. When "Save to Memory" selected:
   - Register session if not already registered
   - Create compression version with current settings
   - Show success message with link to memory browser

**Acceptance criteria**:
- [ ] Memory output option appears
- [ ] Creates memory version on apply
- [ ] Links to memory browser

**Tests required**:
- Component test: Option visibility
- Integration test: Memory version creation

**Dependencies**: Task 10.1

---

#### Task 10.3: Navigation Updates

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/App.vue` - Add memory browser route
- `frontend/src/components/Navigation.vue` - Add nav item (if exists)

**Implementation details**:
1. Add Memory Browser as top-level navigation item
2. Add route for memory browser: `/memory`
3. Add route for composition builder: `/memory/compose`
4. Update any existing navigation component

**Acceptance criteria**:
- [ ] Memory Browser accessible from main navigation
- [ ] Routes work correctly
- [ ] Back navigation preserved

**Tests required**:
- Navigation test: Routes work
- Navigation test: Links appear

**Dependencies**: Task 7.1

---

#### Task 10.3a: Global Settings Management UI

**Estimated effort**: 3 hours

**Files to create/modify**:
- `frontend/src/components/memory/MemorySettingsDialog.vue` - Create new file
- `frontend/src/stores/memory.js` - Add settings actions

**Implementation details**:
1. Create settings dialog accessible from Memory Browser header:
```vue
<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="memory-settings">
      <h3>Memory System Settings</h3>

      <div class="settings-section">
        <h4>Defaults</h4>
        <div class="setting-row">
          <label>Default Compression Preset:</label>
          <select v-model="settings.defaults.compressionPreset">
            <option value="gentle">Gentle</option>
            <option value="standard">Standard</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </div>
        <div class="setting-row">
          <label>Enable Keepit Decay:</label>
          <input type="checkbox" v-model="settings.defaults.keepitDecayEnabled" />
        </div>
        <div class="setting-row">
          <label>Auto-register Sessions:</label>
          <input type="checkbox" v-model="settings.defaults.autoRegisterSessions" />
          <span class="hint">Automatically add new sessions to memory</span>
        </div>
        <div class="setting-row">
          <label>Default Model:</label>
          <select v-model="settings.defaults.model">
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
          </select>
        </div>
      </div>

      <div class="settings-section">
        <h4>Keepit Decay Settings</h4>
        <div class="setting-row">
          <label>Max Session Distance:</label>
          <input
            type="number"
            v-model.number="settings.keepitDecay.maxSessionDistance"
            min="1"
            max="20"
          />
        </div>
        <div class="setting-row">
          <label>Light Compression Base:</label>
          <input
            type="number"
            v-model.number="settings.keepitDecay.compressionBase.light"
            min="0"
            max="1"
            step="0.1"
          />
        </div>
        <div class="setting-row">
          <label>Moderate Compression Base:</label>
          <input
            type="number"
            v-model.number="settings.keepitDecay.compressionBase.moderate"
            min="0"
            max="1"
            step="0.1"
          />
        </div>
        <div class="setting-row">
          <label>Aggressive Compression Base:</label>
          <input
            type="number"
            v-model.number="settings.keepitDecay.compressionBase.aggressive"
            min="0"
            max="1"
            step="0.1"
          />
        </div>
      </div>

      <div class="settings-section">
        <h4>UI Preferences</h4>
        <div class="setting-row">
          <label>Default View:</label>
          <select v-model="settings.ui.defaultView">
            <option value="timeline">Timeline</option>
            <option value="list">List</option>
          </select>
        </div>
        <div class="setting-row">
          <label>Show Token Estimates:</label>
          <input type="checkbox" v-model="settings.ui.showTokenEstimates" />
        </div>
        <div class="setting-row">
          <label>Confirm Destructive Actions:</label>
          <input type="checkbox" v-model="settings.ui.confirmDestructiveActions" />
        </div>
      </div>

      <div class="dialog-actions">
        <button @click="resetToDefaults">Reset to Defaults</button>
        <button @click="$emit('close')">Cancel</button>
        <button @click="saveSettings" class="btn-primary">Save</button>
      </div>
    </div>
  </div>
</template>
```
2. Add API endpoints for settings:
   - `GET /api/memory/config` - Get global config
   - `PUT /api/memory/config` - Update global config
3. Persist settings to `~/.claude-memory/config.json`

**Acceptance criteria**:
- [ ] All settings from config.json editable in UI
- [ ] Settings persist across sessions
- [ ] Reset to defaults option available
- [ ] Validation prevents invalid values

**Tests required**:
- Component test: Settings form
- API test: Get and update config
- Integration test: Settings persist

**Dependencies**: Task 1.2, Task 7.1

---

#### Task 10.4: Error Handling Polish

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/memory/*.vue` - Add error handling
- `frontend/src/components/ErrorBanner.vue` - Create if needed

**Implementation details**:
1. Add consistent error display across memory components
2. Handle common error cases:
   - Network errors
   - Session not found
   - Version creation failed
   - Composition failed
3. Add retry buttons where appropriate

**Acceptance criteria**:
- [ ] Errors displayed consistently
- [ ] Error messages are user-friendly
- [ ] Retry options where appropriate

**Tests required**:
- Component test: Error display
- Integration test: Error recovery

**Dependencies**: Task 10.3

---

#### Task 10.5: Loading States and Progress Indicators

**Estimated effort**: 2 hours

**Files to create/modify**:
- `frontend/src/components/memory/*.vue` - Add loading states

**Implementation details**:
1. Add loading spinners for async operations
2. Add progress indicator for compression (potentially long-running)
3. Disable buttons during loading
4. Show skeleton loaders for lists

**Acceptance criteria**:
- [ ] Loading states for all async operations
- [ ] Buttons disabled during loading
- [ ] Progress shown for compression

**Tests required**:
- Component test: Loading state visibility

**Dependencies**: Task 10.4

---

#### Task 10.6: Keyboard Shortcuts

**Estimated effort**: 1 hour

**Files to create/modify**:
- `frontend/src/components/MemoryBrowser.vue` - Add shortcuts
- `frontend/src/composables/useKeyboardShortcuts.js` - Create if needed

**Implementation details**:
1. Add keyboard shortcuts:
   - `Ctrl+Shift+M` - Open memory browser
   - `Ctrl+Enter` - Create compression (in dialog)
   - `Escape` - Close dialogs
2. Show shortcut hints in UI

**Acceptance criteria**:
- [ ] Shortcuts work as expected
- [ ] Hints shown in tooltips/buttons

**Tests required**:
- Integration test: Keyboard shortcuts

**Dependencies**: Task 10.5

---

#### Task 10.7: Performance Optimization

**Estimated effort**: 2 hours

**Files to create/modify**:
- Various memory components

**Implementation details**:
1. Implement virtual scrolling for long session lists
2. Lazy load version details
3. Cache manifest data in store
4. Debounce search/filter inputs

**Acceptance criteria**:
- [ ] Large session lists perform well
- [ ] No unnecessary API calls
- [ ] Smooth UI interactions

**Tests required**:
- Performance test: Large list rendering

**Dependencies**: Task 10.6

---

#### Task 10.8: End-to-End Testing

**Estimated effort**: 4 hours

**Files to create/modify**:
- `tests/e2e/memory-system.spec.js` - Create new file

**Implementation details**:
1. Write E2E tests for critical flows:
   - Register session to memory
   - Create compression version
   - Create composition from multiple sessions
   - Edit keepit weight
2. Use existing test patterns and setup

**Acceptance criteria**:
- [ ] All critical flows tested
- [ ] Tests pass reliably
- [ ] CI integration (if applicable)

**Tests required**:
- E2E test suite for memory system

**Dependencies**: All previous tasks

---

## Summary

### Phase Summary

| Phase | Tasks | Estimated Hours |
|-------|-------|-----------------|
| 1. Storage Foundation | 7 | 16 |
| 2. Compression Version Management | 6 | 14 |
| 3. Keepit Markers | 7 | 15 |
| 4. Composition Engine | 5 | 14 |
| 5. Backend API Completion | 6 | 15 |
| 6. Frontend - Memory Store | 3 | 7 |
| 7. Frontend - Memory Browser UI | 7 | 18 |
| 8. Frontend - Composition Builder UI | 6 | 14 |
| 9. Frontend - Keepit Editor | 3 | 7 |
| 10. Integration & Polish | 9 | 20 |
| **Total** | **59** | **140** |

### Recommended Implementation Order

1. **Weeks 1-2**: Phase 1 + Phase 2 (Core backend)
2. **Weeks 3-4**: Phase 3 + Phase 4 (Keepits + Composition)
3. **Week 5**: Phase 5 + Phase 6 (API polish + Store)
4. **Weeks 6-7**: Phase 7 + Phase 8 (Main UI)
5. **Week 8**: Phase 9 + Phase 10 (Keepit UI + Integration)

### Parallelization Opportunities

- Task 3.1-3.3 (Keepit parsing) can start during Phase 2
- Phase 6 (Frontend store) can start once API contracts are defined
- Some frontend components can be developed with mock data

### Risk Mitigation

1. **Summarizer Integration**: Most complex integration point - test thoroughly
2. **Performance**: Large sessions may slow compression - add progress indicators
3. **File System**: Handle symlink failures gracefully (fall back to copy)
4. **Concurrent Access**: Manifest file locking is critical

---

## Revision History

### 2026-01-21 - Revision 1.1 (Review Response)

This revision addresses all findings from the `MEMORY_PLAN_REVIEW.md` document.

#### Critical Issues Fixed

1. **Keepit Weight Modification Discrepancy (Task 3.6)**
   - RESOLVED: Updated Task 3.6 to clarify that modifying keepit weights updates the ORIGINAL session file (per design doc Section 5.4), not just the manifest
   - Added backup creation before modifying original files
   - Added implementation details showing the file modification approach

2. **Missing API Endpoint (Task 2.4)**
   - RESOLVED: Expanded Task 2.4 to explicitly cover `GET /api/memory/sessions/:sessionId/versions/:versionId`
   - Added response schema documentation
   - Added support for "original" pseudo-version

3. **Manifest Migration Strategy (Task 1.3a)**
   - ADDED: New Task 1.3a "Manifest Migration Framework"
   - Includes semver comparison for migration ordering
   - Backup creation before migration
   - Auto-migration on manifest load

4. **Keepit Verification (Task 3.4a)**
   - ADDED: New Task 3.4a "Keepit Preservation Verification"
   - Post-compression verification that surviving keepits exist in output
   - Fuzzy matching for slight reformatting
   - Failure handling options

5. **Concurrent Operation Handling (Task 5.0)**
   - ADDED: New Task 5.0 "Concurrent Operation Handling"
   - Session-level locks for compression operations
   - File-level locks for manifest writes
   - Stale lock recovery

#### Important Issues Fixed

6. **Storage Usage Statistics (Task 5.4)**
   - ADDED: New Task 5.4 "Storage Usage Statistics API"
   - Project-level and global statistics
   - Directory size calculations
   - Compression ratio analytics

7. **Version Comparison View (Task 7.6)**
   - ADDED: New Task 7.6 "Version Comparison View"
   - Side-by-side comparison of versions
   - Token difference display
   - Keepit preservation comparison

8. **Composition Preview (Task 8.5)**
   - ADDED: New Task 8.5 "Composition Preview"
   - Preview before composition creation
   - Warnings for over-budget or missing versions
   - Optional content preview

9. **Bulk Version Pruning (Task 7.7)**
   - ADDED: New Task 7.7 "Bulk Version Management"
   - Multi-select for bulk operations
   - Usage tracking display
   - Protected deletion for in-use versions

10. **Import/Export Memory Data (Task 5.5)**
    - ADDED: New Task 5.5 "Import/Export Memory Data"
    - ZIP export with configurable inclusion
    - Import with merge/replace modes
    - Schema validation on import

11. **Global Settings Management UI (Task 10.3a)**
    - ADDED: New Task 10.3a "Global Settings Management UI"
    - Full settings dialog for all config.json options
    - Storage, defaults, decay, and UI preferences
    - Reset to defaults option

12. **Allocation Strategy Selector (Task 8.6)**
    - ADDED: New Task 8.6 "Allocation Strategy Selector"
    - Equal, proportional, recency, and manual strategies
    - Strategy descriptions

#### Other Fixes

13. **Enhanced Error Handling (Task 5.1)**
    - Expanded error classes to cover all scenarios
    - Standardized response format: `{ error: { code, message, details? } }`
    - Added: SessionAlreadyRegisteredError, DiskSpaceError, OriginalFileNotFoundError, ManifestCorruptionError, ModelRateLimitError

14. **Improved Task Dependencies**
    - Task 3.4 now explicitly depends on Task 2.2
    - Task 1.4 now depends on Task 1.3a (migration)
    - Added missing dependency notes throughout

15. **Enhanced Test Coverage**
    - Added stress tests for concurrent manifest access (Task 1.3)
    - Added symlink fallback tests (Task 1.4)
    - Added verification tests (Task 3.4a)

16. **Session Registration Improvements (Task 1.4)**
    - Added explicit symlink fallback acceptance criteria
    - Added error for already-registered sessions

#### Summary of Changes

| Category | Items Added/Modified |
|----------|---------------------|
| New Tasks | 11 tasks added |
| Modified Tasks | 6 tasks enhanced |
| New Error Classes | 6 classes added |
| New API Endpoints | 4 endpoints added |
| Total Tasks | 49 -> 59 (+10) |
| Total Hours | 113 -> 140 (+27) |

---

*End of Implementation Plan*
