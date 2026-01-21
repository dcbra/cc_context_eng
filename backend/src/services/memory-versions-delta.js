/**
 * Delta compression functions for incremental compression support
 * Handles compressing new messages and re-compressing parts
 */

import { loadManifest, saveManifest } from './memory-manifest.js';
import {
  detectDelta,
  getPartVersions,
  canRecompressPart,
  generatePartVersionId
} from './memory-delta.js';
import {
  determineCompressionLevelFromSettings,
  saveVersionFiles,
  countOutputTokens,
  calculateDeltaTokens
} from './memory-versions-helpers.js';
import { ensureVersionsDir, generatePartVersionFilename } from './memory-versions.js';
import {
  acquireCompressionLock,
  validateSettingsOrThrow,
  loadSessionOrThrow,
  loadSourceFile,
  runCompression,
  createCompressionRecord
} from './memory-versions-delta-helpers.js';

/**
 * Create a compression version for delta (new messages only)
 * This compresses only messages that haven't been compressed yet.
 */
export async function createDeltaCompression(projectId, sessionId, settings) {
  validateSettingsOrThrow(settings);

  const lock = await acquireCompressionLock(projectId, sessionId);

  try {
    const { manifest, session } = await loadSessionOrThrow(projectId, sessionId);
    await loadSourceFile(session); // Validate file exists

    const delta = await detectDelta(projectId, sessionId);

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

    const partNumber = delta.previousPartNumber + 1;
    const versionId = generatePartVersionId(session, partNumber);
    const deltaUuids = delta.deltaMessages.map(m => m.uuid);

    const deltaParsed = {
      messages: delta.deltaMessages,
      totalMessages: delta.deltaMessages.length
    };

    const { result, processingTime } = await runCompression(deltaParsed, deltaUuids, settings);

    const outputTokens = countOutputTokens(result.messages);
    const inputTokens = calculateDeltaTokens(delta.deltaMessages);
    const compressionLevel = determineCompressionLevelFromSettings(settings);

    const versionsDir = await ensureVersionsDir(projectId, sessionId);
    const filename = generatePartVersionFilename(partNumber, compressionLevel);
    const savedFiles = await saveVersionFiles(versionsDir, filename, result);

    const compressionRecord = createCompressionRecord(versionId, filename, settings, {
      inputTokens,
      inputMessages: delta.deltaMessages.length,
      outputTokens,
      outputMessages: result.messages.length,
      compressionRatio: outputTokens > 0 ? inputTokens / outputTokens : 1,
      processingTime,
      mdSize: savedFiles.mdSize,
      jsonlSize: savedFiles.jsonlSize,
      tierResults: result.tierResults,
      partNumber,
      compressionLevel
    }, {
      startTimestamp: delta.startTimestamp,
      endTimestamp: delta.endTimestamp,
      startIndex: delta.startIndex,
      endIndex: delta.endIndex,
      messageCount: delta.deltaMessages.length
    });

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
 * Re-compress an existing part at a different compression level
 * Creates a new version of the same message range
 */
export async function recompressPart(projectId, sessionId, partNumber, settings) {
  validateSettingsOrThrow(settings);

  const lock = await acquireCompressionLock(projectId, sessionId);

  try {
    const { manifest, session } = await loadSessionOrThrow(projectId, sessionId);

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

    const newLevel = determineCompressionLevelFromSettings(settings);
    if (!canRecompressPart(session, partNumber, newLevel)) {
      const error = new Error(
        `Part ${partNumber} already has a version at compression level ${newLevel}`
      );
      error.code = 'VERSION_EXISTS';
      error.status = 409;
      throw error;
    }

    const parsed = await loadSourceFile(session);
    const partMessages = parsed.messages.slice(messageRange.startIndex, messageRange.endIndex);

    if (partMessages.length < 2) {
      const error = new Error('Part must have at least 2 messages');
      error.code = 'INSUFFICIENT_MESSAGES';
      error.status = 400;
      throw error;
    }

    const versionId = generatePartVersionId(session, partNumber);
    const partParsed = { messages: partMessages, totalMessages: partMessages.length };
    const partUuids = partMessages.map(m => m.uuid);

    const { result, processingTime } = await runCompression(partParsed, partUuids, settings);

    const outputTokens = countOutputTokens(result.messages);

    const versionsDir = await ensureVersionsDir(projectId, sessionId);
    const filename = generatePartVersionFilename(partNumber, newLevel);
    const savedFiles = await saveVersionFiles(versionsDir, filename, result);

    const compressionRecord = createCompressionRecord(versionId, filename, settings, {
      inputTokens: existingPart.inputTokens,
      inputMessages: existingPart.inputMessages,
      outputTokens,
      outputMessages: result.messages.length,
      compressionRatio: outputTokens > 0 ? existingPart.inputTokens / outputTokens : 1,
      processingTime,
      mdSize: savedFiles.mdSize,
      jsonlSize: savedFiles.jsonlSize,
      tierResults: result.tierResults,
      partNumber,
      compressionLevel: newLevel
    }, messageRange);

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
