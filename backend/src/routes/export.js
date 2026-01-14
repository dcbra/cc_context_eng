import express from 'express';
import path from 'path';
import os from 'os';
import multer from 'multer';
import { parseJsonlFile, getMessageOrder } from '../services/jsonl-parser.js';
import { trackFilesInSession } from '../services/file-tracker.js';
import { analyzeSubagents } from '../services/subagent-analyzer.js';
import { calculateTokenBreakdown } from '../services/token-calculator.js';
import { getSessionBackupDir } from '../services/backup-manager.js';
import { sessionToMarkdown, sessionToPlainText, createSessionReport } from '../utils/markdown-export.js';

const router = express.Router();
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Configure multer for file uploads (in-memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.jsonl')) {
      cb(null, true);
    } else {
      cb(new Error('Only .jsonl files are allowed'), false);
    }
  }
});

/**
 * GET /api/export/:sessionId/markdown
 * Export current session to markdown format
 * Query params:
 *   - projectId: required
 *   - format: 'markdown' | 'plain' | 'report' (default: 'markdown')
 *   - full: 'true' | 'false' - whether to include full content without truncation (default: 'false')
 */
router.get('/:sessionId/markdown', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId, format = 'markdown', full = 'false' } = req.query;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing sessionId or projectId' });
    }

    const sessionFilePath = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);
    const options = { full: full === 'true' };
    const result = await exportSessionAsMarkdown(sessionFilePath, sessionId, projectId, format, null, options);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/export/:sessionId/backup/:version/markdown
 * Export a specific backup version to markdown format
 * Query params:
 *   - projectId: required
 *   - format: 'markdown' | 'plain' | 'report' (default: 'markdown')
 *   - full: 'true' | 'false' - whether to include full content without truncation (default: 'false')
 */
router.get('/:sessionId/backup/:version/markdown', async (req, res, next) => {
  try {
    const { sessionId, version } = req.params;
    const { projectId, format = 'markdown', full = 'false' } = req.query;

    if (!sessionId || !projectId || !version) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const backupDir = getSessionBackupDir(projectId, sessionId);
    const backupFilePath = path.join(backupDir, `v${version}.jsonl`);
    const options = { full: full === 'true' };
    const result = await exportSessionAsMarkdown(backupFilePath, sessionId, projectId, format, version, options);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/export/convert
 * Convert an uploaded JSONL file to markdown
 * Body params (multipart form):
 *   - file: the JSONL file
 *   - format: 'markdown' | 'plain' | 'report' (default: 'markdown')
 *   - full: 'true' | 'false' - whether to include full content without truncation (default: 'false')
 */
router.post('/convert', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { format = 'markdown', full = 'false' } = req.body;
    const content = req.file.buffer.toString('utf-8');
    const fileName = req.file.originalname;
    const options = { full: full === 'true' };

    const result = await convertJsonlContentToMarkdown(content, fileName, format, options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Helper function to export a session file as markdown
 * @param {string} filePath - Path to the JSONL file
 * @param {string} sessionId - Session ID
 * @param {string} projectId - Project ID
 * @param {string} format - Export format ('markdown', 'plain', 'report')
 * @param {number|null} backupVersion - Backup version number if exporting a backup
 * @param {Object} options - Export options
 * @param {boolean} options.full - Whether to include full content without truncation
 */
async function exportSessionAsMarkdown(filePath, sessionId, projectId, format, backupVersion = null, options = {}) {
  const parsed = await parseJsonlFile(filePath);
  const messageOrder = getMessageOrder(parsed);
  const filesRead = trackFilesInSession(parsed.messages);
  const subagents = await analyzeSubagents(parsed, projectId);
  const tokenBreakdown = calculateTokenBreakdown(parsed, subagents);

  let content;
  let filename;

  switch (format) {
    case 'plain':
      content = sessionToPlainText(messageOrder);
      filename = `${sessionId}${backupVersion ? `-v${backupVersion}` : ''}.txt`;
      break;
    case 'report':
      content = createSessionReport(parsed, messageOrder, filesRead, tokenBreakdown, subagents, options);
      filename = `${sessionId}${backupVersion ? `-v${backupVersion}` : ''}-report.md`;
      break;
    case 'markdown':
    default:
      content = sessionToMarkdown(parsed, messageOrder, options);
      filename = `${sessionId}${backupVersion ? `-v${backupVersion}` : ''}.md`;
      break;
  }

  return {
    content,
    filename,
    format,
    sessionId,
    backupVersion,
    full: options.full || false,
    stats: {
      messageCount: messageOrder.length,
      fileCount: filesRead.length,
      tokenCount: tokenBreakdown?.breakdown?.combined?.total || 0
    }
  };
}

/**
 * Helper function to convert JSONL content (string) to markdown
 * @param {string} jsonlContent - Raw JSONL content
 * @param {string} fileName - Original file name
 * @param {string} format - Export format ('markdown', 'plain', 'report')
 * @param {Object} options - Export options
 * @param {boolean} options.full - Whether to include full content without truncation
 */
async function convertJsonlContentToMarkdown(jsonlContent, fileName, format, options = {}) {
  // Parse the JSONL content line by line
  const lines = jsonlContent.split('\n').filter(l => l.trim());
  const messages = [];
  let summary = null;
  let metadata = null;

  for (const line of lines) {
    try {
      const record = JSON.parse(line);

      if (record.type === 'summary') {
        summary = record;
      } else if (record.type === 'user' || record.type === 'assistant') {
        // Extract metadata from first message if not set
        if (!metadata && record.cwd) {
          metadata = {
            cwd: record.cwd,
            gitBranch: record.gitBranch,
            version: record.version
          };
        }

        // Enhance message with basic structure
        const enhanced = {
          uuid: record.uuid,
          parentUuid: record.parentUuid,
          type: record.type,
          timestamp: record.timestamp,
          content: record.message?.content || [],
          model: record.message?.model,
          tokens: {
            input: record.message?.usage?.input_tokens || 0,
            output: record.message?.usage?.output_tokens || 0,
            cacheRead: record.message?.usage?.cache_read_input_tokens || 0,
            cacheCreation: record.message?.usage?.cache_creation_input_tokens || 0,
            total: (record.message?.usage?.input_tokens || 0) +
                   (record.message?.usage?.output_tokens || 0) +
                   (record.message?.usage?.cache_read_input_tokens || 0) +
                   (record.message?.usage?.cache_creation_input_tokens || 0)
          },
          toolUses: [],
          toolResults: [],
          filesReferenced: [],
          raw: record
        };

        // Extract tool uses
        if (Array.isArray(enhanced.content)) {
          for (const block of enhanced.content) {
            if (block && block.type === 'tool_use') {
              enhanced.toolUses.push(block);
            }
            if (block && block.type === 'tool_result') {
              enhanced.toolResults.push(block);
            }
          }
        }

        messages.push(enhanced);
      }
    } catch (e) {
      // Skip invalid lines
      console.warn('Skipping invalid line:', e.message);
    }
  }

  // Sort messages by timestamp
  messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Create parsed structure
  const parsed = {
    sessionId: fileName.replace('.jsonl', ''),
    metadata,
    summary,
    messages
  };

  // Calculate basic stats
  const totalTokens = messages.reduce((sum, m) => sum + m.tokens.total, 0);

  let content;
  let outputFilename;

  switch (format) {
    case 'plain':
      content = sessionToPlainText(messages);
      outputFilename = fileName.replace('.jsonl', '.txt');
      break;
    case 'report':
      content = createSessionReport(parsed, messages, [], { breakdown: { combined: { total: totalTokens } } }, [], options);
      outputFilename = fileName.replace('.jsonl', '-report.md');
      break;
    case 'markdown':
    default:
      content = sessionToMarkdown(parsed, messages, options);
      outputFilename = fileName.replace('.jsonl', '.md');
      break;
  }

  return {
    content,
    filename: outputFilename,
    format,
    originalFilename: fileName,
    full: options.full || false,
    stats: {
      messageCount: messages.length,
      tokenCount: totalTokens
    }
  };
}

export default router;
