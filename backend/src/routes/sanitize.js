import express from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { sanitizeSession, calculateSanitizationImpact, sessionToJsonl } from '../services/sanitizer.js';
import { parseJsonlFile } from '../services/jsonl-parser.js';
import { createBackup } from '../services/backup-manager.js';

const router = express.Router();
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

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
    const jsonlContent = sessionToJsonl(parsed, result.messages);
    await fs.writeFile(sessionFilePath, jsonlContent, 'utf-8');

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

export default router;
