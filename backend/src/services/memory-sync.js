/**
 * Memory Session Sync Service
 *
 * Handles append-only synchronization of new messages from the original
 * Claude session file to the memory system's copy.
 */

import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import {
  loadManifest,
  saveManifest,
  getSession,
  setSession
} from './memory-manifest.js';
import { getOriginalsDir } from './memory-storage.js';
import { parseJsonlFile } from './jsonl-parser.js';

/**
 * Parse a JSONL file and return raw records (without enhancement)
 * Used for extracting messages with their raw data for appending
 */
async function parseJsonlRaw(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const records = [];
  const seenUuids = new Set();

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line);
      // Only include message records (user, assistant, system)
      if (record.type === 'user' || record.type === 'assistant' || record.type === 'system') {
        // Skip duplicates
        if (record.uuid && seenUuids.has(record.uuid)) {
          continue;
        }
        if (record.uuid) {
          seenUuids.add(record.uuid);
        }
        records.push({
          ...record,
          _rawLine: line // Preserve original JSON for appending
        });
      }
    } catch (error) {
      console.warn(`Failed to parse line in ${filePath}:`, error.message);
    }
  }

  return records;
}

/**
 * Check if original session has new messages not yet in memory copy
 *
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {{ hasNewMessages: boolean, newCount: number, newMessages: array, lastSynced: string }}
 */
export async function detectNewMessages(projectId, sessionId) {
  // Get session from manifest
  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const originalPath = session.originalFile;
  const lastSyncedTimestamp = session.lastSyncedTimestamp;
  const lastSyncedMessageUuid = session.lastSyncedMessageUuid;

  // Check if original file still exists
  if (!await fs.pathExists(originalPath)) {
    return {
      hasNewMessages: false,
      newCount: 0,
      newMessages: [],
      lastSynced: lastSyncedTimestamp,
      error: 'ORIGINAL_NOT_FOUND',
      errorMessage: `Original file not found: ${originalPath}`
    };
  }

  // Parse the original file
  const originalRecords = await parseJsonlRaw(originalPath);

  // Find messages with timestamp after lastSyncedTimestamp
  // CRITICAL: Use new Date() for proper timestamp comparison
  const lastSyncedDate = lastSyncedTimestamp ? new Date(lastSyncedTimestamp) : new Date(0);

  // Filter for new messages (timestamp after last sync)
  // Also check UUID to avoid duplicates in case of timestamp ties
  const seenUuids = new Set();
  if (lastSyncedMessageUuid) {
    seenUuids.add(lastSyncedMessageUuid);
  }

  let newMessages = originalRecords.filter(record => {
    if (!record.timestamp) return false;

    const recordDate = new Date(record.timestamp);

    // If we have a lastSyncedMessageUuid, skip that message and any older
    if (record.uuid === lastSyncedMessageUuid) {
      return false;
    }

    // Check if this message is strictly after the last synced timestamp
    // CRITICAL: Compare Date objects, not ISO strings
    return recordDate > lastSyncedDate;
  });

  // Sort new messages by timestamp (oldest first for proper append order)
  // CRITICAL: Use new Date() for proper comparison
  newMessages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

  return {
    hasNewMessages: newMessages.length > 0,
    newCount: newMessages.length,
    newMessages: newMessages.map(m => ({
      uuid: m.uuid,
      type: m.type,
      timestamp: m.timestamp,
      _rawLine: m._rawLine
    })),
    lastSynced: lastSyncedTimestamp
  };
}

/**
 * Append new messages from original to memory copy
 * Updates manifest with new lastSyncedTimestamp
 *
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {{ syncedCount: number, newLastTimestamp: string }}
 */
export async function syncNewMessages(projectId, sessionId) {
  // Detect new messages first
  const detection = await detectNewMessages(projectId, sessionId);

  if (detection.error) {
    const error = new Error(detection.errorMessage);
    error.code = detection.error;
    error.status = 404;
    throw error;
  }

  if (!detection.hasNewMessages) {
    // Get session for returning current state
    const session = await getSession(projectId, sessionId);
    return {
      syncedCount: 0,
      newLastTimestamp: session.lastSyncedTimestamp,
      newLastMessageUuid: session.lastSyncedMessageUuid,
      newMessageCount: session.messageCount
    };
  }

  // Get session from manifest
  const session = await getSession(projectId, sessionId);
  const originalsDir = getOriginalsDir(projectId);
  const copyPath = path.join(originalsDir, `${sessionId}.jsonl`);

  // Verify copy exists
  if (!await fs.pathExists(copyPath)) {
    const error = new Error(`Memory copy not found: ${copyPath}`);
    error.code = 'COPY_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Append new messages to the copy file
  // Each message's _rawLine already has the original JSON
  const linesToAppend = detection.newMessages
    .map(m => m._rawLine)
    .join('\n') + '\n';

  await fs.appendFile(copyPath, linesToAppend, 'utf-8');

  // Find the new last timestamp and UUID
  // New messages are already sorted by timestamp (oldest first)
  // So the last one is the most recent
  const lastNewMessage = detection.newMessages[detection.newMessages.length - 1];
  const newLastTimestamp = lastNewMessage.timestamp;
  const newLastMessageUuid = lastNewMessage.uuid;
  const newMessageCount = (session.messageCount || 0) + detection.newCount;

  // Update manifest with new sync tracking
  const updatedSession = {
    ...session,
    lastSyncedTimestamp: newLastTimestamp,
    lastSyncedMessageUuid: newLastMessageUuid,
    messageCount: newMessageCount,
    lastTimestamp: newLastTimestamp, // Also update the session's lastTimestamp
    originalMessages: newMessageCount // Keep this in sync
  };

  await setSession(projectId, sessionId, updatedSession);

  return {
    syncedCount: detection.newCount,
    newLastTimestamp,
    newLastMessageUuid,
    newMessageCount
  };
}

/**
 * Get the sync status for a session without fetching the actual messages
 * This is a lighter version of detectNewMessages for UI status display
 *
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {{ hasNewMessages: boolean, newCount: number, lastSynced: string, originalExists: boolean }}
 */
export async function getSyncStatus(projectId, sessionId) {
  // Get session from manifest
  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const originalPath = session.originalFile;

  // Check if original file still exists
  if (!await fs.pathExists(originalPath)) {
    return {
      hasNewMessages: false,
      newCount: 0,
      lastSynced: session.lastSyncedTimestamp,
      originalExists: false
    };
  }

  // Parse the original to count messages
  const parsed = await parseJsonlFile(originalPath);
  const originalMessageCount = parsed.totalMessages;
  const copyMessageCount = session.messageCount || session.originalMessages;

  const newCount = Math.max(0, originalMessageCount - copyMessageCount);

  return {
    hasNewMessages: newCount > 0,
    newCount,
    lastSynced: session.lastSyncedTimestamp,
    originalExists: true,
    originalMessageCount,
    copyMessageCount
  };
}
