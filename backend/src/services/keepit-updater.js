/**
 * Keepit Updater
 *
 * Handles updating keepit marker weights in original session files.
 * Per design doc Section 5.4, weight updates modify the ORIGINAL session file.
 */

import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import { validateWeight, updateKeepitWeight as updateWeightInText } from './keepit-parser.js';
import { loadManifest, saveManifest, getSession } from './memory-manifest.js';

// Backup directory relative to original file
const BACKUP_SUFFIX = '.backup';

/**
 * Create a backup of the original file before modification
 *
 * @param {string} filePath - Path to the file to backup
 * @returns {string} Path to the backup file
 */
async function createBackup(filePath) {
  const backupPath = `${filePath}${BACKUP_SUFFIX}`;
  await fs.copy(filePath, backupPath);
  return backupPath;
}

/**
 * Read a JSONL file and return its lines as parsed objects
 *
 * @param {string} filePath - Path to the JSONL file
 * @returns {Array} Array of parsed line objects with original line text
 */
async function readJsonlLines(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const lines = [];
  for await (const line of rl) {
    if (!line.trim()) {
      lines.push({ raw: line, parsed: null, empty: true });
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      lines.push({ raw: line, parsed, empty: false });
    } catch (error) {
      // Keep unparseable lines as-is
      lines.push({ raw: line, parsed: null, error: error.message, empty: false });
    }
  }

  return lines;
}

/**
 * Write lines back to a JSONL file
 *
 * @param {string} filePath - Path to write to
 * @param {Array} lines - Array of line objects
 */
async function writeJsonlLines(filePath, lines) {
  const content = lines.map(line => {
    if (line.empty) return '';
    if (line.parsed) return JSON.stringify(line.parsed);
    return line.raw;
  }).join('\n');

  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Extract text content from a message for searching
 *
 * @param {object} message - Parsed message object
 * @returns {string} Text content
 */
function getMessageTextContent(message) {
  if (!message.message || !message.message.content) return '';

  const content = message.message.content;
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .filter(block => block && block.type === 'text')
      .map(block => block.text || '')
      .join('\n');
  }

  return '';
}

/**
 * Update text content in a message
 *
 * @param {object} message - Parsed message object
 * @param {string} oldText - Text to find
 * @param {string} newText - Text to replace with
 * @returns {boolean} True if replacement was made
 */
function updateMessageTextContent(message, oldText, newText) {
  if (!message.message || !message.message.content) return false;

  const content = message.message.content;

  if (typeof content === 'string') {
    if (content.includes(oldText)) {
      message.message.content = content.replace(oldText, newText);
      return true;
    }
    return false;
  }

  if (Array.isArray(content)) {
    let updated = false;
    for (const block of content) {
      if (block && block.type === 'text' && block.text && block.text.includes(oldText)) {
        block.text = block.text.replace(oldText, newText);
        updated = true;
      }
    }
    return updated;
  }

  return false;
}

/**
 * Update a keepit marker's weight in the original session file
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {string} markerId - The marker ID to update
 * @param {number} newWeight - The new weight value (0.00-1.00)
 * @param {object} options - Update options
 * @returns {object} Updated marker and session info
 */
export async function updateKeepitMarkerWeight(projectId, sessionId, markerId, newWeight, options = {}) {
  const { createBackup: shouldBackup = true } = options;

  // Validate new weight
  const validatedWeight = validateWeight(newWeight);

  // Load session from manifest
  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Find the marker in the session
  const marker = session.keepitMarkers?.find(m => m.markerId === markerId);
  if (!marker) {
    const error = new Error(`Keepit marker ${markerId} not found in session ${sessionId}`);
    error.code = 'KEEPIT_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Check if weight is actually changing
  if (Math.abs(marker.weight - validatedWeight) < 0.001) {
    return {
      marker,
      changed: false,
      message: 'Weight unchanged'
    };
  }

  const originalFile = session.originalFile;

  // Verify original file exists
  if (!await fs.pathExists(originalFile)) {
    const error = new Error(`Original session file not found: ${originalFile}`);
    error.code = 'SESSION_FILE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Create backup before modification
  let backupPath = null;
  if (shouldBackup) {
    backupPath = await createBackup(originalFile);
  }

  try {
    // Read the JSONL file
    const lines = await readJsonlLines(originalFile);

    // Find the message containing this keepit
    let messageFound = false;
    let lineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.parsed || line.parsed.uuid !== marker.messageUuid) continue;

      lineIndex = i;
      const text = getMessageTextContent(line.parsed);

      // Build the old pattern to find
      const oldPattern = `##keepit${marker.weight.toFixed(2)}##${marker.content}`;
      const newPattern = `##keepit${validatedWeight.toFixed(2)}##${marker.content}`;

      if (text.includes(oldPattern)) {
        // Update the message content
        const updated = updateMessageTextContent(line.parsed, oldPattern, newPattern);
        if (updated) {
          messageFound = true;
          break;
        }
      }

      // Also try with just the pattern (in case content was slightly reformatted)
      const oldWeightMarker = `##keepit${marker.weight.toFixed(2)}##`;
      const newWeightMarker = `##keepit${validatedWeight.toFixed(2)}##`;

      // Find the specific occurrence by checking content follows
      if (text.includes(oldWeightMarker + marker.content.substring(0, 50))) {
        const updated = updateMessageTextContent(line.parsed, oldWeightMarker, newWeightMarker);
        if (updated) {
          messageFound = true;
          break;
        }
      }
    }

    if (!messageFound) {
      // Restore backup if we made one
      if (backupPath) {
        await fs.copy(backupPath, originalFile);
      }

      const error = new Error(`Could not find keepit marker content in message ${marker.messageUuid}`);
      error.code = 'KEEPIT_CONTENT_NOT_FOUND';
      error.status = 400;
      throw error;
    }

    // Write updated file
    await writeJsonlLines(originalFile, lines);

    // Update the manifest with new weight
    const manifest = await loadManifest(projectId);
    const sessionEntry = manifest.sessions[sessionId];
    const manifestMarker = sessionEntry.keepitMarkers?.find(m => m.markerId === markerId);

    if (manifestMarker) {
      const oldWeight = manifestMarker.weight;
      manifestMarker.weight = validatedWeight;
      manifestMarker.lastModified = new Date().toISOString();

      // Track weight history
      if (!manifestMarker.weightHistory) {
        manifestMarker.weightHistory = [];
      }
      manifestMarker.weightHistory.push({
        previousWeight: oldWeight,
        newWeight: validatedWeight,
        changedAt: new Date().toISOString()
      });

      await saveManifest(projectId, manifest);
    }

    return {
      marker: manifestMarker || marker,
      changed: true,
      previousWeight: marker.weight,
      newWeight: validatedWeight,
      backupPath,
      message: `Weight updated from ${marker.weight.toFixed(2)} to ${validatedWeight.toFixed(2)}`
    };
  } catch (error) {
    // Restore backup on any error
    if (backupPath && await fs.pathExists(backupPath)) {
      await fs.copy(backupPath, originalFile);
    }
    throw error;
  }
}

/**
 * Delete a keepit marker (removes the ##keepit## pattern but keeps content)
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {string} markerId - The marker ID to delete
 * @param {object} options - Delete options
 * @returns {object} Deletion result
 */
export async function deleteKeepitMarker(projectId, sessionId, markerId, options = {}) {
  const { createBackup: shouldBackup = true } = options;

  // Load session from manifest
  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Find the marker in the session
  const markerIndex = session.keepitMarkers?.findIndex(m => m.markerId === markerId);
  if (markerIndex === -1 || markerIndex === undefined) {
    const error = new Error(`Keepit marker ${markerId} not found in session ${sessionId}`);
    error.code = 'KEEPIT_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const marker = session.keepitMarkers[markerIndex];
  const originalFile = session.originalFile;

  // Verify original file exists
  if (!await fs.pathExists(originalFile)) {
    const error = new Error(`Original session file not found: ${originalFile}`);
    error.code = 'SESSION_FILE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Create backup
  let backupPath = null;
  if (shouldBackup) {
    backupPath = await createBackup(originalFile);
  }

  try {
    // Read the JSONL file
    const lines = await readJsonlLines(originalFile);

    // Find and update the message
    let messageFound = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.parsed || line.parsed.uuid !== marker.messageUuid) continue;

      const text = getMessageTextContent(line.parsed);

      // Remove the keepit marker but keep the content
      const pattern = `##keepit${marker.weight.toFixed(2)}##`;

      if (text.includes(pattern)) {
        const updated = updateMessageTextContent(line.parsed, pattern, '');
        if (updated) {
          messageFound = true;
          break;
        }
      }
    }

    if (!messageFound) {
      if (backupPath) {
        await fs.copy(backupPath, originalFile);
      }
      const error = new Error(`Could not find keepit marker in message ${marker.messageUuid}`);
      error.code = 'KEEPIT_CONTENT_NOT_FOUND';
      error.status = 400;
      throw error;
    }

    // Write updated file
    await writeJsonlLines(originalFile, lines);

    // Remove from manifest
    const manifest = await loadManifest(projectId);
    const sessionEntry = manifest.sessions[sessionId];
    sessionEntry.keepitMarkers = sessionEntry.keepitMarkers.filter(m => m.markerId !== markerId);
    await saveManifest(projectId, manifest);

    return {
      deleted: true,
      markerId,
      backupPath,
      message: `Keepit marker ${markerId} removed (content preserved)`
    };
  } catch (error) {
    if (backupPath && await fs.pathExists(backupPath)) {
      await fs.copy(backupPath, originalFile);
    }
    throw error;
  }
}

/**
 * Add a new keepit marker to content in a session
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {string} messageUuid - UUID of the message to mark
 * @param {string} contentToMark - The exact content to mark
 * @param {number} weight - Weight for the marker (0.00-1.00)
 * @param {object} options - Add options
 * @returns {object} Created marker info
 */
export async function addKeepitMarker(projectId, sessionId, messageUuid, contentToMark, weight, options = {}) {
  const { createBackup: shouldBackup = true } = options;
  const validatedWeight = validateWeight(weight);

  // Load session from manifest
  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const originalFile = session.originalFile;

  // Verify original file exists
  if (!await fs.pathExists(originalFile)) {
    const error = new Error(`Original session file not found: ${originalFile}`);
    error.code = 'SESSION_FILE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Create backup
  let backupPath = null;
  if (shouldBackup) {
    backupPath = await createBackup(originalFile);
  }

  try {
    // Read the JSONL file
    const lines = await readJsonlLines(originalFile);

    // Find the message
    let messageFound = false;
    let lineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.parsed || line.parsed.uuid !== messageUuid) continue;

      lineIndex = i;
      const text = getMessageTextContent(line.parsed);

      // Check if content exists in message
      if (!text.includes(contentToMark)) {
        const error = new Error(`Content not found in message ${messageUuid}`);
        error.code = 'CONTENT_NOT_FOUND';
        error.status = 400;
        throw error;
      }

      // Check if already marked
      const keepitPattern = `##keepit`;
      if (text.includes(keepitPattern + contentToMark.substring(0, 20))) {
        const error = new Error(`Content is already marked with a keepit`);
        error.code = 'ALREADY_MARKED';
        error.status = 400;
        throw error;
      }

      // Add the keepit marker before the content
      const markedContent = `##keepit${validatedWeight.toFixed(2)}##${contentToMark}`;
      const updated = updateMessageTextContent(line.parsed, contentToMark, markedContent);

      if (updated) {
        messageFound = true;
        break;
      }
    }

    if (!messageFound) {
      if (backupPath) {
        await fs.copy(backupPath, originalFile);
      }
      const error = new Error(`Message ${messageUuid} not found in session`);
      error.code = 'MESSAGE_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    // Write updated file
    await writeJsonlLines(originalFile, lines);

    // Add to manifest
    const manifest = await loadManifest(projectId);
    const sessionEntry = manifest.sessions[sessionId];

    // Generate new marker ID
    const markerId = `keepit_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;

    const newMarker = {
      markerId,
      messageUuid,
      weight: validatedWeight,
      content: contentToMark,
      position: { start: 0, end: 0 }, // Position tracking not precise after modification
      context: {
        before: '',
        after: ''
      },
      createdAt: new Date().toISOString(),
      survivedIn: [],
      summarizedIn: []
    };

    if (!sessionEntry.keepitMarkers) {
      sessionEntry.keepitMarkers = [];
    }
    sessionEntry.keepitMarkers.push(newMarker);

    await saveManifest(projectId, manifest);

    return {
      created: true,
      marker: newMarker,
      backupPath,
      message: `Keepit marker added with weight ${validatedWeight.toFixed(2)}`
    };
  } catch (error) {
    if (backupPath && await fs.pathExists(backupPath)) {
      await fs.copy(backupPath, originalFile);
    }
    throw error;
  }
}

/**
 * List all keepit markers for a session
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @returns {Array} Array of keepit markers
 */
export async function listKeepitMarkers(projectId, sessionId) {
  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  return session.keepitMarkers || [];
}

/**
 * Get a specific keepit marker
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {string} markerId - Marker ID
 * @returns {object} Keepit marker
 */
export async function getKeepitMarker(projectId, sessionId, markerId) {
  const markers = await listKeepitMarkers(projectId, sessionId);
  const marker = markers.find(m => m.markerId === markerId);

  if (!marker) {
    const error = new Error(`Keepit marker ${markerId} not found in session ${sessionId}`);
    error.code = 'KEEPIT_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  return marker;
}

/**
 * Clean up old backup files
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {object} options - Cleanup options
 * @returns {object} Cleanup result
 */
export async function cleanupBackups(projectId, sessionId, options = {}) {
  const { keepLatest = 1 } = options;

  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const originalFile = session.originalFile;
  const backupPath = `${originalFile}${BACKUP_SUFFIX}`;

  const removed = [];
  if (await fs.pathExists(backupPath)) {
    if (keepLatest === 0) {
      await fs.remove(backupPath);
      removed.push(backupPath);
    }
    // Note: For multiple versioned backups, we'd need to implement
    // timestamped backup naming. Current implementation keeps just one.
  }

  return {
    cleaned: removed.length,
    removed
  };
}
