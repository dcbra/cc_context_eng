/**
 * Keepit Preservation Verification
 *
 * Verifies that keepit markers that were supposed to survive compression
 * are actually preserved in the compressed output. Uses fuzzy matching
 * to handle slight LLM reformatting.
 */

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching of potentially modified content
 *
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;

  // Create 2D array for dynamic programming
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Initialize base cases
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // Fill in the rest of the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity ratio between two strings
 *
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity ratio (0.0 - 1.0)
 */
function calculateSimilarity(str1, str2) {
  if (!str1 && !str2) return 1.0;
  if (!str1 || !str2) return 0.0;

  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(str1, str2);
  return 1 - (distance / maxLen);
}

/**
 * Normalize text for comparison (remove extra whitespace, lowercase)
 *
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
function normalizeForComparison(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find the best partial match for needle in haystack
 * Uses sliding window approach for longer content
 *
 * @param {string} needle - Content to find
 * @param {string} haystack - Content to search in
 * @param {number} minSimilarity - Minimum similarity threshold (default 0.7)
 * @returns {object} Best match result with similarity and matched text
 */
export function findPartialMatch(needle, haystack, minSimilarity = 0.7) {
  if (!needle || !haystack) {
    return { found: false, similarity: 0, match: null };
  }

  const normalizedNeedle = normalizeForComparison(needle);
  const normalizedHaystack = normalizeForComparison(haystack);

  // Check for exact match first
  if (normalizedHaystack.includes(normalizedNeedle)) {
    return {
      found: true,
      similarity: 1.0,
      match: needle,
      matchType: 'exact'
    };
  }

  // For short content, do direct similarity comparison
  if (normalizedNeedle.length < 100) {
    // Sliding window search
    const windowSize = normalizedNeedle.length;
    let bestSimilarity = 0;
    let bestMatch = null;
    let bestStart = -1;

    // Only check windows if haystack is longer than needle
    if (normalizedHaystack.length >= windowSize) {
      for (let i = 0; i <= normalizedHaystack.length - windowSize; i++) {
        const window = normalizedHaystack.slice(i, i + windowSize);
        const similarity = calculateSimilarity(normalizedNeedle, window);

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = haystack.slice(i, i + windowSize);
          bestStart = i;
        }
      }
    }

    // Also try a wider window to catch slightly longer matches
    const widerWindowSize = Math.min(windowSize * 1.5, normalizedHaystack.length);
    for (let i = 0; i <= normalizedHaystack.length - widerWindowSize; i++) {
      const window = normalizedHaystack.slice(i, i + widerWindowSize);
      const similarity = calculateSimilarity(normalizedNeedle, window);

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = haystack.slice(i, i + widerWindowSize);
        bestStart = i;
      }
    }

    if (bestSimilarity >= minSimilarity) {
      return {
        found: true,
        similarity: bestSimilarity,
        match: bestMatch,
        matchType: 'fuzzy',
        position: bestStart
      };
    }
  } else {
    // For longer content, check key phrases and structure
    // Split into sentences and check each
    const needleSentences = normalizedNeedle.split(/[.!?]+/).filter(s => s.trim());
    let matchedSentences = 0;

    for (const sentence of needleSentences) {
      if (sentence.length < 10) continue; // Skip very short sentences

      if (normalizedHaystack.includes(sentence.trim())) {
        matchedSentences++;
      } else {
        // Try fuzzy match for each sentence
        const windowSize = sentence.length;
        for (let i = 0; i <= normalizedHaystack.length - windowSize; i++) {
          const window = normalizedHaystack.slice(i, i + windowSize + 20);
          if (calculateSimilarity(sentence, window) >= minSimilarity) {
            matchedSentences++;
            break;
          }
        }
      }
    }

    const sentenceMatchRatio = needleSentences.length > 0
      ? matchedSentences / needleSentences.length
      : 0;

    if (sentenceMatchRatio >= minSimilarity) {
      return {
        found: true,
        similarity: sentenceMatchRatio,
        match: '(structural match)',
        matchType: 'structural',
        matchedSentences,
        totalSentences: needleSentences.length
      };
    }
  }

  return {
    found: false,
    similarity: 0,
    match: null
  };
}

/**
 * Verify that keepit markers marked for survival are preserved in output
 *
 * @param {Array} originalKeepits - Array of original keepit markers
 * @param {string} compressedContent - The compressed output content
 * @param {Array} survivalDecisions - Array of survival decisions from decay calculator
 * @param {object} options - Verification options
 * @returns {object} Verification results
 */
export async function verifyKeepitPreservation(
  originalKeepits,
  compressedContent,
  survivalDecisions,
  options = {}
) {
  const {
    minSimilarity = 0.85,      // Minimum similarity for considering preserved
    warnSimilarity = 0.90,     // Below this, issue a warning even if found
    strictMode = false         // If true, modified content counts as missing
  } = options;

  const results = {
    verified: [],
    modified: [],
    missing: [],
    summary: {
      totalChecked: 0,
      fullyPreserved: 0,
      slightlyModified: 0,
      missing: 0,
      verificationPassed: true
    }
  };

  // Build a map of survival decisions for quick lookup
  const decisionMap = new Map(
    survivalDecisions.map(d => [d.markerId, d])
  );

  for (const keepit of originalKeepits) {
    const decision = decisionMap.get(keepit.markerId);

    // Only verify markers that should have survived
    if (!decision || !decision.survives) {
      continue;
    }

    results.summary.totalChecked++;

    // Check if content exists in output
    const normalizedContent = keepit.content.trim();
    const match = findPartialMatch(normalizedContent, compressedContent, minSimilarity);

    if (match.found && match.similarity >= 1.0) {
      // Exact match - fully preserved
      results.verified.push({
        markerId: keepit.markerId,
        weight: keepit.weight,
        status: 'preserved',
        similarity: 1.0,
        content: normalizedContent.substring(0, 100)
      });
      results.summary.fullyPreserved++;
    } else if (match.found && match.similarity >= minSimilarity) {
      // Fuzzy match - slightly modified
      const entry = {
        markerId: keepit.markerId,
        weight: keepit.weight,
        status: match.similarity >= warnSimilarity ? 'preserved_modified' : 'warning_modified',
        similarity: match.similarity,
        original: normalizedContent.substring(0, 100),
        found: match.match ? match.match.substring(0, 100) : null,
        matchType: match.matchType
      };

      if (strictMode && match.similarity < 1.0) {
        results.missing.push({
          ...entry,
          status: 'missing_strict_mode'
        });
        results.summary.missing++;
      } else {
        results.modified.push(entry);
        results.summary.slightlyModified++;
      }
    } else {
      // Not found - missing
      results.missing.push({
        markerId: keepit.markerId,
        weight: keepit.weight,
        status: 'missing',
        similarity: match.similarity,
        expectedContent: normalizedContent.substring(0, 100)
      });
      results.summary.missing++;
    }
  }

  // Determine if verification passed
  results.summary.verificationPassed = results.summary.missing === 0;

  return results;
}

/**
 * Generate a verification report suitable for logging or display
 *
 * @param {object} verificationResults - Results from verifyKeepitPreservation
 * @returns {string} Human-readable report
 */
export function generateVerificationReport(verificationResults) {
  const { verified, modified, missing, summary } = verificationResults;

  const lines = [
    '=== Keepit Preservation Verification Report ===',
    '',
    `Total markers checked: ${summary.totalChecked}`,
    `Fully preserved: ${summary.fullyPreserved}`,
    `Slightly modified: ${summary.slightlyModified}`,
    `Missing: ${summary.missing}`,
    `Verification status: ${summary.verificationPassed ? 'PASSED' : 'FAILED'}`,
    ''
  ];

  if (modified.length > 0) {
    lines.push('--- Modified Markers (preserved but altered) ---');
    for (const m of modified) {
      lines.push(`  [${m.markerId}] weight=${m.weight.toFixed(2)} similarity=${(m.similarity * 100).toFixed(1)}%`);
      if (m.original) lines.push(`    Original: "${m.original}..."`);
      if (m.found) lines.push(`    Found: "${m.found}..."`);
    }
    lines.push('');
  }

  if (missing.length > 0) {
    lines.push('--- MISSING Markers (should have survived) ---');
    for (const m of missing) {
      lines.push(`  [${m.markerId}] weight=${m.weight.toFixed(2)} status=${m.status}`);
      if (m.expectedContent) lines.push(`    Expected: "${m.expectedContent}..."`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Quick check if all surviving keepits are preserved (for use in compression flow)
 *
 * @param {Array} originalKeepits - Original markers
 * @param {string} compressedContent - Compressed output
 * @param {Array} survivalDecisions - Survival decisions
 * @returns {boolean} True if all surviving markers are preserved
 */
export function quickVerification(originalKeepits, compressedContent, survivalDecisions) {
  const decisionMap = new Map(
    survivalDecisions.map(d => [d.markerId, d])
  );

  for (const keepit of originalKeepits) {
    const decision = decisionMap.get(keepit.markerId);

    if (decision && decision.survives) {
      const normalizedContent = keepit.content.trim().toLowerCase();
      const normalizedOutput = compressedContent.toLowerCase();

      // Quick check for substring match
      if (!normalizedOutput.includes(normalizedContent)) {
        // Try fuzzy match
        const match = findPartialMatch(keepit.content, compressedContent, 0.85);
        if (!match.found) {
          return false;
        }
      }
    }
  }

  return true;
}
