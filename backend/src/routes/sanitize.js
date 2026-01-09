import express from 'express';
import { sanitizeSession, calculateSanitizationImpact } from '../services/sanitizer.js';
import { parseJsonlFile } from '../services/jsonl-parser.js';

const router = express.Router();

/**
 * POST /api/sanitize/:sessionId
 * Apply sanitization rules
 */
router.post('/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;
    const { removeMessages, removeFiles, criteria } = req.body;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    // Parse the session
    const parsed = await parseJsonlFile(sessionId);

    // Apply sanitization
    const result = sanitizeSession(parsed, {
      removeMessages: removeMessages || [],
      removeFiles: removeFiles || [],
      removeCriteria: criteria || {}
    });

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
