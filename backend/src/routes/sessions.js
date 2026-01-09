import express from 'express';
import path from 'path';
import os from 'os';
import { parseJsonlFile, getMessageOrder } from '../services/jsonl-parser.js';
import { trackFilesInSession } from '../services/file-tracker.js';
import { analyzeSubagents } from '../services/subagent-analyzer.js';
import { calculateTokenBreakdown } from '../services/token-calculator.js';

const router = express.Router();
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * GET /api/sessions/:sessionId
 * Get parsed session with full analysis (files, tokens, subagents)
 */
router.get('/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    // Construct full file path
    const sessionFilePath = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);

    // Parse the JSONL file
    const parsed = await parseJsonlFile(sessionFilePath);

    // Get message order
    const messageOrder = getMessageOrder(parsed);

    // Track files read in session
    const filesRead = trackFilesInSession(parsed.messages);

    // Analyze subagents (if this is a main session)
    const subagents = await analyzeSubagents(parsed, projectId);

    // Calculate token breakdown
    const tokenBreakdown = calculateTokenBreakdown(parsed, subagents);

    // Build response
    res.json({
      session: {
        id: sessionId,
        projectId,
        filePath: parsed.filePath,
        fileName: parsed.fileName,
        metadata: parsed.metadata,
        summary: parsed.summary
      },
      messages: messageOrder,
      totalMessages: messageOrder.length,
      files: filesRead,
      subagents,
      tokens: tokenBreakdown,
      messageGraph: parsed.messageGraph
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sessions/:sessionId/preview
 * Preview sanitization impact
 */
router.post('/:sessionId/preview', async (req, res, next) => {
  try {
    const { sessionId, projectId } = req.query;
    const { removeMessages, removeFiles, criteria } = req.body;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    const parsed = await parseJsonlFile(sessionId);
    const messageOrder = getMessageOrder(parsed);

    // Calculate impact
    const impact = {
      originalMessages: messageOrder.length,
      originalTokens: messageOrder.reduce((sum, m) => sum + m.tokens.total, 0),
      removedMessages: removeMessages ? removeMessages.length : 0,
      removedTokens: 0,
      affectedByFileRemoval: 0,
      affectedTokensByFileRemoval: 0
    };

    // Calculate tokens from removed messages
    if (removeMessages && removeMessages.length > 0) {
      const removedSet = new Set(removeMessages);
      for (const msg of messageOrder) {
        if (removedSet.has(msg.uuid)) {
          impact.removedTokens += msg.tokens.total;
        }
      }
    }

    // Calculate impact of file removal
    if (removeFiles && removeFiles.length > 0) {
      const filesSet = new Set(removeFiles);
      for (const msg of messageOrder) {
        if (msg.filesReferenced.some(f => filesSet.has(f))) {
          impact.affectedByFileRemoval++;
          impact.affectedTokensByFileRemoval += msg.tokens.total;
        }
      }
    }

    res.json({
      preview: impact,
      resultingMessages: impact.originalMessages - impact.removedMessages,
      resultingTokens: impact.originalTokens - impact.removedTokens - impact.affectedTokensByFileRemoval
    });
  } catch (error) {
    next(error);
  }
});

export default router;
