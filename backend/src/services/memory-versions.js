import fs from 'fs-extra';
import path from 'path';
import { parseJsonlFile } from './jsonl-parser.js';
import { calculateTokenBreakdown } from './token-calculator.js';
import {
  loadManifest,
  saveManifest,
  getSession
} from './memory-manifest.js';
import {
  getSummariesDir,
  ensureDirectoryStructure,
  getOriginalsDir
} from './memory-storage.js';
import {
  summarizeAndIntegrate,
  summarizeAndIntegrateWithTiers,
  extractTextContent,
  TIER_PRESETS,
  COMPACTION_RATIOS
} from './summarizer.js';
import {
  acquireSessionLock,
  OperationType
} from './memory-lock.js';

// Re-export for use by routes
export { TIER_PRESETS, COMPACTION_RATIOS };

// ============================================
// Task 2.1: Version Storage and Naming Service
// ============================================

/**
 * Generate a version filename following the spec pattern
 * Format: v{id}_{mode}-{preset}_{tokens}k
 * Example: v001_tiered-standard_10k
 */
export function generateVersionFilename(versionId, settings, tokenCount) {
  const mode = settings.mode || 'uniform';
  const preset = settings.tierPreset || settings.aggressiveness || 'custom';
  // Use at least 1k even for small token counts to avoid "0k" in filename
  const tokens = Math.max(1, Math.round(tokenCount / 1000));
  return `${versionId}_${mode}-${preset}_${tokens}k`;
}

/**
 * Get the next sequential version ID for a session
 * Returns IDs like v001, v002, etc.
 */
export async function getNextVersionId(projectId, sessionId) {
  const manifest = await loadManifest(projectId);
  const session = manifest.sessions[sessionId];

  if (!session) {
    throw new Error(`Session ${sessionId} not found in project ${projectId}`);
  }

  const compressions = session.compressions || [];
  const nextNumber = compressions.length + 1;

  // Zero-pad to 3 digits
  return `v${String(nextNumber).padStart(3, '0')}`;
}

/**
 * Get the path to the versions directory for a session
 * Returns: ~/.claude-memory/projects/{projectId}/summaries/{sessionId}/
 */
export function getVersionsPath(projectId, sessionId) {
  const summariesDir = getSummariesDir(projectId);
  return path.join(summariesDir, sessionId);
}

/**
 * Ensure the versions directory exists for a session
 */
export async function ensureVersionsDir(projectId, sessionId) {
  const versionsDir = getVersionsPath(projectId, sessionId);
  await fs.ensureDir(versionsDir);
  return versionsDir;
}

/**
 * Parse version ID from a filename
 * e.g., "v001_tiered-standard_10k" -> "v001"
 */
export function parseVersionIdFromFilename(filename) {
  const match = filename.match(/^(v\d{3})_/);
  return match ? match[1] : null;
}

// ============================================
// Task 2.2: Create Compression Version - Core Logic
// ============================================

/**
 * Validate compression settings
 * Returns { valid: boolean, errors: string[] }
 */
export function validateCompressionSettings(settings) {
  const errors = [];

  // Mode is required
  if (!settings.mode || !['uniform', 'tiered'].includes(settings.mode)) {
    errors.push('mode must be "uniform" or "tiered"');
  }

  // Validate uniform mode settings
  if (settings.mode === 'uniform') {
    if (settings.compactionRatio !== undefined) {
      if (typeof settings.compactionRatio !== 'number' || settings.compactionRatio < 2 || settings.compactionRatio > 50) {
        errors.push('compactionRatio must be a number between 2 and 50');
      }
    }
    if (settings.aggressiveness !== undefined) {
      const validAggressiveness = ['minimal', 'moderate', 'aggressive'];
      if (!validAggressiveness.includes(settings.aggressiveness)) {
        errors.push(`aggressiveness must be one of: ${validAggressiveness.join(', ')}`);
      }
    }
  }

  // Validate tiered mode settings
  if (settings.mode === 'tiered') {
    if (settings.tierPreset !== undefined && settings.tierPreset !== null) {
      const validPresets = ['gentle', 'standard', 'aggressive'];
      if (!validPresets.includes(settings.tierPreset)) {
        errors.push(`tierPreset must be one of: ${validPresets.join(', ')}`);
      }
    }

    // Custom tiers validation
    if (settings.customTiers) {
      if (!Array.isArray(settings.customTiers)) {
        errors.push('customTiers must be an array');
      } else {
        for (let i = 0; i < settings.customTiers.length; i++) {
          const tier = settings.customTiers[i];
          if (typeof tier.endPercent !== 'number' || tier.endPercent < 1 || tier.endPercent > 100) {
            errors.push(`customTiers[${i}].endPercent must be between 1 and 100`);
          }
          if (typeof tier.compactionRatio !== 'number' || tier.compactionRatio < 2 || tier.compactionRatio > 50) {
            errors.push(`customTiers[${i}].compactionRatio must be between 2 and 50`);
          }
          if (tier.aggressiveness && !['minimal', 'moderate', 'aggressive'].includes(tier.aggressiveness)) {
            errors.push(`customTiers[${i}].aggressiveness must be minimal, moderate, or aggressive`);
          }
        }
      }
    }
  }

  // Validate model
  if (settings.model !== undefined) {
    const validModels = ['opus', 'sonnet', 'haiku'];
    if (!validModels.includes(settings.model)) {
      errors.push(`model must be one of: ${validModels.join(', ')}`);
    }
  }

  // Validate skipFirstMessages
  if (settings.skipFirstMessages !== undefined) {
    if (typeof settings.skipFirstMessages !== 'number' || settings.skipFirstMessages < 0) {
      errors.push('skipFirstMessages must be a non-negative number');
    }
  }

  // Validate keepitMode (placeholder for Phase 3)
  if (settings.keepitMode !== undefined) {
    const validModes = ['decay', 'preserve-all', 'ignore'];
    if (!validModes.includes(settings.keepitMode)) {
      errors.push(`keepitMode must be one of: ${validModes.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Save version files (.md and .jsonl)
 */
async function saveVersionFiles(projectId, sessionId, filename, result) {
  const versionsDir = await ensureVersionsDir(projectId, sessionId);

  // Generate markdown content
  const markdownContent = generateMarkdownOutput(result);
  const mdPath = path.join(versionsDir, `${filename}.md`);
  await fs.writeFile(mdPath, markdownContent, 'utf-8');

  // Generate JSONL content
  const jsonlContent = generateJsonlOutput(result);
  const jsonlPath = path.join(versionsDir, `${filename}.jsonl`);
  await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');

  return {
    mdPath,
    jsonlPath,
    mdSize: Buffer.byteLength(markdownContent, 'utf-8'),
    jsonlSize: Buffer.byteLength(jsonlContent, 'utf-8')
  };
}

/**
 * Generate markdown output from summarized messages
 */
function generateMarkdownOutput(result) {
  const lines = [];

  // Header
  lines.push('# Compressed Session');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Original messages: ${result.changes?.compaction || 'N/A'}`);
  if (result.tierResults) {
    lines.push('');
    lines.push('## Tier Summary');
    for (const tier of result.tierResults) {
      lines.push(`- ${tier.range}: ${tier.inputMessages} -> ${tier.outputMessages} messages (${tier.compactionRatio}x)`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Messages
  for (const msg of result.messages) {
    const role = msg.type === 'user' ? 'User' : 'Assistant';
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
    const isSummarized = msg.isSummarized ? ' [SUMMARIZED]' : '';

    lines.push(`## ${role}${isSummarized}`);
    if (timestamp) {
      lines.push(`*${timestamp}*`);
    }
    lines.push('');

    // Extract text content
    const text = extractTextContent(msg);
    if (text) {
      lines.push(text);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate JSONL output from summarized messages
 * This format can be used to reconstruct a session
 */
function generateJsonlOutput(result) {
  const lines = [];

  // Add a header record
  const header = {
    type: 'compression-metadata',
    version: '1.0',
    createdAt: new Date().toISOString(),
    changes: result.changes,
    tierResults: result.tierResults || null
  };
  lines.push(JSON.stringify(header));

  // Add each message
  for (const msg of result.messages) {
    // Create a clean message record similar to original Claude format
    const record = {
      type: msg.type,
      uuid: msg.uuid,
      parentUuid: msg.parentUuid,
      timestamp: msg.timestamp,
      sessionId: msg.sessionId,
      agentId: msg.agentId,
      isSidechain: msg.isSidechain || false,
      isSummarized: msg.isSummarized || false,
      summarizedCount: msg.summarizedCount || null,
      summarizedFrom: msg.summarizedFrom || null,
      message: {
        role: msg.type,
        content: msg.content
      }
    };
    lines.push(JSON.stringify(record));
  }

  return lines.join('\n');
}

/**
 * Count tokens in the output messages
 * Uses character-based estimation since we don't have actual API usage data
 */
function countOutputTokens(messages) {
  let totalChars = 0;

  for (const msg of messages) {
    const text = extractTextContent(msg);
    totalChars += text.length;
  }

  // Rough estimation: 1 token ~= 4 characters
  return Math.ceil(totalChars / 4);
}

/**
 * Create a compression version
 * Main entry point for compression
 * Includes session-level locking to prevent concurrent compressions
 */
export async function createCompressionVersion(projectId, sessionId, settings) {
  // Validate settings
  const validation = validateCompressionSettings(settings);
  if (!validation.valid) {
    const error = new Error(`Invalid compression settings: ${validation.errors.join('; ')}`);
    error.code = 'INVALID_SETTINGS';
    error.status = 400;
    throw error;
  }

  // Acquire session lock to prevent concurrent compressions
  let lock;
  try {
    lock = await acquireSessionLock(projectId, sessionId, OperationType.COMPRESSION);
  } catch (lockError) {
    // Re-throw lock errors with proper status code
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

    // Parse the original session file
    let parsed;
    try {
      parsed = await parseJsonlFile(session.originalFile);
    } catch (parseError) {
      const error = new Error(`Failed to parse session file: ${parseError.message}`);
      error.code = 'SESSION_PARSE_ERROR';
      error.status = 400;
      throw error;
    }

    // Get all message UUIDs for summarization
    const allUuids = parsed.messages.map(m => m.uuid);

    if (allUuids.length < 2) {
      const error = new Error('Session must have at least 2 messages to compress');
      error.code = 'INSUFFICIENT_MESSAGES';
      error.status = 400;
      throw error;
    }

    // Get next version ID
    const versionId = await getNextVersionId(projectId, sessionId);

    // Call appropriate summarizer
    let result;
    const startTime = Date.now();

    try {
      if (settings.mode === 'tiered') {
        result = await summarizeAndIntegrateWithTiers(parsed, allUuids, {
          tiers: settings.customTiers || undefined,
          tierPreset: settings.tierPreset || 'standard',
          model: settings.model || 'opus',
          removeNonConversation: true,
          skipFirstMessages: settings.skipFirstMessages || 0
        });
      } else {
        result = await summarizeAndIntegrate(parsed, allUuids, {
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
    // Guard against division by zero (shouldn't happen in practice)
    const compressionRatio = outputTokens > 0 ? session.originalTokens / outputTokens : 1;

    // Generate filename and save files
    const filename = generateVersionFilename(versionId, settings, outputTokens);
    const savedFiles = await saveVersionFiles(projectId, sessionId, filename, result);

    // Create compression record
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
      inputTokens: session.originalTokens,
      inputMessages: session.originalMessages,
      outputTokens,
      outputMessages,
      compressionRatio: Number(compressionRatio.toFixed(2)),
      processingTimeMs: processingTime,
      keepitStats: {
        // Placeholder for Phase 3
        preserved: 0,
        summarized: 0,
        weights: {}
      },
      fileSizes: {
        md: savedFiles.mdSize,
        jsonl: savedFiles.jsonlSize
      },
      tierResults: result.tierResults || null
    };

    // Update manifest with new compression
    session.compressions = session.compressions || [];
    session.compressions.push(compressionRecord);
    session.lastAccessed = new Date().toISOString();
    manifest.sessions[sessionId] = session;
    await saveManifest(projectId, manifest);

    return compressionRecord;

  } finally {
    // Always release the lock when done
    if (lock) {
      lock.release();
    }
  }
}

// ============================================
// Task 2.4: List Compression Versions
// ============================================

/**
 * List all compression versions for a session
 * Includes "original" as a pseudo-version option
 */
export async function listCompressionVersions(projectId, sessionId) {
  const session = await getSession(projectId, sessionId);

  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Create "original" pseudo-version
  const originalVersion = {
    versionId: 'original',
    file: null,
    createdAt: session.registeredAt,
    isOriginal: true,
    outputTokens: session.originalTokens,
    outputMessages: session.originalMessages,
    compressionRatio: 1.0,
    settings: null
  };

  // Get actual versions with file sizes
  const versions = [];
  const versionsDir = getVersionsPath(projectId, sessionId);

  for (const compression of (session.compressions || [])) {
    // Get current file sizes if available
    let fileSizes = compression.fileSizes || { md: 0, jsonl: 0 };

    try {
      const mdPath = path.join(versionsDir, `${compression.file}.md`);
      const jsonlPath = path.join(versionsDir, `${compression.file}.jsonl`);

      if (await fs.pathExists(mdPath)) {
        const mdStats = await fs.stat(mdPath);
        fileSizes.md = mdStats.size;
      }
      if (await fs.pathExists(jsonlPath)) {
        const jsonlStats = await fs.stat(jsonlPath);
        fileSizes.jsonl = jsonlStats.size;
      }
    } catch (err) {
      // Keep stored sizes if we can't read files
    }

    versions.push({
      ...compression,
      fileSizes
    });
  }

  return [originalVersion, ...versions];
}

/**
 * Get a specific compression version
 * Supports versionId='original' for the original session
 */
export async function getCompressionVersion(projectId, sessionId, versionId) {
  const session = await getSession(projectId, sessionId);

  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Handle original pseudo-version
  if (versionId === 'original') {
    return {
      versionId: 'original',
      file: null,
      createdAt: session.registeredAt,
      isOriginal: true,
      settings: null,
      inputTokens: null,
      inputMessages: null,
      outputTokens: session.originalTokens,
      outputMessages: session.originalMessages,
      compressionRatio: 1.0,
      keepitStats: null,
      fileSizes: {
        md: 0,
        jsonl: await getFileSizeIfExists(session.originalFile) || 0
      },
      downloadUrls: {
        md: null,
        jsonl: `/api/memory/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions/original/content?format=jsonl`
      }
    };
  }

  // Find the compression
  const compression = (session.compressions || []).find(c => c.versionId === versionId);

  if (!compression) {
    const error = new Error(`Version ${versionId} not found for session ${sessionId}`);
    error.code = 'VERSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Get file sizes
  const versionsDir = getVersionsPath(projectId, sessionId);
  let fileSizes = compression.fileSizes || { md: 0, jsonl: 0 };

  try {
    const mdPath = path.join(versionsDir, `${compression.file}.md`);
    const jsonlPath = path.join(versionsDir, `${compression.file}.jsonl`);

    if (await fs.pathExists(mdPath)) {
      const mdStats = await fs.stat(mdPath);
      fileSizes.md = mdStats.size;
    }
    if (await fs.pathExists(jsonlPath)) {
      const jsonlStats = await fs.stat(jsonlPath);
      fileSizes.jsonl = jsonlStats.size;
    }
  } catch (err) {
    // Keep stored sizes if we can't read files
  }

  return {
    ...compression,
    fileSizes,
    downloadUrls: {
      md: `/api/memory/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions/${encodeURIComponent(versionId)}/download?format=md`,
      jsonl: `/api/memory/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions/${encodeURIComponent(versionId)}/download?format=jsonl`
    }
  };
}

/**
 * Helper to get file size if it exists
 */
async function getFileSizeIfExists(filePath) {
  try {
    if (await fs.pathExists(filePath)) {
      const stats = await fs.stat(filePath);
      return stats.size;
    }
  } catch (err) {
    // Ignore errors
  }
  return null;
}

// ============================================
// Task 2.5: Get Version Content
// ============================================

/**
 * Get the content of a compression version
 * format: 'md' or 'jsonl'
 */
export async function getVersionContent(projectId, sessionId, versionId, format = 'md') {
  const session = await getSession(projectId, sessionId);

  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Handle original pseudo-version
  if (versionId === 'original') {
    if (format === 'jsonl') {
      // Return original session content
      const content = await fs.readFile(session.originalFile, 'utf-8');
      return {
        content,
        contentType: 'application/x-ndjson',
        filename: `${sessionId}-original.jsonl`
      };
    } else {
      // Generate markdown from original
      const parsed = await parseJsonlFile(session.originalFile);
      const mdContent = generateMarkdownFromParsed(parsed);
      return {
        content: mdContent,
        contentType: 'text/markdown',
        filename: `${sessionId}-original.md`
      };
    }
  }

  // Find the compression
  const compression = (session.compressions || []).find(c => c.versionId === versionId);

  if (!compression) {
    const error = new Error(`Version ${versionId} not found for session ${sessionId}`);
    error.code = 'VERSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Get file path
  const versionsDir = getVersionsPath(projectId, sessionId);
  const ext = format === 'jsonl' ? 'jsonl' : 'md';
  const filePath = path.join(versionsDir, `${compression.file}.${ext}`);

  if (!await fs.pathExists(filePath)) {
    const error = new Error(`Version file not found: ${compression.file}.${ext}`);
    error.code = 'VERSION_FILE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const contentType = format === 'jsonl' ? 'application/x-ndjson' : 'text/markdown';

  return {
    content,
    contentType,
    filename: `${compression.file}.${ext}`
  };
}

/**
 * Generate markdown from parsed session (for original pseudo-version)
 */
function generateMarkdownFromParsed(parsed) {
  const lines = [];

  // Header
  lines.push('# Original Session');
  lines.push('');
  lines.push(`Total messages: ${parsed.totalMessages}`);
  if (parsed.metadata) {
    lines.push(`Project: ${parsed.metadata.projectName || 'unknown'}`);
    lines.push(`Branch: ${parsed.metadata.gitBranch || 'unknown'}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Messages
  for (const msg of parsed.messages) {
    if (msg.type !== 'user' && msg.type !== 'assistant') continue;

    const role = msg.type === 'user' ? 'User' : 'Assistant';
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';

    lines.push(`## ${role}`);
    if (timestamp) {
      lines.push(`*${timestamp}*`);
    }
    lines.push('');

    const text = extractTextContent(msg);
    if (text) {
      lines.push(text);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================
// Task 2.6: Delete Compression Version
// ============================================

/**
 * Check if a version is used in any composition
 */
export async function isVersionUsedInComposition(projectId, sessionId, versionId) {
  const manifest = await loadManifest(projectId);

  // Check all compositions
  for (const composition of Object.values(manifest.compositions || {})) {
    if (composition.sourceVersions) {
      for (const source of composition.sourceVersions) {
        if (source.sessionId === sessionId && source.versionId === versionId) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Delete a compression version
 * Returns error if version is used in a composition (unless force=true)
 */
export async function deleteCompressionVersion(projectId, sessionId, versionId, options = {}) {
  const { force = false } = options;

  // Can't delete original
  if (versionId === 'original') {
    const error = new Error('Cannot delete the original session version');
    error.code = 'CANNOT_DELETE_ORIGINAL';
    error.status = 400;
    throw error;
  }

  const manifest = await loadManifest(projectId);
  const session = manifest.sessions[sessionId];

  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Find the compression
  const compressionIndex = (session.compressions || []).findIndex(c => c.versionId === versionId);

  if (compressionIndex === -1) {
    const error = new Error(`Version ${versionId} not found for session ${sessionId}`);
    error.code = 'VERSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const compression = session.compressions[compressionIndex];

  // Check if used in composition
  if (!force && await isVersionUsedInComposition(projectId, sessionId, versionId)) {
    const error = new Error(`Version ${versionId} is used in a composition. Use force=true to delete anyway.`);
    error.code = 'VERSION_IN_USE';
    error.status = 409;
    throw error;
  }

  // Delete files
  const versionsDir = getVersionsPath(projectId, sessionId);
  const mdPath = path.join(versionsDir, `${compression.file}.md`);
  const jsonlPath = path.join(versionsDir, `${compression.file}.jsonl`);

  const deletedFiles = [];

  try {
    if (await fs.pathExists(mdPath)) {
      await fs.remove(mdPath);
      deletedFiles.push(mdPath);
    }
    if (await fs.pathExists(jsonlPath)) {
      await fs.remove(jsonlPath);
      deletedFiles.push(jsonlPath);
    }
  } catch (deleteError) {
    console.error(`Failed to delete version files: ${deleteError.message}`);
    // Continue with manifest update even if file deletion fails
  }

  // Remove from manifest
  session.compressions.splice(compressionIndex, 1);
  session.lastAccessed = new Date().toISOString();
  manifest.sessions[sessionId] = session;
  await saveManifest(projectId, manifest);

  return {
    deleted: true,
    versionId,
    filesDeleted: deletedFiles,
    session
  };
}

/**
 * Get presets info for UI display
 */
export function getPresetsInfo() {
  return {
    tierPresets: {
      gentle: {
        description: 'Preserves more detail, lighter compression',
        tiers: TIER_PRESETS.gentle
      },
      standard: {
        description: 'Balanced compression for most use cases',
        tiers: TIER_PRESETS.standard
      },
      aggressive: {
        description: 'Maximum compression, essential info only',
        tiers: TIER_PRESETS.aggressive
      }
    },
    compactionRatios: COMPACTION_RATIOS,
    aggressivenessLevels: ['minimal', 'moderate', 'aggressive'],
    models: ['opus', 'sonnet', 'haiku']
  };
}
