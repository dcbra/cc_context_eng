import express from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import {
  createBackup,
  getBackupVersions,
  restoreBackup,
  deleteBackupVersion,
  compareBackups,
  getSessionBackupDir,
  verifyBackupIntegrity
} from '../services/backup-manager.js';

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
      return;
    }

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

    const stat = await fs.stat(sessionFilePath);
    const fileMtime = Math.floor(stat.mtimeMs);

    const index = JSON.parse(await fs.readFile(indexFile, 'utf-8'));
    const entry = index.entries?.find(e => e.sessionId === sessionId);
    if (!entry) return;

    entry.messageCount = messageCount;
    entry.fileMtime = fileMtime;
    entry.modified = new Date().toISOString();

    await fs.writeFile(indexFile, JSON.stringify(index, null, 2));
    console.log(`[syncSessionsIndex] Updated ${sessionId}: messageCount -> ${messageCount}`);
  } catch (error) {
    console.error(`[syncSessionsIndex] Error:`, error.message);
  }
}

/**
 * POST /api/backup/:sessionId/save
 * Save current state as backup
 */
router.post('/:sessionId/save', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;
    const { messages, description } = req.body;

    if (!sessionId || !projectId || !messages) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const backupDir = getSessionBackupDir(projectId, sessionId);
    const backup = await createBackup(sessionId, projectId, messages, description);

    res.json({
      success: true,
      backup
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/backup/:sessionId/versions
 * List all backup versions
 */
router.get('/:sessionId/versions', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;

    if (!sessionId || !projectId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const backupDir = getSessionBackupDir(projectId, sessionId);
    const versions = await getBackupVersions(backupDir);

    res.json({
      sessionId,
      projectId,
      versions
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/backup/:sessionId/restore/:version
 * Restore from a specific backup version
 */
router.post('/:sessionId/restore/:version', async (req, res, next) => {
  try {
    const { sessionId, version } = req.params;
    const { projectId } = req.query;

    if (!sessionId || !projectId || !version) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const sessionPath = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);
    const backupDir = getSessionBackupDir(projectId, sessionId);

    const result = await restoreBackup(sessionPath, backupDir, parseInt(version));
    await syncSessionsIndex(sessionPath, projectId);

    res.json({
      success: true,
      result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/backup/:sessionId/versions/:version
 * Delete a specific backup version
 */
router.delete('/:sessionId/versions/:version', async (req, res, next) => {
  try {
    const { sessionId, version } = req.params;
    const { projectId } = req.query;

    if (!sessionId || !projectId || !version) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const backupDir = getSessionBackupDir(projectId, sessionId);
    const result = await deleteBackupVersion(backupDir, parseInt(version));

    res.json({ success: true, result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/backup/:sessionId/compare
 * Compare two backup versions
 */
router.post('/:sessionId/compare', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;
    const { version1, version2 } = req.body;

    if (!sessionId || !projectId || !version1 || !version2) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const backupDir = getSessionBackupDir(projectId, sessionId);
    const comparison = await compareBackups(backupDir, version1, version2);

    res.json(comparison);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/backup/:sessionId/verify/:version
 * Verify backup integrity
 */
router.get('/:sessionId/verify/:version', async (req, res, next) => {
  try {
    const { sessionId, version } = req.params;
    const { projectId } = req.query;

    if (!sessionId || !projectId || !version) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const backupDir = getSessionBackupDir(projectId, sessionId);
    const backupPath = path.join(backupDir, `v${version}.jsonl`);

    const verification = await verifyBackupIntegrity(backupPath);

    res.json(verification);
  } catch (error) {
    next(error);
  }
});

export default router;
