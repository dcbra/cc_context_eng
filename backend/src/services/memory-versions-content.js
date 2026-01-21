/**
 * Version content retrieval functions
 * Handles reading and serving compressed version content
 */

import fs from 'fs-extra';
import { parseJsonlFile } from './jsonl-parser.js';
import { getSession } from './memory-manifest.js';
import { readJsonlContent } from '../utils/streaming-jsonl.js';
import { generateMarkdownFromParsed } from './memory-versions-output.js';
import { getVersionsPath } from './memory-versions-filename.js';

/**
 * Get the content of a compression version
 * format: 'md' or 'jsonl'
 */
export async function getVersionContent(projectId, sessionId, versionId, format = 'md') {
  const session = await getSession(projectId, sessionId);

  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  if (versionId === 'original') {
    if (format === 'jsonl') {
      const content = await readJsonlContent(session.originalFile);
      return {
        content,
        contentType: 'application/x-ndjson',
        filename: `${sessionId}-original.jsonl`
      };
    } else {
      const parsed = await parseJsonlFile(session.originalFile);
      const mdContent = generateMarkdownFromParsed(parsed);
      return {
        content: mdContent,
        contentType: 'text/markdown',
        filename: `${sessionId}-original.md`
      };
    }
  }

  const compression = (session.compressions || []).find(c => c.versionId === versionId);

  if (!compression) {
    const error = new Error(`Version ${versionId} not found for session ${sessionId}`);
    error.code = 'VERSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const versionsDir = getVersionsPath(projectId, sessionId);
  const ext = format === 'jsonl' ? 'jsonl' : 'md';
  const filePath = `${versionsDir}/${compression.file}.${ext}`;

  if (!await fs.pathExists(filePath)) {
    const error = new Error(`Version file not found: ${compression.file}.${ext}`);
    error.code = 'VERSION_FILE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const content = format === 'jsonl'
    ? await readJsonlContent(filePath)
    : await fs.readFile(filePath, 'utf-8');
  const contentType = format === 'jsonl' ? 'application/x-ndjson' : 'text/markdown';

  return { content, contentType, filename: `${compression.file}.${ext}` };
}
