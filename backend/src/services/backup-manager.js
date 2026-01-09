import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { messagesToJsonl } from './sanitizer.js';

const BACKUPS_DIR = path.join(path.dirname(import.meta.url.replace('file://', '')), '../../backups');
const MAX_VERSIONS = 10;

/**
 * Save a backup of the current session
 */
export async function createBackup(sessionId, projectId, messages, description = '') {
  const backupDir = getSessionBackupDir(projectId, sessionId);
  await fs.ensureDir(backupDir);

  // Get next version number
  const versions = await getBackupVersions(backupDir);
  const nextVersion = versions.length + 1;

  // Rotate old backups: v10 -> delete, v9 -> v10, ..., current -> v1
  if (versions.length >= MAX_VERSIONS) {
    const oldestBackup = path.join(backupDir, `v${MAX_VERSIONS}.jsonl`);
    if (await fs.pathExists(oldestBackup)) {
      await fs.remove(oldestBackup);
    }
  }

  // Rename existing backups
  for (let i = versions.length; i > 0; i--) {
    const oldPath = path.join(backupDir, `v${i}.jsonl`);
    const newPath = path.join(backupDir, `v${i + 1}.jsonl`);
    if (await fs.pathExists(oldPath)) {
      await fs.rename(oldPath, newPath);
    }
  }

  // Save new backup as v1
  const backupPath = path.join(backupDir, 'v1.jsonl');
  const jsonl = messagesToJsonl(messages);

  // Save with metadata
  await fs.writeFile(backupPath, jsonl, 'utf-8');

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

  // Validate backup integrity
  const content = await fs.readFile(backupPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch (e) {
      throw new Error(`Backup file is corrupted: ${e.message}`);
    }
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
    messageCount: lines.length
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

  return await fs.readFile(backupPath, 'utf-8');
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

  const content1 = await fs.readFile(path1, 'utf-8');
  const content2 = await fs.readFile(path2, 'utf-8');

  const lines1 = content1.split('\n').filter(l => l.trim());
  const lines2 = content2.split('\n').filter(l => l.trim());

  const messages1 = lines1.map(l => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);

  const messages2 = lines2.map(l => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);

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
 * Verify backup integrity
 */
export async function verifyBackupIntegrity(backupPath) {
  const content = await fs.readFile(backupPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  let errors = [];
  let warnings = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const record = JSON.parse(lines[i]);

      // Basic validation
      if (!record.uuid) {
        errors.push(`Line ${i + 1}: Missing uuid`);
      }
      if (!record.type) {
        errors.push(`Line ${i + 1}: Missing type`);
      }
    } catch (e) {
      errors.push(`Line ${i + 1}: Invalid JSON - ${e.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    messageCount: lines.length,
    errors,
    warnings
  };
}
