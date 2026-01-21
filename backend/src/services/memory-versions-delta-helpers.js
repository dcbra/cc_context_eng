/**
 * Helper functions for delta compression operations
 * Shared logic between createDeltaCompression and recompressPart
 */

import fs from 'fs-extra';
import { parseJsonlFile } from './jsonl-parser.js';
import { loadManifest, saveManifest } from './memory-manifest.js';
import { ensureDirectoryStructure } from './memory-storage.js';
import {
  summarizeAndIntegrate,
  summarizeAndIntegrateWithTiers
} from './summarizer.js';
import { acquireSessionLock, OperationType } from './memory-lock.js';
import {
  determineCompressionLevelFromSettings,
  saveVersionFiles,
  countOutputTokens
} from './memory-versions-helpers.js';
import {
  validateCompressionSettings,
  ensureVersionsDir,
  generatePartVersionFilename
} from './memory-versions.js';

/**
 * Acquire compression lock with proper error handling
 */
export async function acquireCompressionLock(projectId, sessionId) {
  try {
    return await acquireSessionLock(projectId, sessionId, OperationType.COMPRESSION);
  } catch (lockError) {
    if (lockError.code === 'COMPRESSION_IN_PROGRESS') {
      lockError.status = 409;
    }
    throw lockError;
  }
}

/**
 * Validate settings and throw proper error if invalid
 */
export function validateSettingsOrThrow(settings) {
  const validation = validateCompressionSettings(settings);
  if (!validation.valid) {
    const error = new Error(`Invalid compression settings: ${validation.errors.join('; ')}`);
    error.code = 'INVALID_SETTINGS';
    error.status = 400;
    throw error;
  }
}

/**
 * Load and validate session from manifest
 */
export async function loadSessionOrThrow(projectId, sessionId) {
  const manifest = await loadManifest(projectId);
  const session = manifest.sessions[sessionId];

  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  await ensureDirectoryStructure(projectId);

  return { manifest, session };
}

/**
 * Load and parse session file
 */
export async function loadSourceFile(session) {
  const sourceFile = session.linkedFile || session.originalFile;
  if (!await fs.pathExists(sourceFile)) {
    const error = new Error(`Session file not found: ${sourceFile}`);
    error.code = 'SESSION_FILE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  try {
    return await parseJsonlFile(sourceFile);
  } catch (parseError) {
    const error = new Error(`Failed to parse session file: ${parseError.message}`);
    error.code = 'SESSION_PARSE_ERROR';
    error.status = 400;
    throw error;
  }
}

/**
 * Run compression using the appropriate strategy
 */
export async function runCompression(parsed, uuids, settings) {
  const startTime = Date.now();

  try {
    let result;
    if (settings.mode === 'tiered') {
      result = await summarizeAndIntegrateWithTiers(parsed, uuids, {
        tiers: settings.customTiers || undefined,
        tierPreset: settings.tierPreset || 'standard',
        model: settings.model || 'opus',
        removeNonConversation: true,
        skipFirstMessages: settings.skipFirstMessages || 0
      });
    } else {
      result = await summarizeAndIntegrate(parsed, uuids, {
        compactionRatio: settings.compactionRatio || 10,
        aggressiveness: settings.aggressiveness || 'moderate',
        model: settings.model || 'opus',
        removeNonConversation: true,
        skipFirstMessages: settings.skipFirstMessages || 0
      });
    }

    return {
      result,
      processingTime: Date.now() - startTime
    };
  } catch (summarizeError) {
    const error = new Error(`Compression failed: ${summarizeError.message}`);
    error.code = 'COMPRESSION_FAILED';
    error.status = 500;
    throw error;
  }
}

/**
 * Create compression record with all metadata
 */
export function createCompressionRecord(versionId, filename, settings, stats, messageRange) {
  return {
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
    inputTokens: stats.inputTokens,
    inputMessages: stats.inputMessages,
    outputTokens: stats.outputTokens,
    outputMessages: stats.outputMessages,
    compressionRatio: Number(stats.compressionRatio.toFixed(2)),
    processingTimeMs: stats.processingTime,
    keepitStats: { preserved: 0, summarized: 0, weights: {} },
    fileSizes: { md: stats.mdSize, jsonl: stats.jsonlSize },
    tierResults: stats.tierResults || null,
    partNumber: stats.partNumber,
    compressionLevel: stats.compressionLevel,
    isFullSession: false,
    messageRange
  };
}

/**
 * Save compression and update manifest
 */
export async function saveCompressionToManifest(manifest, session, sessionId, compressionRecord) {
  session.compressions = session.compressions || [];
  session.compressions.push(compressionRecord);
  session.lastAccessed = new Date().toISOString();
  manifest.sessions[sessionId] = session;
  await saveManifest(manifest.projectId || Object.keys(manifest.sessions)[0].split('/')[0], manifest);
}
