/**
 * Read operations for memory compression versions
 * Handles list and get version functions
 */

import fs from 'fs-extra';
import path from 'path';
import { getSession } from './memory-manifest.js';
import { getFileSizeIfExists } from './memory-versions-helpers.js';
import { getVersionsPath } from './memory-versions-filename.js';

/**
 * List all compression versions for a session
 * Includes "original" as a pseudo-version option
 */
export async function listCompressionVersions(projectId, sessionId) {
  const session = await getSession(projectId, sessionId);

  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const originalVersion = {
    versionId: 'original',
    file: null,
    createdAt: session.registeredAt,
    isOriginal: true,
    outputTokens: session.originalTokens,
    outputMessages: session.originalMessages,
    compressionRatio: 1.0,
    settings: null
  };

  const versions = [];
  const versionsDir = getVersionsPath(projectId, sessionId);

  for (const compression of (session.compressions || [])) {
    let fileSizes = compression.fileSizes || { md: 0, jsonl: 0 };

    try {
      const mdPath = path.join(versionsDir, `${compression.file}.md`);
      const jsonlPath = path.join(versionsDir, `${compression.file}.jsonl`);

      if (await fs.pathExists(mdPath)) {
        const mdStats = await fs.stat(mdPath);
        fileSizes.md = mdStats.size;
      }
      if (await fs.pathExists(jsonlPath)) {
        const jsonlStats = await fs.stat(jsonlPath);
        fileSizes.jsonl = jsonlStats.size;
      }
    } catch (err) {
      // Keep stored sizes if we can't read files
    }

    versions.push({ ...compression, fileSizes });
  }

  return [originalVersion, ...versions];
}

/**
 * Get a specific compression version
 * Supports versionId='original' for the original session
 */
export async function getCompressionVersion(projectId, sessionId, versionId) {
  const session = await getSession(projectId, sessionId);

  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  if (versionId === 'original') {
    return {
      versionId: 'original',
      file: null,
      createdAt: session.registeredAt,
      isOriginal: true,
      settings: null,
      inputTokens: null,
      inputMessages: null,
      outputTokens: session.originalTokens,
      outputMessages: session.originalMessages,
      compressionRatio: 1.0,
      keepitStats: null,
      fileSizes: {
        md: 0,
        jsonl: await getFileSizeIfExists(session.originalFile) || 0
      },
      downloadUrls: {
        md: null,
        jsonl: `/api/memory/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions/original/content?format=jsonl`
      }
    };
  }

  const compression = (session.compressions || []).find(c => c.versionId === versionId);

  if (!compression) {
    const error = new Error(`Version ${versionId} not found for session ${sessionId}`);
    error.code = 'VERSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const versionsDir = getVersionsPath(projectId, sessionId);
  let fileSizes = compression.fileSizes || { md: 0, jsonl: 0 };

  try {
    const mdPath = path.join(versionsDir, `${compression.file}.md`);
    const jsonlPath = path.join(versionsDir, `${compression.file}.jsonl`);

    if (await fs.pathExists(mdPath)) {
      fileSizes.md = (await fs.stat(mdPath)).size;
    }
    if (await fs.pathExists(jsonlPath)) {
      fileSizes.jsonl = (await fs.stat(jsonlPath)).size;
    }
  } catch (err) {
    // Keep stored sizes
  }

  return {
    ...compression,
    fileSizes,
    downloadUrls: {
      md: `/api/memory/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions/${encodeURIComponent(versionId)}/download?format=md`,
      jsonl: `/api/memory/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions/${encodeURIComponent(versionId)}/download?format=jsonl`
    }
  };
}
