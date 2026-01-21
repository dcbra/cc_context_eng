/**
 * Filename generation and parsing functions for memory versions
 */

import path from 'path';
import fs from 'fs-extra';
import { loadManifest } from './memory-manifest.js';
import { getSummariesDir } from './memory-storage.js';
import { COMPRESSION_LEVELS, COMPRESSION_LEVEL_NAMES } from './memory-versions-config.js';

// ============================================
// Filename Generation
// ============================================

/**
 * Generate a version filename following the spec pattern
 *
 * For part-based (incremental) compressions:
 * Format: part{N}_{versionId}_{mode}-{preset}_{tokens}k
 * Example: part1_v001_tiered-standard_10k
 *
 * For legacy full-session compressions:
 * Format: v{id}_{mode}-{preset}_{tokens}k
 * Example: v001_tiered-standard_10k
 *
 * @param {string} versionId - Version identifier (e.g., "v001" or "part1_v001")
 * @param {Object} settings - Compression settings
 * @param {number} tokenCount - Token count for the output
 * @param {number|null} partNumber - Part number for incremental compression (null for legacy)
 * @returns {string} Generated filename
 */
export function generateVersionFilename(versionId, settings, tokenCount, partNumber = null) {
  const mode = settings.mode || 'uniform';
  const preset = settings.tierPreset || settings.aggressiveness || 'custom';
  // Use at least 1k even for small token counts to avoid "0k" in filename
  const tokens = Math.max(1, Math.round(tokenCount / 1000));

  if (partNumber !== null && partNumber > 0) {
    // New part-based format for incremental compression
    return `part${partNumber}_${versionId}_${mode}-${preset}_${tokens}k`;
  }

  // Legacy format for backwards compatibility
  return `${versionId}_${mode}-${preset}_${tokens}k`;
}

/**
 * Generate part version filename using the new naming convention
 * Format: compressed_part{N}_v{M}.jsonl
 *
 * @param {number} partNumber - Part number (1, 2, 3, ...)
 * @param {string} compressionLevel - Compression level ('light', 'moderate', 'aggressive')
 * @returns {string} Generated filename without extension
 */
export function generatePartVersionFilename(partNumber, compressionLevel) {
  const levelNum = COMPRESSION_LEVELS[compressionLevel] || 2;
  return `compressed_part${partNumber}_v${levelNum}`;
}

// ============================================
// Filename Parsing
// ============================================

/**
 * Parse a part version filename to extract part number and compression level
 *
 * @param {string} filename - Filename to parse
 * @returns {Object|null} { partNumber, compressionLevel } or null if not parseable
 */
export function parsePartVersionFilename(filename) {
  // Match pattern: compressed_part{N}_v{M}
  const match = filename.match(/compressed_part(\d+)_v(\d+)/);
  if (!match) {
    return null;
  }

  const partNumber = parseInt(match[1], 10);
  const levelNum = parseInt(match[2], 10);
  const compressionLevel = COMPRESSION_LEVEL_NAMES[levelNum] || 'moderate';

  return { partNumber, compressionLevel };
}

/**
 * Parse version ID from a filename
 * e.g., "v001_tiered-standard_10k" -> "v001"
 */
export function parseVersionIdFromFilename(filename) {
  const match = filename.match(/^(v\d{3})_/);
  return match ? match[1] : null;
}

// ============================================
// Version ID Generation
// ============================================

/**
 * Get the next sequential version ID for a session
 * Returns IDs like v001, v002, etc.
 */
export async function getNextVersionId(projectId, sessionId) {
  const manifest = await loadManifest(projectId);
  const session = manifest.sessions[sessionId];

  if (!session) {
    throw new Error(`Session ${sessionId} not found in project ${projectId}`);
  }

  const compressions = session.compressions || [];
  const nextNumber = compressions.length + 1;

  // Zero-pad to 3 digits
  return `v${String(nextNumber).padStart(3, '0')}`;
}

// ============================================
// Path Functions
// ============================================

/**
 * Get the path to the versions directory for a session
 * Returns: ~/.claude-memory/projects/{projectId}/summaries/{sessionId}/
 */
export function getVersionsPath(projectId, sessionId) {
  const summariesDir = getSummariesDir(projectId);
  return path.join(summariesDir, sessionId);
}

/**
 * Ensure the versions directory exists for a session
 */
export async function ensureVersionsDir(projectId, sessionId) {
  const versionsDir = getVersionsPath(projectId, sessionId);
  await fs.ensureDir(versionsDir);
  return versionsDir;
}
