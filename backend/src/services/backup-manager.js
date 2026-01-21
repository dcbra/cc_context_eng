import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { messagesToJsonl } from './sanitizer.js';
import {
  readJsonlAsArray,
  readJsonlAsLines,
  verifyJsonlIntegrity,
  readJsonlContent,
  compareJsonlFiles
} from '../utils/streaming-jsonl.js';

const BACKUPS_DIR = path.join(path.dirname(import.meta.url.replace('file://', '')), '../../backups');
const MAX_VERSIONS = 10;

/**
 * Save a backup of the current session by copying the original file
 */
export async function createBackup(sessionId, projectId, messages, description = '') {
  const backupDir = getSessionBackupDir(projectId, sessionId);
  await fs.ensureDir(backupDir);

  // Get the original session file path
  const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
  const sessionFilePath = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);

  // Get next version number
  const versions = await getBackupVersions(backupDir);

  // Rotate old backups: v10 -> delete, v9 -> v10, ..., current -> v1
  if (versions.length >= MAX_VERSIONS) {
    const oldestBackup = path.join(backupDir, `v${MAX_VERSIONS}.jsonl`);
    const oldestMeta = path.join(backupDir, `v${MAX_VERSIONS}.meta.json`);
    if (await fs.pathExists(oldestBackup)) {
      await fs.remove(oldestBackup);
    }
    if (await fs.pathExists(oldestMeta)) {
      await fs.remove(oldestMeta);
    }
  }

  // Rename existing backups
  for (let i = Math.min(versions.length, MAX_VERSIONS - 1); i > 0; i--) {
    const oldPath = path.join(backupDir, `v${i}.jsonl`);
    const oldMeta = path.join(backupDir, `v${i}.meta.json`);
    const newPath = path.join(backupDir, `v${i + 1}.jsonl`);
    const newMeta = path.join(backupDir, `v${i + 1}.meta.json`);
    if (await fs.pathExists(oldPath)) {
      await fs.rename(oldPath, newPath);
    }
    if (await fs.pathExists(oldMeta)) {
      await fs.rename(oldMeta, newMeta);
    }
  }

  // Copy original session file directly to preserve ALL records (messages, summaries, file-history-snapshots)
  const backupPath = path.join(backupDir, 'v1.jsonl');
  if (await fs.pathExists(sessionFilePath)) {
    await fs.copy(sessionFilePath, backupPath);
  } else {
    // Fallback: reconstruct from messages if original file doesn't exist
    const jsonl = messagesToJsonl(messages);
    await fs.writeFile(backupPath, jsonl, 'utf-8');
  }

  // Save metadata file
  const metadataPath = path.join(backupDir, 'v1.meta.json');
  await fs.writeFile(
    metadataPath,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      description,
      messageCount: messages.length,
      versionNumber: 1
    }, null, 2),
    'utf-8'
  );

  return {
    version: 1,
    backupPath,
    timestamp: new Date().toISOString(),
    messageCount: messages.length
  };
}

/**
 * Get all backup versions for a session
 */
export async function getBackupVersions(sessionDir) {
  try {
    const files = await fs.readdir(sessionDir);
    const versions = [];

    for (const file of files) {
      if (file.startsWith('v') && file.endsWith('.jsonl')) {
        const versionNum = parseInt(file.match(/v(\d+)/)[1]);
        const backupPath = path.join(sessionDir, file);
        const metadataPath = path.join(sessionDir, file.replace('.jsonl', '.meta.json'));

        let metadata = {
          timestamp: (await fs.stat(backupPath)).mtime,
          description: '',
          messageCount: 0,
          versionNumber: versionNum
        };

        if (await fs.pathExists(metadataPath)) {
          const metaContent = await fs.readFile(metadataPath, 'utf-8');
          try {
            metadata = JSON.parse(metaContent);
          } catch (e) {
            // Use default metadata if parse fails
          }
        }

        versions.push({
          version: versionNum,
          ...metadata,
          size: (await fs.stat(backupPath)).size
        });
      }
    }

    return versions.sort((a, b) => b.version - a.version);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Restore a specific backup version
 */
export async function restoreBackup(sessionPath, backupDir, version) {
  const backupPath = path.join(backupDir, `v${version}.jsonl`);

  if (!await fs.pathExists(backupPath)) {
    throw new Error(`Backup version ${version} not found`);
  }

  // Validate backup integrity using streaming (handles large files)
  const integrity = await verifyJsonlIntegrity(backupPath);
  if (!integrity.valid) {
    throw new Error(`Backup file is corrupted: ${integrity.errors[0]}`);
  }

  // Create temporary file for atomic write
  const tempPath = sessionPath + '.tmp';
  await fs.copy(backupPath, tempPath);

  // Atomic rename
  await fs.move(tempPath, sessionPath, { overwrite: true });

  return {
    success: true,
    restoredVersion: version,
    timestamp: new Date().toISOString(),
    messageCount: integrity.lineCount
  };
}

/**
 * Delete a specific backup version
 */
export async function deleteBackupVersion(backupDir, version) {
  const backupPath = path.join(backupDir, `v${version}.jsonl`);
  const metadataPath = path.join(backupDir, `v${version}.meta.json`);

  if (!await fs.pathExists(backupPath)) {
    throw new Error(`Backup version ${version} not found`);
  }

  // Never delete if it's the only backup
  const versions = await getBackupVersions(backupDir);
  if (versions.length <= 1) {
    throw new Error('Cannot delete the only backup');
  }

  await fs.remove(backupPath);
  if (await fs.pathExists(metadataPath)) {
    await fs.remove(metadataPath);
  }

  return { success: true, deletedVersion: version };
}

/**
 * Get session backup directory path
 */
export function getSessionBackupDir(projectId, sessionId) {
  // Create directory structure: backups/[projectId]/[sessionId]/
  return path.join(BACKUPS_DIR, projectId, sessionId);
}

/**
 * Export backup as JSONL
 */
export async function exportBackupAsJsonl(backupDir, version) {
  const backupPath = path.join(backupDir, `v${version}.jsonl`);

  if (!await fs.pathExists(backupPath)) {
    throw new Error(`Backup version ${version} not found`);
  }

  // Use streaming for large files to avoid ERR_STRING_TOO_LONG
  return await readJsonlContent(backupPath);
}

/**
 * Compare two backup versions
 */
export async function compareBackups(backupDir, version1, version2) {
  const path1 = path.join(backupDir, `v${version1}.jsonl`);
  const path2 = path.join(backupDir, `v${version2}.jsonl`);

  if (!await fs.pathExists(path1) || !await fs.pathExists(path2)) {
    throw new Error('One or both backup versions not found');
  }

  // Use streaming for large files to avoid ERR_STRING_TOO_LONG
  const [messages1, messages2] = await Promise.all([
    readJsonlAsArray(path1),
    readJsonlAsArray(path2)
  ]);

  // Calculate differences
  const uuids1 = new Set(messages1.map(m => m.uuid));
  const uuids2 = new Set(messages2.map(m => m.uuid));

  const removed = Array.from(uuids1).filter(id => !uuids2.has(id));
  const added = Array.from(uuids2).filter(id => !uuids1.has(id));

  // Calculate token difference
  const tokens1 = messages1.reduce((sum, m) => sum + (m.message?.usage?.input_tokens || 0) + (m.message?.usage?.output_tokens || 0), 0);
  const tokens2 = messages2.reduce((sum, m) => sum + (m.message?.usage?.input_tokens || 0) + (m.message?.usage?.output_tokens || 0), 0);

  return {
    version1,
    version2,
    messagesDifference: {
      removed: removed.length,
      added: added.length,
      net: messages2.length - messages1.length
    },
    tokensDifference: {
      original: tokens1,
      current: tokens2,
      change: tokens2 - tokens1,
      percentChange: ((tokens2 - tokens1) / tokens1) * 100
    }
  };
}

/**
 * Verify backup integrity (wrapper around streaming utility)
 */
export { verifyJsonlIntegrity as verifyBackupIntegrity } from '../utils/streaming-jsonl.js';
