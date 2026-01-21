/**
 * Core CRUD operations for memory compression versions
 * Handles create, get, list, and delete version operations
 */

import fs from 'fs-extra';
import path from 'path';
import { parseJsonlFile } from './jsonl-parser.js';
import { loadManifest, saveManifest, getSession } from './memory-manifest.js';
import { ensureDirectoryStructure } from './memory-storage.js';
import { summarizeAndIntegrate, summarizeAndIntegrateWithTiers } from './summarizer.js';
import { acquireSessionLock, OperationType } from './memory-lock.js';
import {
  saveVersionFiles,
  countOutputTokens,
  getHighestPartNumber,
  getCompressionsByPart,
  getLastCompressionEndTimestamp,
  migrateCompressionRecord
} from './memory-versions-helpers.js';

// Re-export from config module
export { TIER_PRESETS, COMPACTION_RATIOS, getPresetsInfo } from './memory-versions-config.js';

// Re-export from validation module
export { validateCompressionSettings } from './memory-versions-validation.js';

// Re-export from filename module
export {
  generateVersionFilename,
  generatePartVersionFilename,
  parsePartVersionFilename,
  parseVersionIdFromFilename,
  getNextVersionId,
  getVersionsPath,
  ensureVersionsDir
} from './memory-versions-filename.js';

// Re-export from content module
export { getVersionContent } from './memory-versions-content.js';

// Re-export from read module
export { listCompressionVersions, getCompressionVersion } from './memory-versions-read.js';

// Re-export helper functions for external use
export {
  getHighestPartNumber,
  getCompressionsByPart,
  getLastCompressionEndTimestamp,
  migrateCompressionRecord
} from './memory-versions-helpers.js';

// Re-export delta compression functions
export { createDeltaCompression, recompressPart } from './memory-versions-delta.js';

// Import for local use
import { validateCompressionSettings } from './memory-versions-validation.js';
import {
  generateVersionFilename,
  getNextVersionId,
  getVersionsPath,
  ensureVersionsDir
} from './memory-versions-filename.js';

/**
 * Create a compression version
 * Main entry point for compression
 */
export async function createCompressionVersion(projectId, sessionId, settings) {
  const validation = validateCompressionSettings(settings);
  if (!validation.valid) {
    const error = new Error(`Invalid compression settings: ${validation.errors.join('; ')}`);
    error.code = 'INVALID_SETTINGS';
    error.status = 400;
    throw error;
  }

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
      const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
      error.code = 'SESSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    await ensureDirectoryStructure(projectId);

    const sourceFile = session.linkedFile || session.originalFile;
    if (!await fs.pathExists(sourceFile)) {
      const error = new Error(`Session file not found: ${sourceFile}`);
      error.code = 'SESSION_FILE_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    let parsed;
    try {
      parsed = await parseJsonlFile(sourceFile);
    } catch (parseError) {
      const error = new Error(`Failed to parse session file: ${parseError.message}`);
      error.code = 'SESSION_PARSE_ERROR';
      error.status = 400;
      throw error;
    }

    const allUuids = parsed.messages.map(m => m.uuid);

    if (allUuids.length < 2) {
      const error = new Error('Session must have at least 2 messages to compress');
      error.code = 'INSUFFICIENT_MESSAGES';
      error.status = 400;
      throw error;
    }

    const versionId = await getNextVersionId(projectId, sessionId);
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
    const outputTokens = countOutputTokens(result.messages);
    const outputMessages = result.messages.length;
    const compressionRatio = outputTokens > 0 ? session.originalTokens / outputTokens : 1;

    const versionsDir = await ensureVersionsDir(projectId, sessionId);
    const filename = generateVersionFilename(versionId, settings, outputTokens);
    const savedFiles = await saveVersionFiles(versionsDir, filename, result);

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
      keepitStats: { preserved: 0, summarized: 0, weights: {} },
      fileSizes: { md: savedFiles.mdSize, jsonl: savedFiles.jsonlSize },
      tierResults: result.tierResults || null
    };

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
 * Check if a version is used in any composition
 */
export async function isVersionUsedInComposition(projectId, sessionId, versionId) {
  const manifest = await loadManifest(projectId);

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
 */
export async function deleteCompressionVersion(projectId, sessionId, versionId, options = {}) {
  const { force = false } = options;

  if (versionId === 'original') {
    const error = new Error('The original version is protected. To remove this session entirely, use "Unregister Session" instead.');
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

  const compressionIndex = (session.compressions || []).findIndex(c => c.versionId === versionId);

  if (compressionIndex === -1) {
    const error = new Error(`Version ${versionId} not found for session ${sessionId}`);
    error.code = 'VERSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const compression = session.compressions[compressionIndex];

  if (!force && await isVersionUsedInComposition(projectId, sessionId, versionId)) {
    const error = new Error(`Version ${versionId} is used in a composition. Use force=true to delete anyway.`);
    error.code = 'VERSION_IN_USE';
    error.status = 409;
    throw error;
  }

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
  }

  session.compressions.splice(compressionIndex, 1);
  session.lastAccessed = new Date().toISOString();
  manifest.sessions[sessionId] = session;
  await saveManifest(projectId, manifest);

  return { deleted: true, versionId, filesDeleted: deletedFiles, session };
}
