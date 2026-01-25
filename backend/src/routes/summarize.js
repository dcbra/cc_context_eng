import express from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { summarizeMessages, summarizeAndIntegrate, summarizeWithTiers, summarizeAndIntegrateWithTiers, TIER_PRESETS, DEFAULT_TIERS, COMPACTION_RATIOS } from '../services/summarizer.js';
import { parseJsonlFile, getMessageOrder } from '../services/jsonl-parser.js';
import { sessionToJsonl, extractAndReplaceImages, findDuplicateMessages, deduplicateMessages } from '../services/sanitizer.js';
import { createBackup } from '../services/backup-manager.js';

const router = express.Router();
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * POST /api/summarize/:sessionId/preview
 * Preview summarization without applying changes
 * Supports both uniform and tiered compaction
 */
router.post('/:sessionId/preview', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;
    const {
      messageUuids,
      percentageRange,
      // Uniform compaction options
      compactionRatio = 10,
      aggressiveness = 'moderate',
      // Tiered compaction options
      useTiers = false,
      tierPreset = null,  // 'gentle', 'standard', 'aggressive', or null for custom
      tiers = null        // Custom tiers array
    } = req.body;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    // Construct full file path
    const sessionFilePath = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);

    // Parse the session
    const parsed = await parseJsonlFile(sessionFilePath);
    const messageOrder = getMessageOrder(parsed);

    // Determine which messages to summarize
    let targetUuids;

    if (messageUuids && messageUuids.length > 0) {
      // Use manually selected messages
      targetUuids = messageUuids;
    } else if (percentageRange && percentageRange > 0) {
      // Use percentage of messages from the start
      const cutoffIndex = Math.floor(messageOrder.length * (percentageRange / 100));
      targetUuids = messageOrder.slice(0, cutoffIndex).map(m => m.uuid);
    } else {
      return res.status(400).json({
        error: 'Must provide either messageUuids or percentageRange'
      });
    }

    // Filter to only user/assistant messages
    const uuidSet = new Set(targetUuids);
    const conversationMessages = messageOrder.filter(
      m => uuidSet.has(m.uuid) && (m.type === 'user' || m.type === 'assistant')
    );

    if (conversationMessages.length < 2) {
      return res.status(400).json({
        error: 'Need at least 2 user/assistant messages to summarize',
        found: conversationMessages.length
      });
    }

    // Count non-conversation messages (tools, thinking, etc.)
    const nonConversationMessages = targetUuids.length - conversationMessages.length;

    // Estimate token reduction (rough: ~4 chars per token)
    const originalChars = conversationMessages.reduce((sum, m) => {
      const content = m.content;
      if (typeof content === 'string') return sum + content.length;
      if (Array.isArray(content)) {
        return sum + content
          .filter(b => b.type === 'text')
          .reduce((s, b) => s + (b.text?.length || 0), 0);
      }
      return sum;
    }, 0);

    // Handle tiered vs uniform compaction
    if (useTiers) {
      // Use tiered compaction
      const effectiveTiers = tierPreset && TIER_PRESETS[tierPreset]
        ? TIER_PRESETS[tierPreset]
        : (tiers || DEFAULT_TIERS);

      const tieredResult = await summarizeWithTiers(conversationMessages, {
        tiers: effectiveTiers,
        tierPreset,
        dryRun: true
      });

      // Calculate estimated chars after tiered compression
      let estimatedResultChars = 0;
      for (const tier of tieredResult.tiers) {
        const tierOriginalChars = Math.floor(originalChars * (tier.inputMessages / conversationMessages.length));
        estimatedResultChars += tierOriginalChars / tier.compactionRatio;
      }

      res.json({
        preview: true,
        tiered: true,
        inputMessages: tieredResult.inputMessageCount,
        estimatedOutputMessages: tieredResult.estimatedOutputCount,
        effectiveCompaction: tieredResult.effectiveCompaction,
        tierPreset: tierPreset || 'custom',
        tiers: tieredResult.tiers,
        estimatedTokenReduction: Math.round((originalChars - estimatedResultChars) / 4),
        originalCharacters: originalChars,
        estimatedResultCharacters: Math.round(estimatedResultChars),
        messagesInRange: targetUuids.length,
        conversationMessagesInRange: conversationMessages.length,
        nonConversationMessages  // Tools, thinking, etc. that will be removed
      });
    } else {
      // Use uniform compaction
      const targetCount = Math.max(2, Math.ceil(conversationMessages.length / compactionRatio));
      const estimatedResultChars = originalChars / compactionRatio;

      res.json({
        preview: true,
        tiered: false,
        inputMessages: conversationMessages.length,
        estimatedOutputMessages: targetCount,
        compactionRatio,
        aggressiveness,
        estimatedTokenReduction: Math.round((originalChars - estimatedResultChars) / 4),
        originalCharacters: originalChars,
        estimatedResultCharacters: Math.round(estimatedResultChars),
        messagesInRange: targetUuids.length,
        conversationMessagesInRange: conversationMessages.length,
        nonConversationMessages  // Tools, thinking, etc. that will be removed
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/summarize/:sessionId/apply
 * Apply summarization and save changes
 * Supports both uniform and tiered compaction
 * Can modify original file or export to new file
 */
router.post('/:sessionId/apply', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;
    const {
      messageUuids,
      percentageRange,
      // Uniform compaction options
      compactionRatio = 10,
      aggressiveness = 'moderate',
      model = 'opus',
      // Tiered compaction options
      useTiers = false,
      tierPreset = null,
      tiers = null,
      // Auto-cleanup option
      removeNonConversation = true,  // Remove tools/thinking from range
      // Skip first N messages option
      skipFirstMessages = 0,  // Keep first N messages as-is (for pasted context)
      // Export options
      outputMode = 'modify',  // 'modify' | 'export-jsonl' | 'export-markdown'
      exportFilename = null,   // Optional custom filename for export
      // Image extraction option (fixes Claude Code duplication bug)
      extractImages = true,
      // Link preservation option
      preserveLinks = true,  // Ask LLM to preserve URLs and file paths
      // AskUserQuestion preservation
      preserveAskUserQuestion = true  // Preserve user interaction questions
    } = req.body;

    console.log(`[Summarize API] Apply request received:`);
    console.log(`  - sessionId: ${sessionId}`);
    console.log(`  - projectId: ${projectId}`);
    console.log(`  - messageUuids: ${messageUuids?.length || 0} selected`);
    console.log(`  - percentageRange: ${percentageRange}`);
    console.log(`  - useTiers: ${useTiers}, tierPreset: ${tierPreset}`);
    console.log(`  - compactionRatio: ${compactionRatio}, aggressiveness: ${aggressiveness}`);
    console.log(`  - model: ${model}, outputMode: ${outputMode}`);
    console.log(`  - skipFirstMessages: ${skipFirstMessages}`);

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    // Construct full file path
    const sessionFilePath = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);

    // Parse the session
    const parsed = await parseJsonlFile(sessionFilePath);
    const messageOrder = getMessageOrder(parsed);

    // Determine which messages to summarize
    let targetUuids;

    if (messageUuids && messageUuids.length > 0) {
      targetUuids = messageUuids;
    } else if (percentageRange && percentageRange > 0) {
      const cutoffIndex = Math.floor(messageOrder.length * (percentageRange / 100));
      targetUuids = messageOrder.slice(0, cutoffIndex).map(m => m.uuid);
    } else {
      return res.status(400).json({
        error: 'Must provide either messageUuids or percentageRange'
      });
    }

    // Only create backup if modifying original file
    if (outputMode === 'modify') {
      await createBackup(sessionId, projectId, parsed.messages, 'Auto-backup before summarization');
    }

    // ===== PRE-PROCESSING: Clean up data BEFORE sending to LLM =====
    let cleanedMessages = [...messageOrder];
    let imageExtractionResult = null;
    let duplicatesRemoved = 0;

    // Step 1: Deduplicate messages (reduces tokens sent to LLM)
    const leafUuid = parsed.summary?.leafUuid;
    const duplicateInfo = findDuplicateMessages(cleanedMessages, leafUuid);
    if (duplicateInfo.totalDuplicates > 0) {
      cleanedMessages = deduplicateMessages(cleanedMessages, leafUuid);
      duplicatesRemoved = duplicateInfo.totalDuplicates;
      console.log(`[Summarize API] Pre-processing: Removed ${duplicatesRemoved} duplicates`);
    }

    // Step 2: Extract images (replaces base64 blobs with file paths - huge token savings!)
    if (extractImages !== false) {
      imageExtractionResult = await extractAndReplaceImages(cleanedMessages, sessionId);
      cleanedMessages = imageExtractionResult.messages;
      console.log(`[Summarize API] Pre-processing: Extracted ${imageExtractionResult.extractedCount} images`);
    }

    // Update parsed with cleaned messages for summarization
    const cleanedParsed = { ...parsed, messages: cleanedMessages };

    // Recalculate target UUIDs based on cleaned messages (some may have been removed)
    const cleanedUuids = new Set(cleanedMessages.map(m => m.uuid));
    const cleanedTargetUuids = targetUuids.filter(uuid => cleanedUuids.has(uuid));

    console.log(`[Summarize API] After pre-processing: ${cleanedMessages.length} messages, ${cleanedTargetUuids.length} targets`);

    // ===== LLM SUMMARIZATION =====
    let result;

    console.log(`[Summarize API] Starting summarization with ${cleanedTargetUuids.length} target messages...`);

    if (useTiers) {
      // Use tiered compaction
      const effectiveTiers = tierPreset && TIER_PRESETS[tierPreset]
        ? TIER_PRESETS[tierPreset]
        : (tiers || DEFAULT_TIERS);

      console.log(`[Summarize API] Using tiered compaction with ${effectiveTiers.length} tiers`);
      result = await summarizeAndIntegrateWithTiers(cleanedParsed, cleanedTargetUuids, {
        tiers: effectiveTiers,
        tierPreset,
        model,
        removeNonConversation,
        skipFirstMessages,
        preserveLinks,
        preserveAskUserQuestion
      });
    } else {
      // Use uniform compaction
      console.log(`[Summarize API] Using uniform compaction (ratio: ${compactionRatio}, aggressiveness: ${aggressiveness})`);
      result = await summarizeAndIntegrate(cleanedParsed, cleanedTargetUuids, {
        compactionRatio,
        aggressiveness,
        model,
        removeNonConversation,
        skipFirstMessages,
        preserveLinks,
        preserveAskUserQuestion
      });
    }

    console.log(`[Summarize API] Summarization complete:`, result.changes);

    const finalMessages = result.messages;
    const updatedParsed = { ...parsed, messages: finalMessages };

    // Handle different output modes
    if (outputMode === 'modify') {
      // Save the summarized session back to disk (original behavior)
      // Sort messages by timestamp to ensure chronological order
      const sortedMessages = [...finalMessages].sort((a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp)
      );
      const jsonlContent = sessionToJsonl(updatedParsed, sortedMessages);
      await fs.writeFile(sessionFilePath, jsonlContent, 'utf-8');

      res.json({
        success: true,
        outputMode: 'modify',
        changes: result.changes,
        summaries: result.summaries,
        tierResults: result.tierResults || null,
        newMessageCount: finalMessages.length,
        preProcessing: {
          duplicatesRemoved,
          imagesExtracted: imageExtractionResult?.extractedCount || 0
        }
      });

    } else if (outputMode === 'export-jsonl') {
      // Export as JSONL file (don't modify original)
      // Sort messages by timestamp to ensure chronological order
      const sortedMessages = [...finalMessages].sort((a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp)
      );
      const jsonlContent = sessionToJsonl(updatedParsed, sortedMessages);
      const filename = exportFilename || `${sessionId}-summarized.jsonl`;

      res.json({
        success: true,
        outputMode: 'export-jsonl',
        changes: result.changes,
        summaries: result.summaries,
        tierResults: result.tierResults || null,
        newMessageCount: finalMessages.length,
        preProcessing: {
          duplicatesRemoved,
          imagesExtracted: imageExtractionResult?.extractedCount || 0
        },
        export: {
          filename,
          content: jsonlContent,
          contentType: 'application/jsonl',
          size: jsonlContent.length
        }
      });

    } else if (outputMode === 'export-markdown') {
      // Export as Markdown (don't modify original)
      const { sessionToMarkdown } = await import('../utils/markdown-export.js');

      // Rebuild message graph for updated messages (since UUIDs changed)
      const messagesMap = new Map(result.messages.map(m => [m.uuid, m]));
      const messageGraph = {
        roots: [],
        childrenOf: new Map(),
        parentOf: new Map()
      };
      for (const message of result.messages) {
        if (!message.parentUuid || !messagesMap.has(message.parentUuid)) {
          messageGraph.roots.push(message.uuid);
        } else {
          if (!messageGraph.childrenOf.has(message.parentUuid)) {
            messageGraph.childrenOf.set(message.parentUuid, []);
          }
          messageGraph.childrenOf.get(message.parentUuid).push(message.uuid);
          messageGraph.parentOf.set(message.uuid, message.parentUuid);
        }
      }

      // Sort messages by timestamp to ensure chronological order for markdown export
      // (result.messages may be in graph order, not timestamp order)
      const messageOrder = [...result.messages].sort((a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp)
      );

      const finalParsed = { ...updatedParsed, messageGraph };
      const markdown = sessionToMarkdown(finalParsed, messageOrder, { format: 'markdown', full: false });
      const filename = exportFilename || `${sessionId}-summarized.md`;

      res.json({
        success: true,
        outputMode: 'export-markdown',
        changes: result.changes,
        summaries: result.summaries,
        tierResults: result.tierResults || null,
        newMessageCount: finalMessages.length,
        preProcessing: {
          duplicatesRemoved,
          imagesExtracted: imageExtractionResult?.extractedCount || 0
        },
        export: {
          filename,
          content: markdown,
          contentType: 'text/markdown',
          size: markdown.length
        }
      });

    } else {
      return res.status(400).json({ error: `Invalid outputMode: ${outputMode}` });
    }
  } catch (error) {
    console.error(`[Summarize API] ERROR:`, error.message);
    console.error(`[Summarize API] Stack:`, error.stack);

    // Check if it's a Claude CLI error
    if (error.message.includes('Claude CLI') || error.message.includes('claude')) {
      return res.status(503).json({
        error: 'Claude CLI error',
        details: error.message,
        hint: 'Ensure Claude CLI is installed and authenticated. Run: claude --version'
      });
    }

    // Check for spawn errors
    if (error.message.includes('spawn') || error.message.includes('ENOENT')) {
      return res.status(503).json({
        error: 'Failed to start Claude CLI',
        details: error.message,
        hint: 'Claude CLI binary not found. Install with: npm install -g @anthropic-ai/claude-code'
      });
    }

    // Check for timeout
    if (error.message.includes('timed out')) {
      return res.status(504).json({
        error: 'Summarization timed out',
        details: error.message,
        hint: 'The summarization took too long. Try with fewer messages or a smaller range.'
      });
    }

    // Check for parse errors
    if (error.message.includes('parse') || error.message.includes('JSON')) {
      return res.status(500).json({
        error: 'Failed to parse Claude response',
        details: error.message,
        hint: 'Claude returned an unexpected format. Check server logs for details.'
      });
    }

    // Generic error
    return res.status(500).json({
      error: 'Summarization failed',
      details: error.message,
      hint: 'Check server logs for more details.'
    });
  }
});

/**
 * GET /api/summarize/presets
 * Get available tier presets and compaction ratios
 */
router.get('/presets', (req, res) => {
  res.json({
    presets: {
      uniform: {
        name: 'Uniform',
        description: 'Same compression across all messages',
        tiers: null
      },
      gentle: {
        name: 'Gentle',
        description: 'Light compression, preserves most detail (2:1 to 10:1)',
        tiers: TIER_PRESETS.gentle
      },
      standard: {
        name: 'Standard',
        description: 'Balanced - aggressive on old, gentle on recent (3:1 to 25:1)',
        tiers: TIER_PRESETS.standard
      },
      aggressive: {
        name: 'Aggressive',
        description: 'Maximum compression, keeps only essentials (5:1 to 50:1)',
        tiers: TIER_PRESETS.aggressive
      }
    },
    defaultTiers: DEFAULT_TIERS,
    compactionRatios: COMPACTION_RATIOS,
    tierRanges: ['0-25%', '25-50%', '50-75%', '75-90%', '90-100%']
  });
});

/**
 * GET /api/summarize/status
 * Check if Claude CLI is available
 */
router.get('/status', async (req, res) => {
  const { spawn } = await import('child_process');

  const claude = spawn('claude', ['--version'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  claude.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  claude.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  claude.on('close', (code) => {
    if (code === 0) {
      res.json({
        available: true,
        version: stdout.trim()
      });
    } else {
      res.json({
        available: false,
        error: stderr || 'Claude CLI not found'
      });
    }
  });

  claude.on('error', (err) => {
    res.json({
      available: false,
      error: `Failed to run Claude CLI: ${err.message}`
    });
  });
});

export default router;
