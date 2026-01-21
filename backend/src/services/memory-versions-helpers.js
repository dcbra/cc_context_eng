import fs from 'fs-extra';
import path from 'path';
import { extractTextContent } from './summarizer.js';
import {
  generateMarkdownOutput,
  generateJsonlOutput,
  generateMarkdownFromParsed
} from './memory-versions-output.js';

// Re-export output functions for backwards compatibility
export { generateMarkdownOutput, generateJsonlOutput, generateMarkdownFromParsed };

// ============================================
// Part Tracking Helper Functions
// (For incremental compression support)
// ============================================

/**
 * Get the highest part number for a session's compressions
 * Returns 0 if no parts exist
 *
 * @param {Array} compressions - Array of compression records
 * @returns {number} Highest part number (0 if no parts exist)
 */
export function getHighestPartNumber(compressions) {
  if (!compressions || compressions.length === 0) {
    return 0;
  }

  return Math.max(
    ...compressions
      .filter(c => c.partNumber !== undefined)
      .map(c => c.partNumber),
    0
  );
}

/**
 * Get compressions for a specific part number
 *
 * @param {Array} compressions - Array of compression records
 * @param {number} partNumber - Part number to filter by
 * @returns {Array} Compressions for the specified part
 */
export function getCompressionsByPart(compressions, partNumber) {
  if (!compressions || compressions.length === 0) {
    return [];
  }

  return compressions.filter(c => (c.partNumber || 1) === partNumber);
}

/**
 * Get the last compression's end timestamp
 * Used to determine where delta compression should start
 *
 * @param {Array} compressions - Array of compression records
 * @returns {string|null} ISO timestamp of last compression end, or null
 */
export function getLastCompressionEndTimestamp(compressions) {
  if (!compressions || compressions.length === 0) {
    return null;
  }

  // Find compressions with messageRange data
  const withRange = compressions.filter(c => c.messageRange?.endTimestamp);

  if (withRange.length === 0) {
    return null;
  }

  // Sort by endTimestamp descending (most recent first)
  // CRITICAL: Use new Date() for proper comparison
  const sorted = withRange.sort((a, b) =>
    new Date(b.messageRange.endTimestamp) - new Date(a.messageRange.endTimestamp)
  );

  return sorted[0].messageRange.endTimestamp;
}

/**
 * Lazily migrate a compression record to include incremental fields
 * Marks legacy compressions as isFullSession: true
 *
 * @param {Object} compression - Compression record to migrate
 * @param {Object} session - Session containing the compression
 * @returns {Object} Migrated compression record
 */
export function migrateCompressionRecord(compression, session) {
  // Already migrated
  if (compression.partNumber !== undefined) {
    return compression;
  }

  // Legacy compression - mark as covering full session
  return {
    ...compression,
    isFullSession: true,
    partNumber: 1,
    compressionLevel: determineCompressionLevelFromSettings(compression.settings),
    messageRange: {
      startIndex: 0,
      endIndex: session.originalMessages || compression.inputMessages,
      messageCount: session.originalMessages || compression.inputMessages,
      startTimestamp: session.firstTimestamp || null,
      endTimestamp: session.lastSyncedTimestamp || session.lastTimestamp || null
    }
  };
}

/**
 * Determine compression level from settings
 * 1 = light, 2 = moderate, 3 = aggressive
 *
 * @param {Object} settings - Compression settings
 * @returns {string} Compression level: "light", "moderate", or "aggressive"
 */
export function determineCompressionLevelFromSettings(settings) {
  if (!settings) return 'moderate';

  if (settings.mode === 'tiered') {
    const preset = settings.tierPreset || 'standard';
    if (preset === 'gentle') return 'light';
    if (preset === 'standard') return 'moderate';
    if (preset === 'aggressive') return 'aggressive';
    return 'moderate'; // custom defaults to moderate
  }

  const aggr = settings.aggressiveness || 'moderate';
  if (aggr === 'minimal') return 'light';
  if (aggr === 'moderate') return 'moderate';
  if (aggr === 'aggressive') return 'aggressive';
  return 'moderate';
}

// ============================================
// File I/O Helper Functions
// ============================================

/**
 * Save version files (.md and .jsonl)
 */
export async function saveVersionFiles(versionsDir, filename, result) {
  // Generate markdown content
  const markdownContent = generateMarkdownOutput(result);
  const mdPath = path.join(versionsDir, `${filename}.md`);
  await fs.writeFile(mdPath, markdownContent, 'utf-8');

  // Generate JSONL content
  const jsonlContent = generateJsonlOutput(result);
  const jsonlPath = path.join(versionsDir, `${filename}.jsonl`);
  await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');

  return {
    mdPath,
    jsonlPath,
    mdSize: Buffer.byteLength(markdownContent, 'utf-8'),
    jsonlSize: Buffer.byteLength(jsonlContent, 'utf-8')
  };
}

/**
 * Count tokens in the output messages
 * Uses character-based estimation since we don't have actual API usage data
 */
export function countOutputTokens(messages) {
  let totalChars = 0;

  for (const msg of messages) {
    const text = extractTextContent(msg);
    totalChars += text.length;
  }

  // Rough estimation: 1 token ~= 4 characters
  return Math.ceil(totalChars / 4);
}

/**
 * Helper to get file size if it exists
 */
export async function getFileSizeIfExists(filePath) {
  try {
    if (await fs.pathExists(filePath)) {
      const stats = await fs.stat(filePath);
      return stats.size;
    }
  } catch (err) {
    // Ignore errors
  }
  return null;
}

/**
 * Calculate tokens for a subset of messages
 * Uses character-based estimation
 *
 * @param {Array} messages - Messages to calculate tokens for
 * @returns {number} Estimated token count
 */
export function calculateDeltaTokens(messages) {
  let totalChars = 0;
  for (const msg of messages) {
    const text = extractTextContent(msg);
    totalChars += text.length;
  }
  // Rough estimation: 1 token ~= 4 characters
  return Math.ceil(totalChars / 4);
}
