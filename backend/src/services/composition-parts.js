/**
 * Part-aware Composition Service
 *
 * Handles selection and composition of multiple compression parts
 * for incremental delta compression support.
 */

import fs from 'fs-extra';
import path from 'path';
import { parseJsonlFile } from './jsonl-parser.js';
import { getSession } from './memory-manifest.js';
import { getVersionsPath } from './memory-versions.js';
import { readJsonlAsArray } from '../utils/streaming-jsonl.js';
import {
  getPartsByNumber,
  getHighestPartNumber,
  getPartVersions
} from './memory-delta.js';

/**
 * Score a compression version against selection criteria
 * Returns a score from 0 to 1 where higher is better
 *
 * @param {Object} version - The compression version to score
 * @param {Object} criteria - Selection criteria
 * @param {number} criteria.maxTokens - Maximum token budget
 * @param {number} criteria.preferredRatio - Preferred compression ratio
 * @param {boolean} criteria.preserveKeepits - Prioritize keepit preservation
 * @returns {number} Score from 0 to 1
 */
export function scoreVersionForPart(version, criteria) {
  let score = 1.0;

  // Token budget fit (most important)
  if (criteria.maxTokens) {
    if (version.outputTokens > criteria.maxTokens) {
      // Over budget penalty - significantly reduce score
      score *= 0.1;
    } else {
      // Calculate utilization - prefer versions that use more of the budget
      const utilization = version.outputTokens / criteria.maxTokens;
      // Score range: 0.5 (0% utilization) to 1.0 (100% utilization)
      score *= 0.5 + (utilization * 0.5);
    }
  }

  // Ratio preference
  if (criteria.preferredRatio) {
    const ratioDiff = Math.abs(version.compressionRatio - criteria.preferredRatio);
    // Score decreases as ratio differs from preferred
    // Max 50% penalty for ratio difference
    score *= Math.max(0.5, 1 - (ratioDiff / 50));
  }

  // Keepit preservation priority
  if (criteria.preserveKeepits && version.keepitStats) {
    const total = version.keepitStats.preserved + version.keepitStats.summarized;
    if (total > 0) {
      const preservationRate = version.keepitStats.preserved / total;
      // Score range: 0.5 (0% preserved) to 1.0 (100% preserved)
      score *= 0.5 + (preservationRate * 0.5);
    }
  }

  // Recency bonus - prefer newer versions slightly
  if (version.createdAt && criteria.preferRecent) {
    const ageMs = Date.now() - new Date(version.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // Small penalty for older versions (up to 10% for 30+ day old versions)
    score *= Math.max(0.9, 1 - (ageDays / 300));
  }

  return score;
}

/**
 * Select the best versions of all parts for a session
 * Returns an array of versions (one per part) that fit the budget
 *
 * @param {Object} session - Session object from manifest
 * @param {Object} criteria - Selection criteria
 * @param {number} criteria.maxTokens - Maximum token budget for entire session
 * @param {boolean} criteria.preserveKeepits - Prioritize keepit preservation
 * @returns {Array} Array of selected version objects with partNumber
 */
export function selectBestVersionsForParts(session, criteria) {
  const partsByNumber = getPartsByNumber(session);
  const selectedVersions = [];

  // If no parts exist, fall back to original
  if (partsByNumber.size === 0) {
    return [{
      versionId: 'original',
      partNumber: 1,
      isOriginal: true,
      outputTokens: session.originalTokens || 0,
      outputMessages: session.originalMessages || 0,
      messageRange: {
        startIndex: 0,
        endIndex: session.originalMessages || 0
      }
    }];
  }

  // Calculate per-part budget based on number of parts
  const perPartBudget = criteria.maxTokens
    ? Math.floor(criteria.maxTokens / partsByNumber.size)
    : Infinity;

  // Sort part numbers for ordered iteration
  const sortedPartNumbers = Array.from(partsByNumber.keys()).sort((a, b) => a - b);

  // Select best version for each part
  for (const partNumber of sortedPartNumbers) {
    const versions = partsByNumber.get(partNumber);

    // Score and select best version for this part
    const scored = versions
      .map(v => ({
        version: v,
        score: scoreVersionForPart(v, { ...criteria, maxTokens: perPartBudget })
      }))
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0 && scored[0].score >= 0.3) {
      selectedVersions.push({
        ...scored[0].version,
        partNumber
      });
    }
  }

  return selectedVersions;
}

/**
 * Calculate total tokens across multiple selected part versions
 *
 * @param {Array} selectedVersions - Array of selected version objects
 * @returns {number} Total tokens
 */
export function calculateTotalPartTokens(selectedVersions) {
  return selectedVersions.reduce((sum, v) => sum + (v.outputTokens || 0), 0);
}

/**
 * Calculate total messages across multiple selected part versions
 *
 * @param {Array} selectedVersions - Array of selected version objects
 * @returns {number} Total messages
 */
export function calculateTotalPartMessages(selectedVersions) {
  return selectedVersions.reduce((sum, v) => sum + (v.outputMessages || 0), 0);
}

/**
 * Check if selected part versions fit within a token budget
 *
 * @param {Array} selectedVersions - Array of selected version objects
 * @param {number} maxTokens - Maximum token budget
 * @returns {Object} Fit status with details
 */
export function checkPartsFitBudget(selectedVersions, maxTokens) {
  const totalTokens = calculateTotalPartTokens(selectedVersions);
  const fitsWithinBudget = totalTokens <= maxTokens;
  const overageTokens = fitsWithinBudget ? 0 : totalTokens - maxTokens;
  const utilizationPercent = maxTokens > 0 ? Math.round((totalTokens / maxTokens) * 100) : 0;

  return {
    fitsWithinBudget,
    totalTokens,
    maxTokens,
    overageTokens,
    utilizationPercent,
    partCount: selectedVersions.length
  };
}

/**
 * Generate composed output from multiple parts
 * Parts are concatenated in order (part 1 first, then part 2, etc.)
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {Array} selectedVersions - Array of selected version objects
 * @returns {Array} Combined messages from all parts in order
 */
export async function composeFromParts(projectId, sessionId, selectedVersions) {
  const session = await getSession(projectId, sessionId);
  if (!session) {
    const error = new Error(`Session ${sessionId} not found`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const versionsDir = getVersionsPath(projectId, sessionId);
  const allMessages = [];

  // Sort by part number to ensure correct order
  const sortedVersions = [...selectedVersions].sort(
    (a, b) => (a.partNumber || 1) - (b.partNumber || 1)
  );

  for (const version of sortedVersions) {
    if (version.isOriginal) {
      // Read original messages for this part's range
      const sourceFile = session.linkedFile || session.originalFile;
      if (await fs.pathExists(sourceFile)) {
        const parsed = await parseJsonlFile(sourceFile);
        const range = version.messageRange || {
          startIndex: 0,
          endIndex: parsed.messages.length
        };
        const partMessages = parsed.messages.slice(range.startIndex, range.endIndex);
        allMessages.push(...partMessages);
      }
    } else {
      // Read compressed version
      const compression = session.compressions.find(c => c.versionId === version.versionId);
      if (compression) {
        const jsonlPath = path.join(versionsDir, `${compression.file}.jsonl`);
        if (await fs.pathExists(jsonlPath)) {
          const records = await readJsonlAsArray(jsonlPath);
          const messages = records.filter(r => r.type === 'user' || r.type === 'assistant');
          allMessages.push(...messages);
        }
      }
    }
  }

  return allMessages;
}

/**
 * Get session part information for composition preview
 *
 * @param {Object} session - Session object from manifest
 * @returns {Object} Part information including count, ranges, and available versions
 */
export function getSessionPartInfo(session) {
  const partsByNumber = getPartsByNumber(session);
  const partCount = partsByNumber.size;

  if (partCount === 0) {
    return {
      hasParts: false,
      partCount: 0,
      parts: [],
      totalCompressedTokens: 0,
      totalCompressedMessages: 0
    };
  }

  const parts = [];
  let totalCompressedTokens = 0;
  let totalCompressedMessages = 0;

  // Sort by part number
  const sortedPartNumbers = Array.from(partsByNumber.keys()).sort((a, b) => a - b);

  for (const partNumber of sortedPartNumbers) {
    const versions = partsByNumber.get(partNumber);
    const firstVersion = versions[0];

    // Use smallest version for default token count (most compressed)
    const smallestVersion = versions.reduce(
      (min, v) => (v.outputTokens < min.outputTokens ? v : min),
      versions[0]
    );

    parts.push({
      partNumber,
      messageRange: firstVersion?.messageRange || null,
      versionCount: versions.length,
      versions: versions.map(v => ({
        versionId: v.versionId,
        compressionLevel: v.compressionLevel,
        outputTokens: v.outputTokens,
        outputMessages: v.outputMessages,
        compressionRatio: v.compressionRatio
      })),
      smallestTokens: smallestVersion.outputTokens,
      smallestMessages: smallestVersion.outputMessages
    });

    totalCompressedTokens += smallestVersion.outputTokens;
    totalCompressedMessages += smallestVersion.outputMessages;
  }

  return {
    hasParts: true,
    partCount,
    parts,
    totalCompressedTokens,
    totalCompressedMessages
  };
}
