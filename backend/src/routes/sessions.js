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
    const { sessionId } = req.params;
    const { projectId } = req.query;
    const { removeMessages, removeFiles, criteria } = req.body;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    // Construct full file path
    const sessionFilePath = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);

    const parsed = await parseJsonlFile(sessionFilePath);
    const messageOrder = getMessageOrder(parsed);

    // Calculate original totals
    const originalMessages = messageOrder.length;
    const originalTokens = messageOrder.reduce((sum, m) => sum + m.tokens.total, 0);

    // Simulate sanitization to get accurate counts
    let removedMessages = 0;
    let removedTokens = 0;

    // Count directly removed messages
    if (removeMessages && removeMessages.length > 0) {
      const removedSet = new Set(removeMessages);
      for (const msg of messageOrder) {
        if (removedSet.has(msg.uuid)) {
          removedMessages++;
          removedTokens += msg.tokens.total;
        }
      }
    }

    // Count messages affected by file removal
    if (removeFiles && removeFiles.length > 0) {
      const filesSet = new Set(removeFiles);
      for (const msg of messageOrder) {
        if (msg.filesReferenced.some(f => filesSet.has(f))) {
          // File content removal doesn't remove the message, but reduces tokens
          // For now, estimate ~80% of tokens are from file content
          removedTokens += Math.floor(msg.tokens.total * 0.8);
        }
      }
    }

    // Count messages affected by criteria (message types, percentage range)
    if (criteria) {
      // If manual selections, only those are affected
      if (criteria.manuallySelected && criteria.manuallySelected.length > 0) {
        removedMessages = criteria.manuallySelected.length;
        const selectedSet = new Set(criteria.manuallySelected);
        removedTokens = messageOrder
          .filter(m => selectedSet.has(m.uuid))
          .reduce((sum, m) => sum + m.tokens.total, 0);
      } else {
        // Calculate based on percentage range and message types
        let affectedMessages = messageOrder;

        // Apply percentage range
        if (criteria.percentageRange > 0) {
          const sortedByTime = [...messageOrder].sort((a, b) =>
            new Date(a.timestamp) - new Date(b.timestamp)
          );
          const cutoffIndex = Math.floor(sortedByTime.length * (criteria.percentageRange / 100));
          affectedMessages = sortedByTime.slice(0, cutoffIndex);
        }

        // Apply message type filter
        if (criteria.messageTypes && criteria.messageTypes.length > 0) {
          const typesSet = new Set(criteria.messageTypes);
          affectedMessages = affectedMessages.filter(msg => {
            const content = Array.isArray(msg.content) ? msg.content : [];

            // Tool result detection (3 formats):
            // 1. Standard Claude API: tool_result content blocks
            if (content.some(c => c && c.type === 'tool_result')) return typesSet.has('tool-result');
            // 2. Converted tool_result blocks
            if (content.some(c => c && c.type === 'text' && c.converted_from === 'tool_result')) return typesSet.has('tool-result');
            // 3. Claude Code format: toolUseResult field
            if (msg.raw?.toolUseResult != null) return typesSet.has('tool-result');

            if (content.some(c => c && c.type === 'thinking')) return typesSet.has('thinking');

            // Check for actual tool_use OR converted tool_use blocks
            if (msg.toolUses && msg.toolUses.length > 0) return typesSet.has('tool');
            if (content.some(c => c && c.type === 'text' && c.converted_from === 'tool_use')) return typesSet.has('tool');

            if (msg.type === 'assistant') return typesSet.has('assistant');
            if (msg.type === 'user') return typesSet.has('you');
            return false;
          });

          removedMessages = affectedMessages.length;
          removedTokens = affectedMessages.reduce((sum, m) => sum + m.tokens.total, 0);
        }
      }
    }

    // Calculate final values
    const sanitizedMessages = originalMessages - removedMessages;
    const sanitizedTokens = originalTokens - removedTokens;
    const freedTokens = removedTokens;
    const freedPercentage = originalTokens > 0 ? (freedTokens / originalTokens) * 100 : 0;

    // Return in format expected by frontend
    res.json({
      original: {
        messages: originalMessages,
        tokens: originalTokens
      },
      sanitized: {
        messages: sanitizedMessages,
        tokens: sanitizedTokens
      },
      freed: {
        messages: removedMessages,
        tokens: freedTokens,
        percentage: freedPercentage
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
