/**
 * Memory System Statistics Service
 *
 * Calculates storage usage and system statistics for the memory system.
 *
 * Phase 5 - Task 5.4: Storage Usage Statistics API
 */

import fs from 'fs-extra';
import path from 'path';
import {
  getMemoryRoot,
  getProjectsDir,
  getProjectDir,
  getOriginalsDir,
  getSummariesDir,
  getComposedDir,
  getCacheDir
} from './memory-storage.js';
import { loadManifest, manifestExists } from './memory-manifest.js';

// ============================================
// Directory Size Calculation
// ============================================

/**
 * Calculate the total size of a directory recursively
 *
 * @param {string} dirPath - Path to directory
 * @returns {Promise<number>} Total size in bytes
 */
async function getDirSize(dirPath) {
  try {
    if (!await fs.pathExists(dirPath)) {
      return 0;
    }

    const stat = await fs.stat(dirPath);

    if (!stat.isDirectory()) {
      return stat.size;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let totalSize = 0;

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        totalSize += await getDirSize(entryPath);
      } else if (entry.isFile()) {
        const fileStat = await fs.stat(entryPath);
        totalSize += fileStat.size;
      }
    }

    return totalSize;
  } catch (error) {
    console.error(`Error calculating size for ${dirPath}:`, error.message);
    return 0;
  }
}

/**
 * Count files in a directory recursively
 *
 * @param {string} dirPath - Path to directory
 * @returns {Promise<number>} File count
 */
async function getFileCount(dirPath) {
  try {
    if (!await fs.pathExists(dirPath)) {
      return 0;
    }

    const stat = await fs.stat(dirPath);

    if (!stat.isDirectory()) {
      return 1;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        count += await getFileCount(entryPath);
      } else if (entry.isFile()) {
        count++;
      }
    }

    return count;
  } catch (error) {
    return 0;
  }
}

// ============================================
// Project Statistics
// ============================================

/**
 * Get comprehensive statistics for a project
 *
 * @param {string} projectId - Project ID
 * @returns {Promise<Object>} Project statistics
 */
export async function getProjectStats(projectId) {
  if (!await manifestExists(projectId)) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const manifest = await loadManifest(projectId);
  const projectDir = getProjectDir(projectId);

  // Initialize stats structure
  const stats = {
    projectId,
    displayName: manifest.displayName,
    createdAt: manifest.createdAt,
    lastModified: manifest.lastModified,
    sessions: {
      total: Object.keys(manifest.sessions).length,
      withCompressions: 0,
      totalOriginalTokens: 0,
      totalCompressedTokens: 0,
      totalOriginalMessages: 0
    },
    storage: {
      originalsSize: 0,
      summariesSize: 0,
      composedSize: 0,
      totalSize: 0
    },
    compressions: {
      total: 0,
      byMode: { uniform: 0, tiered: 0 },
      byPreset: {},
      averageRatio: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0
    },
    compositions: {
      total: Object.keys(manifest.compositions || {}).length,
      totalTokens: 0,
      totalMessages: 0
    },
    keepits: {
      total: 0,
      byWeight: {}
    }
  };

  // Aggregate session statistics
  let ratioSum = 0;
  let ratioCount = 0;

  for (const session of Object.values(manifest.sessions)) {
    // Original stats
    stats.sessions.totalOriginalTokens += session.originalTokens || 0;
    stats.sessions.totalOriginalMessages += session.originalMessages || 0;

    // Compression stats
    const compressions = session.compressions || [];
    if (compressions.length > 0) {
      stats.sessions.withCompressions++;
    }

    for (const compression of compressions) {
      stats.compressions.total++;

      // By mode
      const mode = compression.settings?.mode || 'unknown';
      stats.compressions.byMode[mode] = (stats.compressions.byMode[mode] || 0) + 1;

      // By preset
      const preset = compression.settings?.tierPreset ||
                    compression.settings?.aggressiveness ||
                    'custom';
      stats.compressions.byPreset[preset] = (stats.compressions.byPreset[preset] || 0) + 1;

      // Token stats
      stats.compressions.totalInputTokens += compression.inputTokens || 0;
      stats.compressions.totalOutputTokens += compression.outputTokens || 0;

      // Ratio calculation
      if (compression.compressionRatio && compression.compressionRatio > 0) {
        ratioSum += compression.compressionRatio;
        ratioCount++;
      }

      // Add to total compressed tokens (most recent compression per session)
      if (compression === compressions[compressions.length - 1]) {
        stats.sessions.totalCompressedTokens += compression.outputTokens || 0;
      }
    }

    // Keepit stats
    const keepits = session.keepitMarkers || [];
    stats.keepits.total += keepits.length;

    for (const keepit of keepits) {
      const weight = keepit.weight || 0;
      // Bucket weights into categories
      let category;
      if (weight >= 1.0) category = 'pinned';
      else if (weight >= 0.9) category = 'critical';
      else if (weight >= 0.75) category = 'important';
      else if (weight >= 0.5) category = 'notable';
      else if (weight >= 0.25) category = 'minor';
      else category = 'hint';

      stats.keepits.byWeight[category] = (stats.keepits.byWeight[category] || 0) + 1;
    }
  }

  // Calculate average compression ratio
  stats.compressions.averageRatio = ratioCount > 0
    ? Number((ratioSum / ratioCount).toFixed(2))
    : 0;

  // Calculate storage sizes
  const [originalsSize, summariesSize, composedSize] = await Promise.all([
    getDirSize(getOriginalsDir(projectId)),
    getDirSize(getSummariesDir(projectId)),
    getDirSize(getComposedDir(projectId))
  ]);

  stats.storage.originalsSize = originalsSize;
  stats.storage.summariesSize = summariesSize;
  stats.storage.composedSize = composedSize;
  stats.storage.totalSize = originalsSize + summariesSize + composedSize;

  // Format sizes for readability
  stats.storage.formatted = {
    originals: formatBytes(originalsSize),
    summaries: formatBytes(summariesSize),
    composed: formatBytes(composedSize),
    total: formatBytes(stats.storage.totalSize)
  };

  // Composition stats
  for (const composition of Object.values(manifest.compositions || {})) {
    stats.compositions.totalTokens += composition.actualTokens || 0;
    stats.compositions.totalMessages += composition.totalMessages || 0;
  }

  return stats;
}

// ============================================
// Global Statistics
// ============================================

/**
 * Get global statistics across all projects
 *
 * @returns {Promise<Object>} Global statistics
 */
export async function getGlobalStats() {
  const projectsDir = getProjectsDir();
  const cacheDir = getCacheDir();
  const memoryRoot = getMemoryRoot();

  const stats = {
    memoryRoot,
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    projects: {
      total: 0,
      list: []
    },
    sessions: {
      total: 0,
      withCompressions: 0
    },
    storage: {
      projectsSize: 0,
      cacheSize: 0,
      totalSize: 0,
      formatted: {}
    },
    compressions: {
      total: 0,
      byMode: { uniform: 0, tiered: 0 }
    },
    compositions: {
      total: 0
    },
    keepits: {
      total: 0
    }
  };

  // Check if projects directory exists
  if (!await fs.pathExists(projectsDir)) {
    return stats;
  }

  // List all projects
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectId = entry.name;

    // Skip if no manifest
    if (!await manifestExists(projectId)) continue;

    stats.projects.total++;

    try {
      const manifest = await loadManifest(projectId);

      stats.projects.list.push({
        projectId,
        displayName: manifest.displayName,
        sessionCount: Object.keys(manifest.sessions).length,
        lastModified: manifest.lastModified
      });

      // Aggregate session stats
      for (const session of Object.values(manifest.sessions)) {
        stats.sessions.total++;

        if (session.compressions && session.compressions.length > 0) {
          stats.sessions.withCompressions++;
          stats.compressions.total += session.compressions.length;

          // Count by mode
          for (const compression of session.compressions) {
            const mode = compression.settings?.mode || 'unknown';
            stats.compressions.byMode[mode] = (stats.compressions.byMode[mode] || 0) + 1;
          }
        }

        // Count keepits
        stats.keepits.total += (session.keepitMarkers || []).length;
      }

      // Count compositions
      stats.compositions.total += Object.keys(manifest.compositions || {}).length;

    } catch (error) {
      console.warn(`Failed to load manifest for project ${projectId}:`, error.message);
    }
  }

  // Calculate storage sizes
  const [projectsSize, cacheSize] = await Promise.all([
    getDirSize(projectsDir),
    getDirSize(cacheDir)
  ]);

  stats.storage.projectsSize = projectsSize;
  stats.storage.cacheSize = cacheSize;
  stats.storage.totalSize = projectsSize + cacheSize;

  stats.storage.formatted = {
    projects: formatBytes(projectsSize),
    cache: formatBytes(cacheSize),
    total: formatBytes(stats.storage.totalSize)
  };

  // Sort projects by last modified
  stats.projects.list.sort((a, b) =>
    new Date(b.lastModified) - new Date(a.lastModified)
  );

  return stats;
}

// ============================================
// Session Statistics
// ============================================

/**
 * Get statistics for a specific session
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Session statistics
 */
export async function getSessionStats(projectId, sessionId) {
  const manifest = await loadManifest(projectId);
  const session = manifest.sessions[sessionId];

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const compressions = session.compressions || [];
  const keepits = session.keepitMarkers || [];

  // Calculate version sizes
  const versionsDir = path.join(getSummariesDir(projectId), sessionId);
  let versionsSize = 0;

  if (await fs.pathExists(versionsDir)) {
    versionsSize = await getDirSize(versionsDir);
  }

  // Calculate compression stats
  let totalOutputTokens = 0;
  let bestCompressionRatio = 0;
  let averageRatio = 0;

  for (const compression of compressions) {
    totalOutputTokens += compression.outputTokens || 0;

    if (compression.compressionRatio > bestCompressionRatio) {
      bestCompressionRatio = compression.compressionRatio;
    }
  }

  if (compressions.length > 0) {
    averageRatio = compressions.reduce((sum, c) => sum + (c.compressionRatio || 0), 0) / compressions.length;
  }

  return {
    sessionId,
    projectId,
    originalTokens: session.originalTokens,
    originalMessages: session.originalMessages,
    registeredAt: session.registeredAt,
    lastAccessed: session.lastAccessed,
    compressions: {
      count: compressions.length,
      totalOutputTokens,
      bestCompressionRatio: Number(bestCompressionRatio.toFixed(2)),
      averageRatio: Number(averageRatio.toFixed(2)),
      versions: compressions.map(c => ({
        versionId: c.versionId,
        outputTokens: c.outputTokens,
        compressionRatio: c.compressionRatio,
        createdAt: c.createdAt
      }))
    },
    keepits: {
      count: keepits.length,
      byWeight: keepits.reduce((acc, k) => {
        const weight = k.weight.toFixed(2);
        acc[weight] = (acc[weight] || 0) + 1;
        return acc;
      }, {})
    },
    storage: {
      versionsSize,
      formatted: formatBytes(versionsSize)
    }
  };
}

// ============================================
// Cache Statistics
// ============================================

/**
 * Get cache statistics
 *
 * @returns {Promise<Object>} Cache statistics
 */
export async function getCacheStats() {
  const cacheDir = getCacheDir();

  if (!await fs.pathExists(cacheDir)) {
    return {
      exists: false,
      size: 0,
      fileCount: 0,
      formatted: '0 Bytes'
    };
  }

  const size = await getDirSize(cacheDir);
  const fileCount = await getFileCount(cacheDir);

  return {
    exists: true,
    size,
    fileCount,
    formatted: formatBytes(size)
  };
}

/**
 * Clear the cache directory
 *
 * @returns {Promise<Object>} Result summary
 */
export async function clearCache() {
  const cacheDir = getCacheDir();

  if (!await fs.pathExists(cacheDir)) {
    return {
      cleared: false,
      reason: 'Cache directory does not exist'
    };
  }

  const beforeSize = await getDirSize(cacheDir);
  const beforeCount = await getFileCount(cacheDir);

  await fs.emptyDir(cacheDir);

  return {
    cleared: true,
    bytesFreed: beforeSize,
    filesRemoved: beforeCount,
    formatted: formatBytes(beforeSize)
  };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Format bytes to human-readable string
 *
 * @param {number} bytes - Number of bytes
 * @returns {string} Human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  if (bytes < 0) return 'N/A';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Parse size string to bytes (e.g., "1GB" -> 1073741824)
 *
 * @param {string} sizeStr - Size string
 * @returns {number} Size in bytes
 */
export function parseSize(sizeStr) {
  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024
  };

  return Math.floor(value * (multipliers[unit] || 1));
}

// ============================================
// Exports
// ============================================

export default {
  getProjectStats,
  getGlobalStats,
  getSessionStats,
  getCacheStats,
  clearCache,
  formatBytes,
  parseSize,
  getDirSize,
  getFileCount
};

export { formatBytes, getDirSize, getFileCount };
