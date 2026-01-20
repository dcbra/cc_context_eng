import express from 'express';
import path from 'path';
import os from 'os';
import { parseJsonlFile, getMessageOrder } from '../services/jsonl-parser.js';
import { trackFilesInSession } from '../services/file-tracker.js';
import { analyzeSubagents } from '../services/subagent-analyzer.js';
import { calculateTokenBreakdown } from '../services/token-calculator.js';
import { findDuplicateMessages } from '../services/sanitizer.js';

const router = express.Router();
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * GET /api/sessions/:sessionId/duplicates
 * Find duplicate messages in a session
 * NOTE: This route must come BEFORE /:sessionId to avoid being caught by the generic route
 */
router.get('/:sessionId/duplicates', async (req, res, next) => {
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
    const messageOrder = getMessageOrder(parsed);

    // Find duplicates
    const result = findDuplicateMessages(messageOrder);

    // Convert Set to Array for JSON serialization
    res.json({
      duplicateGroups: result.duplicateGroups,
      duplicateUuids: Array.from(result.duplicateUuids),
      totalDuplicates: result.totalDuplicates,
      isolatedDuplicates: result.isolatedDuplicates,
      totalMessages: messageOrder.length
    });
  } catch (error) {
    next(error);
  }
});

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
    const subagents = await analyzeSubagents(parsed, projectId, sessionId);

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

    // Track content modifications (not removals)
    let verboseTruncated = 0;
    let errorsCleaned = 0;

    // Count messages affected by criteria (message types, percentage range)
    if (criteria) {
      // Determine the scope: manual selection or percentage range
      let affectedMessages = messageOrder;

      if (criteria.manuallySelected && criteria.manuallySelected.length > 0) {
        // Manual selection defines the scope
        const selectedSet = new Set(criteria.manuallySelected);
        affectedMessages = messageOrder.filter(m => selectedSet.has(m.uuid));
      } else if (criteria.percentageRange > 0) {
        // Percentage range defines the scope
        const cutoffIndex = Math.floor(messageOrder.length * (criteria.percentageRange / 100));
        affectedMessages = messageOrder.slice(0, cutoffIndex);
      }

      // Now apply criteria filters to the scope
      // Helper to check message type
      const matchesMessageType = (msg, typesSet) => {
        const content = Array.isArray(msg.content) ? msg.content : [];

        // Tool result detection (3 formats):
        if (content.some(c => c && c.type === 'tool_result')) return typesSet.has('tool-result');
        if (content.some(c => c && c.type === 'text' && c.converted_from === 'tool_result')) return typesSet.has('tool-result');
        if (msg.raw?.toolUseResult != null) return typesSet.has('tool-result');

        if (content.some(c => c && c.type === 'thinking')) return typesSet.has('thinking');

        // Check for actual tool_use OR converted tool_use blocks
        if (msg.toolUses && msg.toolUses.length > 0) return typesSet.has('tool');
        if (content.some(c => c && c.type === 'text' && c.converted_from === 'tool_use')) return typesSet.has('tool');

        if (msg.type === 'assistant') return typesSet.has('assistant');
        if (msg.type === 'user') return typesSet.has('you');
        return false;
      };

      // Check if any actual criteria are set (not just scope)
      const hasCriteria =
        (criteria.messageTypes && criteria.messageTypes.length > 0) ||
        criteria.removeErrors ||
        criteria.removeVerbose ||
        criteria.removeDuplicateFileReads;

      if (hasCriteria) {
        // Apply message type filter if specified (these REMOVE messages)
        if (criteria.messageTypes && criteria.messageTypes.length > 0) {
          const typesSet = new Set(criteria.messageTypes);
          const filtered = affectedMessages.filter(msg => matchesMessageType(msg, typesSet));
          removedMessages = filtered.length;
          removedTokens = filtered.reduce((sum, m) => sum + m.tokens.total, 0);
        }

        // Count verbose messages that would be truncated (not removed)
        if (criteria.removeVerbose) {
          const threshold = criteria.verboseThreshold || 500;
          verboseTruncated = affectedMessages.filter(msg => {
            if (msg.type !== 'assistant') return false;
            const content = Array.isArray(msg.content) ? msg.content : [];
            return content.some(block =>
              block.type === 'text' && block.text && block.text.length > threshold
            );
          }).length;
        }

        // Count messages with errors that would be cleaned
        if (criteria.removeErrors) {
          errorsCleaned = affectedMessages.filter(msg => {
            const content = Array.isArray(msg.content) ? msg.content : [];
            return content.some(block => block.type === 'tool_result' && block.is_error);
          }).length;
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
      },
      // Content modifications (not removals)
      modified: {
        verboseTruncated,
        errorsCleaned
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
