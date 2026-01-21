import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { parseJsonlFile } from './jsonl-parser.js';
import { calculateTokenBreakdown } from './token-calculator.js';
import {
  loadManifest,
  saveManifest,
  getSession,
  setSession,
  removeSession as removeSessionFromManifest
} from './memory-manifest.js';
import {
  getOriginalsDir,
  getSummariesDir,
  ensureDirectoryStructure,
  loadGlobalConfig
} from './memory-storage.js';
import { findKeepitsInSession } from './keepit-parser.js';

// Default Claude projects directory
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Get the path to a Claude Code session file
 */
export function getClaudeSessionPath(projectId, sessionId) {
  return path.join(CLAUDE_PROJECTS_DIR, projectId, `${sessionId}.jsonl`);
}

/**
 * Check if a session exists in Claude Code's storage
 */
export async function claudeSessionExists(projectId, sessionId) {
  const sessionPath = getClaudeSessionPath(projectId, sessionId);
  return fs.pathExists(sessionPath);
}

/**
 * Extract metadata from a parsed session
 */
function extractMetadata(parsed) {
  const metadata = {
    gitBranch: null,
    projectName: null,
    claudeVersion: null,
    cwd: null
  };

  if (parsed.metadata) {
    metadata.gitBranch = parsed.metadata.gitBranch || null;
    metadata.projectName = parsed.metadata.projectName || null;
    metadata.claudeVersion = parsed.metadata.version || null;
    metadata.cwd = parsed.metadata.cwd || null;
  }

  // Try to extract from first message if not in metadata
  if (parsed.messages && parsed.messages.length > 0) {
    const firstMessage = parsed.messages[0];
    if (!metadata.gitBranch && firstMessage.gitBranch) {
      metadata.gitBranch = firstMessage.gitBranch;
    }
    if (!metadata.cwd && firstMessage.cwd) {
      metadata.cwd = firstMessage.cwd;
      if (!metadata.projectName) {
        const parts = firstMessage.cwd.split('/');
        metadata.projectName = parts[parts.length - 1] || 'unknown';
      }
    }
    if (!metadata.claudeVersion && firstMessage.version) {
      metadata.claudeVersion = firstMessage.version;
    }
  }

  return metadata;
}

/**
 * Get first timestamp from parsed session
 */
function getFirstTimestamp(parsed) {
  if (!parsed.messages || parsed.messages.length === 0) {
    return null;
  }

  // Find the earliest timestamp
  let earliest = null;
  for (const message of parsed.messages) {
    if (message.timestamp) {
      const ts = new Date(message.timestamp);
      if (!earliest || ts < earliest) {
        earliest = ts;
      }
    }
  }

  return earliest ? earliest.toISOString() : null;
}

/**
 * Get last timestamp from parsed session
 */
function getLastTimestamp(parsed) {
  if (!parsed.messages || parsed.messages.length === 0) {
    return null;
  }

  // Find the latest timestamp
  let latest = null;
  for (const message of parsed.messages) {
    if (message.timestamp) {
      const ts = new Date(message.timestamp);
      if (!latest || ts > latest) {
        latest = ts;
      }
    }
  }

  return latest ? latest.toISOString() : null;
}

/**
 * Get the last message's UUID from parsed session (for sync tracking)
 * Uses proper Date comparison, not ISO string subtraction
 */
function getLastMessageUuid(parsed) {
  if (!parsed.messages || parsed.messages.length === 0) {
    return null;
  }

  // Sort messages by timestamp to find the most recent one
  // CRITICAL: Use new Date() for proper comparison, not raw string subtraction
  const sortedMessages = [...parsed.messages]
    .filter(m => m.timestamp)
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  return sortedMessages[0]?.uuid || null;
}

/**
 * Calculate total tokens from parsed session
 */
function calculateTotalTokens(parsed) {
  const breakdown = calculateTokenBreakdown(parsed);
  return breakdown.combined.total;
}

/**
 * Copy the session file to the originals directory
 * Always copies (no symlinks) to ensure memory system has its own copy
 * that won't be affected if the original is compressed/sanitized
 */
async function copyOriginal(sourcePath, projectId, sessionId) {
  const originalsDir = getOriginalsDir(projectId);
  await fs.ensureDir(originalsDir);

  const destPath = path.join(originalsDir, `${sessionId}.jsonl`);

  // Remove existing file if present
  if (await fs.pathExists(destPath)) {
    await fs.remove(destPath);
  }

  // Always copy (no symlinks) to have our own independent copy
  await fs.copy(sourcePath, destPath);
  return { type: 'copy', path: destPath };
}

/**
 * Remove the session link/copy from the originals directory
 */
async function removeOriginal(projectId, sessionId) {
  const originalsDir = getOriginalsDir(projectId);
  const filePath = path.join(originalsDir, `${sessionId}.jsonl`);

  if (await fs.pathExists(filePath)) {
    await fs.remove(filePath);
    return true;
  }

  return false;
}

/**
 * Register a session in the memory system
 *
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {object} options - Registration options
 * @param {string} options.originalFilePath - Path to the original JSONL file (optional, defaults to Claude's storage)
 * @returns {object} The created session entry
 */
export async function registerSession(projectId, sessionId, options = {}) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId: must be a non-empty string');
  }

  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid sessionId: must be a non-empty string');
  }

  // Check if session is already registered
  const existingSession = await getSession(projectId, sessionId);
  if (existingSession) {
    const error = new Error(`Session ${sessionId} is already registered in project ${projectId}`);
    error.code = 'SESSION_ALREADY_REGISTERED';
    error.status = 409;
    throw error;
  }

  // Determine original file path
  const originalFilePath = options.originalFilePath || getClaudeSessionPath(projectId, sessionId);

  // Verify original file exists
  if (!await fs.pathExists(originalFilePath)) {
    const error = new Error(`Original session file not found: ${originalFilePath}`);
    error.code = 'SESSION_FILE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Ensure directory structure exists
  await ensureDirectoryStructure(projectId);

  // Parse the session file
  let parsed;
  try {
    parsed = await parseJsonlFile(originalFilePath);
  } catch (error) {
    const parseError = new Error(`Failed to parse session file: ${error.message}`);
    parseError.code = 'SESSION_PARSE_ERROR';
    parseError.status = 400;
    throw parseError;
  }

  // Copy the session file (always copy, no symlinks for sync support)
  const copyResult = await copyOriginal(originalFilePath, projectId, sessionId);

  // Extract metadata
  const metadata = extractMetadata(parsed);
  const firstTimestamp = getFirstTimestamp(parsed);
  const lastTimestamp = getLastTimestamp(parsed);
  const lastMessageUuid = getLastMessageUuid(parsed);
  const totalTokens = calculateTotalTokens(parsed);

  // Extract keepit markers from all messages
  const keepitMarkers = findKeepitsInSession(parsed);

  // Create session entry
  const now = new Date().toISOString();
  const sessionEntry = {
    sessionId,
    originalFile: originalFilePath,
    linkedFile: copyResult.path,
    linkType: copyResult.type,
    originalTokens: totalTokens,
    originalMessages: parsed.totalMessages,
    firstTimestamp,
    lastTimestamp,
    registeredAt: now,
    lastAccessed: now,
    metadata,
    keepitMarkers,
    compressions: [],
    // Sync tracking fields
    lastSyncedTimestamp: lastTimestamp,
    lastSyncedMessageUuid: lastMessageUuid,
    messageCount: parsed.totalMessages
  };

  // Save to manifest
  await setSession(projectId, sessionId, sessionEntry);

  return sessionEntry;
}

/**
 * Unregister a session from the memory system
 *
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {object} options - Unregistration options
 * @param {boolean} options.deleteSummaries - Whether to delete the session's summaries directory (default: false)
 * @returns {object} The removed session entry
 */
export async function unregisterSession(projectId, sessionId, options = {}) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId: must be a non-empty string');
  }

  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid sessionId: must be a non-empty string');
  }

  // Check if session exists
  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Remove symlink/copy from originals
  await removeOriginal(projectId, sessionId);

  // Optionally remove summaries directory
  if (options.deleteSummaries) {
    const summariesDir = getSummariesDir(projectId);
    const sessionSummariesDir = path.join(summariesDir, sessionId);
    if (await fs.pathExists(sessionSummariesDir)) {
      await fs.remove(sessionSummariesDir);
    }
  }

  // Remove from manifest
  const removedSession = await removeSessionFromManifest(projectId, sessionId);

  return removedSession;
}

/**
 * Get details of a registered session
 *
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {object} options - Options
 * @param {boolean} options.updateLastAccessed - Whether to update lastAccessed timestamp (default: true)
 * @returns {object} The session entry
 */
export async function getSessionDetails(projectId, sessionId, options = {}) {
  const { updateLastAccessed = true } = options;

  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  if (updateLastAccessed) {
    const manifest = await loadManifest(projectId);
    manifest.sessions[sessionId].lastAccessed = new Date().toISOString();
    await saveManifest(projectId, manifest);
    session.lastAccessed = manifest.sessions[sessionId].lastAccessed;
  }

  return session;
}

/**
 * List all registered sessions for a project
 *
 * @param {string} projectId - The project ID
 * @returns {object[]} Array of session entries
 */
export async function listRegisteredSessions(projectId) {
  const manifest = await loadManifest(projectId);
  return Object.values(manifest.sessions);
}

/**
 * Check if a session is registered
 *
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {boolean} True if registered
 */
export async function isSessionRegistered(projectId, sessionId) {
  const session = await getSession(projectId, sessionId);
  return session !== null;
}

/**
 * Refresh a session's metadata by re-parsing the original file
 * Useful if the original file has been modified
 *
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {object} The updated session entry
 */
export async function refreshSession(projectId, sessionId) {
  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Re-parse the original file
  if (!await fs.pathExists(session.originalFile)) {
    const error = new Error(`Original session file no longer exists: ${session.originalFile}`);
    error.code = 'SESSION_FILE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const parsed = await parseJsonlFile(session.originalFile);

  // Update metadata
  const metadata = extractMetadata(parsed);
  const firstTimestamp = getFirstTimestamp(parsed);
  const lastTimestamp = getLastTimestamp(parsed);
  const lastMessageUuid = getLastMessageUuid(parsed);
  const totalTokens = calculateTotalTokens(parsed);

  // Re-extract keepit markers
  const keepitMarkers = findKeepitsInSession(parsed);

  const updatedEntry = {
    ...session,
    originalTokens: totalTokens,
    originalMessages: parsed.totalMessages,
    firstTimestamp,
    lastTimestamp,
    lastAccessed: new Date().toISOString(),
    metadata,
    keepitMarkers,
    // Update sync tracking fields
    lastSyncedTimestamp: lastTimestamp,
    lastSyncedMessageUuid: lastMessageUuid,
    messageCount: parsed.totalMessages
  };

  // Update the copy
  await copyOriginal(session.originalFile, projectId, sessionId);

  // Save to manifest
  await setSession(projectId, sessionId, updatedEntry);

  return updatedEntry;
}

/**
 * Get sessions that haven't been accessed recently
 * Useful for finding stale sessions
 *
 * @param {string} projectId - The project ID
 * @param {number} daysSinceAccess - Number of days since last access
 * @returns {object[]} Array of stale session entries
 */
export async function getStaleSessions(projectId, daysSinceAccess = 30) {
  const sessions = await listRegisteredSessions(projectId);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysSinceAccess);

  return sessions.filter(session => {
    if (!session.lastAccessed) return true;
    const lastAccess = new Date(session.lastAccessed);
    return lastAccess < cutoffDate;
  });
}

/**
 * Get session statistics for a project
 *
 * @param {string} projectId - The project ID
 * @returns {object} Statistics object
 */
export async function getProjectSessionStats(projectId) {
  const sessions = await listRegisteredSessions(projectId);

  let totalTokens = 0;
  let totalMessages = 0;
  let totalCompressions = 0;
  let sessionsWithCompressions = 0;

  for (const session of sessions) {
    totalTokens += session.originalTokens || 0;
    totalMessages += session.originalMessages || 0;
    totalCompressions += session.compressions?.length || 0;
    if (session.compressions?.length > 0) {
      sessionsWithCompressions++;
    }
  }

  return {
    sessionCount: sessions.length,
    totalTokens,
    totalMessages,
    totalCompressions,
    sessionsWithCompressions,
    averageTokensPerSession: sessions.length > 0 ? Math.round(totalTokens / sessions.length) : 0,
    averageMessagesPerSession: sessions.length > 0 ? Math.round(totalMessages / sessions.length) : 0
  };
}

/**
 * Find unregistered sessions in Claude Code's storage
 * Returns sessions that exist in Claude but aren't in our memory system
 *
 * @param {string} projectId - The project ID
 * @returns {object[]} Array of unregistered session info
 */
export async function findUnregisteredSessions(projectId) {
  const claudeProjectDir = path.join(CLAUDE_PROJECTS_DIR, projectId);

  if (!await fs.pathExists(claudeProjectDir)) {
    return [];
  }

  // Get registered sessions
  const manifest = await loadManifest(projectId);
  const registeredSessionIds = new Set(Object.keys(manifest.sessions));

  // Scan Claude project directory
  const entries = await fs.readdir(claudeProjectDir, { withFileTypes: true });
  const unregistered = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue;
    }

    const sessionId = entry.name.replace('.jsonl', '');

    if (!registeredSessionIds.has(sessionId)) {
      const filePath = path.join(claudeProjectDir, entry.name);
      const stats = await fs.stat(filePath);

      unregistered.push({
        sessionId,
        filePath,
        size: stats.size,
        lastModified: stats.mtime.toISOString()
      });
    }
  }

  return unregistered.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
}
