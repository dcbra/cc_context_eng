/**
 * Memory Delta Detection Service
 *
 * Handles detection of new messages that need compression (the delta)
 * and management of compression parts for incremental compression.
 */

import fs from 'fs-extra';
import { parseJsonlFile } from './jsonl-parser.js';
import { loadManifest, getSession } from './memory-manifest.js';

/**
 * Get the highest part number for a session's compressions
 * Returns 0 if no parts exist
 *
 * @param {Object} session - Session object from manifest
 * @returns {number} Highest part number (0 if no parts exist)
 */
export function getHighestPartNumber(session) {
  if (!session || !session.compressions || session.compressions.length === 0) {
    return 0;
  }

  const partNumbers = session.compressions
    .filter(c => c.partNumber !== undefined)
    .map(c => c.partNumber);

  if (partNumbers.length === 0) {
    return 0;
  }

  return Math.max(...partNumbers);
}

/**
 * Get the latest compression part for a session
 * Returns the part with the highest part number (most recent version)
 *
 * @param {Object} session - Session object from manifest
 * @returns {Object|null} Latest compression part or null
 */
export function getLatestPart(session) {
  if (!session || !session.compressions || session.compressions.length === 0) {
    return null;
  }

  const highestPartNumber = getHighestPartNumber(session);
  if (highestPartNumber === 0) return null;

  // Get all versions of the highest part number
  const latestParts = session.compressions.filter(
    c => c.partNumber === highestPartNumber
  );

  if (latestParts.length === 0) return null;

  // Return the most recently created version of this part
  // CRITICAL: Use new Date() for proper comparison
  return latestParts.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  )[0];
}

/**
 * Get the last compression's end timestamp
 * Used to determine where delta compression should start
 *
 * @param {Object} session - Session object from manifest
 * @returns {string|null} ISO timestamp of last compression end, or null
 */
export function getLastCompressionEndTimestamp(session) {
  if (!session || !session.compressions || session.compressions.length === 0) {
    return null;
  }

  // Find compressions with messageRange data
  const withRange = session.compressions.filter(c => c.messageRange?.endTimestamp);

  if (withRange.length === 0) {
    return null;
  }

  // Sort by endTimestamp descending (most recent first)
  // CRITICAL: Use new Date() for proper comparison
  const sorted = withRange.sort((a, b) =>
    new Date(b.messageRange.endTimestamp) - new Date(a.messageRange.endTimestamp)
  );

  return sorted[0].messageRange.endTimestamp;
}

/**
 * Detect messages that haven't been compressed yet (the delta)
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @returns {Object} Delta information including hasDelta, deltaCount, deltaMessages
 */
export async function detectDelta(projectId, sessionId) {
  const session = await getSession(projectId, sessionId);

  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Use linkedFile (memory copy) which is kept in sync
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

  // Get last compression's end timestamp
  const lastCompressedTimestamp = getLastCompressionEndTimestamp(session);
  const latestPart = getLatestPart(session);

  // If no compressions exist, all messages are the delta
  if (!lastCompressedTimestamp || !latestPart || !latestPart.messageRange) {
    // Sort messages by timestamp
    const sortedMessages = [...parsed.messages].sort(
      (a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
    );

    return {
      hasDelta: sortedMessages.length > 0,
      deltaCount: sortedMessages.length,
      deltaMessages: sortedMessages,
      lastCompressedTimestamp: null,
      startIndex: 0,
      endIndex: sortedMessages.length,
      startTimestamp: sortedMessages[0]?.timestamp || null,
      endTimestamp: sortedMessages[sortedMessages.length - 1]?.timestamp || null,
      isFirstPart: true,
      previousPartNumber: 0
    };
  }

  const lastEndDate = new Date(lastCompressedTimestamp);
  const lastEndIndex = latestPart.messageRange.endIndex || 0;

  // Filter messages AFTER the last compressed range
  // CRITICAL: Use new Date() for proper timestamp comparison
  const deltaMessages = parsed.messages.filter((msg, idx) => {
    // First check by index if we have reliable index data
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
    deltaCount: deltaMessages.length,
    deltaMessages,
    lastCompressedTimestamp,
    startIndex: lastEndIndex,
    endIndex: lastEndIndex + deltaMessages.length,
    startTimestamp: deltaMessages[0]?.timestamp || null,
    endTimestamp: deltaMessages[deltaMessages.length - 1]?.timestamp || null,
    isFirstPart: false,
    previousPartNumber: latestPart.partNumber
  };
}

/**
 * Get delta status (lightweight, for UI)
 * Returns only counts and metadata, not full messages
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @returns {Object} Delta status info
 */
export async function getDeltaStatus(projectId, sessionId) {
  const session = await getSession(projectId, sessionId);

  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Use linkedFile (memory copy) which is kept in sync
  const sourceFile = session.linkedFile || session.originalFile;
  if (!await fs.pathExists(sourceFile)) {
    return {
      sessionId,
      hasDelta: false,
      deltaMessageCount: 0,
      deltaRange: null,
      currentPartCount: getHighestPartNumber(session),
      nextPartNumber: 1,
      error: 'Session file not found'
    };
  }

  // Parse the session file to get current message count
  let parsed;
  try {
    parsed = await parseJsonlFile(sourceFile);
  } catch (parseError) {
    return {
      sessionId,
      hasDelta: false,
      deltaMessageCount: 0,
      deltaRange: null,
      currentPartCount: getHighestPartNumber(session),
      nextPartNumber: 1,
      error: `Failed to parse session file: ${parseError.message}`
    };
  }

  // Get last compression's end timestamp and part info
  const lastCompressedTimestamp = getLastCompressionEndTimestamp(session);
  const latestPart = getLatestPart(session);
  const currentPartCount = getHighestPartNumber(session);

  // If no compressions exist, all messages are the delta
  if (!lastCompressedTimestamp || !latestPart || !latestPart.messageRange) {
    return {
      sessionId,
      hasDelta: parsed.messages.length > 0,
      deltaMessageCount: parsed.messages.length,
      deltaRange: parsed.messages.length > 0 ? {
        startIndex: 0,
        endIndex: parsed.messages.length,
        startTimestamp: parsed.messages[0]?.timestamp || null,
        endTimestamp: parsed.messages[parsed.messages.length - 1]?.timestamp || null
      } : null,
      currentPartCount,
      nextPartNumber: 1
    };
  }

  const lastEndDate = new Date(lastCompressedTimestamp);
  const lastEndIndex = latestPart.messageRange.endIndex || 0;

  // Count messages AFTER the last compressed range
  let deltaCount = 0;
  let firstDeltaTimestamp = null;
  let lastDeltaTimestamp = null;

  for (let idx = 0; idx < parsed.messages.length; idx++) {
    const msg = parsed.messages[idx];
    let isInDelta = false;

    // First check by index if we have reliable index data
    if (idx >= lastEndIndex) {
      isInDelta = true;
    } else if (msg.timestamp) {
      // Fall back to timestamp comparison
      const msgDate = new Date(msg.timestamp);
      if (msgDate > lastEndDate) {
        isInDelta = true;
      }
    }

    if (isInDelta) {
      deltaCount++;
      if (!firstDeltaTimestamp && msg.timestamp) {
        firstDeltaTimestamp = msg.timestamp;
      }
      if (msg.timestamp) {
        lastDeltaTimestamp = msg.timestamp;
      }
    }
  }

  return {
    sessionId,
    hasDelta: deltaCount > 0,
    deltaMessageCount: deltaCount,
    deltaRange: deltaCount > 0 ? {
      startIndex: lastEndIndex,
      endIndex: lastEndIndex + deltaCount,
      startTimestamp: firstDeltaTimestamp,
      endTimestamp: lastDeltaTimestamp
    } : null,
    currentPartCount,
    nextPartNumber: currentPartCount + 1
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

  if (!session || !session.compressions) {
    return parts;
  }

  for (const compression of session.compressions) {
    const partNumber = compression.partNumber || 1;
    if (!parts.has(partNumber)) {
      parts.set(partNumber, []);
    }
    parts.get(partNumber).push(compression);
  }

  // Sort versions within each part by compression level
  for (const versions of parts.values()) {
    versions.sort((a, b) => {
      const levelA = getLevelNumber(a.compressionLevel);
      const levelB = getLevelNumber(b.compressionLevel);
      return levelA - levelB;
    });
  }

  return parts;
}

/**
 * Convert compression level string to number for sorting
 */
function getLevelNumber(level) {
  if (level === 'light' || level === 1) return 1;
  if (level === 'moderate' || level === 2) return 2;
  if (level === 'aggressive' || level === 3) return 3;
  return 2; // default
}

/**
 * Get all versions of a specific part
 *
 * @param {Object} session - Session object from manifest
 * @param {number} partNumber - Part number to get
 * @returns {Array} Array of compression versions for this part
 */
export function getPartVersions(session, partNumber) {
  if (!session || !session.compressions) {
    return [];
  }

  return session.compressions.filter(
    c => (c.partNumber || 1) === partNumber
  );
}

/**
 * Check if a part can be re-compressed at a different level
 *
 * @param {Object} session - Session object from manifest
 * @param {number} partNumber - Part number to check
 * @param {string} compressionLevel - Target compression level
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
