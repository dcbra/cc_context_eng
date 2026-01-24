import express from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { sanitizeSession, calculateSanitizationImpact, sessionToJsonl, findDuplicateMessages, deduplicateMessages, extractAndReplaceImages } from '../services/sanitizer.js';
import { parseJsonlFile, getMessageOrder } from '../services/jsonl-parser.js';
import { createBackup } from '../services/backup-manager.js';

const router = express.Router();
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Sync sessions-index.json with actual session file stats
 * This prevents Claude Code from detecting a mismatch and duplicating messages
 */
async function syncSessionsIndex(sessionFilePath, projectId) {
  try {
    const sessionId = path.basename(sessionFilePath, '.jsonl');
    const indexFile = path.join(PROJECTS_DIR, projectId, 'sessions-index.json');

    if (!await fs.pathExists(indexFile)) {
      console.log(`[syncSessionsIndex] Index file not found: ${indexFile}`);
      return;
    }

    // Count actual messages
    const content = await fs.readFile(sessionFilePath, 'utf-8');
    const lines = content.trim().split('\n');
    let messageCount = 0;
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (record.type === 'user' || record.type === 'assistant') {
          messageCount++;
        }
      } catch (e) {}
    }

    // Get file mtime
    const stat = await fs.stat(sessionFilePath);
    const fileMtime = Math.floor(stat.mtimeMs);

    // Update index
    const index = JSON.parse(await fs.readFile(indexFile, 'utf-8'));
    const entry = index.entries?.find(e => e.sessionId === sessionId);

    if (!entry) {
      console.log(`[syncSessionsIndex] Session ${sessionId} not found in index`);
      return;
    }

    const oldCount = entry.messageCount;
    entry.messageCount = messageCount;
    entry.fileMtime = fileMtime;
    entry.modified = new Date().toISOString();

    await fs.writeFile(indexFile, JSON.stringify(index, null, 2));
    console.log(`[syncSessionsIndex] Updated ${sessionId}: messageCount ${oldCount} -> ${messageCount}`);
  } catch (error) {
    console.error(`[syncSessionsIndex] Error:`, error.message);
  }
}

/**
 * POST /api/sanitize/:sessionId
 * Apply sanitization rules and save to file
 */
router.post('/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;
    const { removeMessages, removeFiles, criteria } = req.body;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    // Construct full file path
    const sessionFilePath = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);

    // Parse the session
    const parsed = await parseJsonlFile(sessionFilePath);

    // Create backup before modifying
    await createBackup(sessionId, projectId, parsed.messages, 'Auto-backup before sanitization');

    // Apply sanitization
    const result = sanitizeSession(parsed, {
      removeMessages: removeMessages || [],
      removeFiles: removeFiles || [],
      removeCriteria: criteria || {}
    });

    // Save the sanitized session back to disk (preserving summary and file-history-snapshots)
    // Messages are kept in topological order (parents before children).
    // The leafUuid is preserved by sessionToJsonl from the original parsed.summary.
    const jsonlContent = sessionToJsonl(parsed, result.messages);
    await fs.writeFile(sessionFilePath, jsonlContent, 'utf-8');
    await syncSessionsIndex(sessionFilePath, projectId);

    res.json({
      success: true,
      changes: result.changes,
      messageCount: result.messages.length,
      impact: calculateSanitizationImpact(parsed, {
        removeMessages: removeMessages || [],
        removeFiles: removeFiles || [],
        removeCriteria: criteria || {}
      })
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sanitize/:sessionId/apply
 * Apply sanitization and save to file
 */
router.post('/:sessionId/apply', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;
    const { removeMessages, removeFiles, criteria, messages } = req.body;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    // Apply sanitization
    const result = sanitizeSession(
      { messages: messages || [] },
      {
        removeMessages: removeMessages || [],
        removeFiles: removeFiles || [],
        removeCriteria: criteria || {}
      }
    );

    res.json({
      success: true,
      sanitizedMessages: result.messages,
      changes: result.changes
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sanitize/:sessionId/deduplicate
 * Remove duplicate messages from a session, keeping only the oldest
 */
router.post('/:sessionId/deduplicate', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    // Construct full file path
    const sessionFilePath = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);

    // Parse the session
    const parsed = await parseJsonlFile(sessionFilePath);
    const messageOrder = getMessageOrder(parsed);
    const leafUuid = parsed.summary?.leafUuid;

    // Find duplicates first to report what will be removed
    // Pass leafUuid so that if the leaf is a duplicate, we keep IT not another copy
    const duplicateInfo = findDuplicateMessages(messageOrder, leafUuid);

    if (duplicateInfo.totalDuplicates === 0) {
      return res.json({
        success: true,
        message: 'No duplicates found',
        duplicatesRemoved: 0,
        originalCount: messageOrder.length,
        newCount: messageOrder.length
      });
    }

    // Create backup before modifying
    await createBackup(sessionId, projectId, parsed.messages, 'Auto-backup before deduplication');

    // Deduplicate messages - pass leafUuid to preserve the conversation chain
    const deduplicatedMessages = deduplicateMessages(messageOrder, leafUuid);

    // Keep messages in topological order (parents before children) from getMessageOrder.
    // The leafUuid is preserved by sessionToJsonl from the original parsed.summary.
    // NOTE: We do NOT sort by timestamp here because:
    // 1. Claude Code expects parents to appear before children in the file
    // 2. Timestamps can be out of order (async operations, clock skew)
    // 3. The leafUuid preservation in sessionToJsonl handles the "current branch" issue

    // Save the deduplicated session back to disk
    const deduplicatedParsed = {
      ...parsed,
      messages: deduplicatedMessages
    };
    const jsonlContent = sessionToJsonl(deduplicatedParsed, deduplicatedMessages);
    await fs.writeFile(sessionFilePath, jsonlContent, 'utf-8');
    await syncSessionsIndex(sessionFilePath, projectId);

    res.json({
      success: true,
      message: `Removed ${duplicateInfo.totalDuplicates} duplicate messages`,
      duplicatesRemoved: duplicateInfo.totalDuplicates,
      duplicateGroups: duplicateInfo.duplicateGroups,
      originalCount: messageOrder.length,
      newCount: deduplicatedMessages.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sanitize/:sessionId/extract-images
 * Extract embedded base64 images from session, save to disk, and replace with file references
 */
router.post('/:sessionId/extract-images', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    // Construct full file path
    const sessionFilePath = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);

    // Check if file exists
    const exists = await fs.pathExists(sessionFilePath);
    if (!exists) {
      return res.status(404).json({ error: `Session file not found: ${sessionFilePath}` });
    }

    console.log(`[extract-images] Starting extraction for session ${sessionId}`);

    // Parse the session
    const parsed = await parseJsonlFile(sessionFilePath);
    const messageOrder = getMessageOrder(parsed);

    console.log(`[extract-images] Parsed ${messageOrder.length} messages`);

    // Extract and replace images
    const extractResult = await extractAndReplaceImages(messageOrder, sessionId);

    if (extractResult.extractedCount === 0) {
      return res.json({
        success: true,
        message: 'No embedded base64 images found',
        extractedCount: 0,
        savedPaths: []
      });
    }

    // Create backup before modifying
    await createBackup(sessionId, projectId, parsed.messages, 'Auto-backup before image extraction');

    console.log(`[extract-images] Extracted ${extractResult.extractedCount} images, saving modified session`);

    // Save the modified session back to disk
    const modifiedParsed = {
      ...parsed,
      messages: extractResult.messages
    };
    const jsonlContent = sessionToJsonl(modifiedParsed, extractResult.messages);
    await fs.writeFile(sessionFilePath, jsonlContent, 'utf-8');
    await syncSessionsIndex(sessionFilePath, projectId);

    console.log(`[extract-images] Saved modified session to ${sessionFilePath}`);

    res.json({
      success: true,
      message: `Extracted ${extractResult.extractedCount} images`,
      extractedCount: extractResult.extractedCount,
      savedPaths: extractResult.savedPaths,
      originalMessageCount: messageOrder.length
    });
  } catch (error) {
    console.error('[extract-images] Error:', error);
    next(error);
  }
});

export default router;
