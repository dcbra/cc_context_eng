/**
 * Keepit Decay Calculation Algorithm
 *
 * Implements the decay formula for determining which keepit markers survive
 * compression based on their weight, session distance, and compression settings.
 *
 * Formula from design doc:
 *   survival_threshold = compression_base + (ratio_penalty * distance_factor)
 *
 * Where:
 *   compression_base: light=0.1, moderate=0.3, aggressive=0.5
 *   ratio_penalty: compressionRatio / 100
 *   distance_factor: min(sessionDistance, 10) / 10
 */

import { validateWeight, isPinned } from './keepit-parser.js';

// Compression base values by aggressiveness level
const COMPRESSION_BASES = {
  light: 0.1,
  moderate: 0.3,
  aggressive: 0.5
};

// Maximum session distance for decay calculation
const MAX_SESSION_DISTANCE = 10;

/**
 * Determine aggressiveness level based on compression ratio and explicit setting
 * @param {number} compressionRatio - The compression ratio (e.g., 10, 25, 50)
 * @param {string} explicitAggressiveness - Explicit aggressiveness if set ('light', 'moderate', 'aggressive')
 * @returns {string} Aggressiveness level
 */
export function getAggressivenessLevel(compressionRatio, explicitAggressiveness) {
  // If explicit aggressiveness is set, use it
  if (explicitAggressiveness && COMPRESSION_BASES[explicitAggressiveness] !== undefined) {
    return explicitAggressiveness;
  }

  // Infer from compression ratio
  if (compressionRatio <= 5) return 'light';
  if (compressionRatio <= 15) return 'moderate';
  return 'aggressive';
}

/**
 * Calculate the survival threshold for keepit markers
 *
 * @param {number} compressionRatio - The compression ratio (e.g., 10 means 10:1 compression)
 * @param {number} sessionDistance - How many sessions ago this content is from (0 = current)
 * @param {string} aggressiveness - Compression aggressiveness ('light', 'moderate', 'aggressive')
 * @returns {number} Survival threshold (0.0 - 1.0). Keepits with weight >= threshold survive.
 */
export function calculateSurvivalThreshold(compressionRatio, sessionDistance = 0, aggressiveness = null) {
  // Get aggressiveness level
  const level = getAggressivenessLevel(compressionRatio, aggressiveness);

  // Base threshold from aggressiveness level
  const compressionBase = COMPRESSION_BASES[level];

  // Ratio penalty: higher compression ratios increase threshold
  const ratioPenalty = Math.min(compressionRatio, 100) / 100;

  // Distance factor: older content has higher threshold (decays faster)
  const normalizedDistance = Math.min(sessionDistance, MAX_SESSION_DISTANCE);
  const distanceFactor = normalizedDistance / MAX_SESSION_DISTANCE;

  // Calculate final threshold
  const threshold = compressionBase + (ratioPenalty * distanceFactor);

  // Cap at 0.99 so pinned (1.0) content always survives
  return Math.min(threshold, 0.99);
}

/**
 * Determine if a keepit marker should survive compression
 *
 * @param {number} weight - The keepit marker's weight (0.00 - 1.00)
 * @param {number} sessionDistance - How many sessions ago this content is from
 * @param {number} compressionRatio - The compression ratio
 * @param {string} aggressiveness - Compression aggressiveness level
 * @returns {boolean} True if the marker should survive (be preserved verbatim)
 */
export function shouldKeepitSurvive(weight, sessionDistance, compressionRatio, aggressiveness = null) {
  const normalizedWeight = validateWeight(weight);

  // Pinned content (weight 1.00) ALWAYS survives
  if (isPinned(normalizedWeight)) {
    return true;
  }

  const threshold = calculateSurvivalThreshold(compressionRatio, sessionDistance, aggressiveness);
  return normalizedWeight >= threshold;
}

/**
 * Preview decay decisions for a set of keepit markers
 *
 * @param {Array} markers - Array of keepit marker objects with weight property
 * @param {object} settings - Compression settings
 * @param {number} settings.compressionRatio - The compression ratio
 * @param {number} settings.sessionDistance - Session distance (default 0)
 * @param {string} settings.aggressiveness - Explicit aggressiveness level
 * @returns {object} Preview result with surviving and summarized markers
 */
export function previewDecay(markers, settings) {
  const {
    compressionRatio = 10,
    sessionDistance = 0,
    aggressiveness = null
  } = settings;

  const threshold = calculateSurvivalThreshold(compressionRatio, sessionDistance, aggressiveness);
  const level = getAggressivenessLevel(compressionRatio, aggressiveness);

  const results = {
    threshold,
    aggressivenessLevel: level,
    compressionRatio,
    sessionDistance,
    surviving: [],
    summarized: [],
    stats: {
      total: markers.length,
      survivingCount: 0,
      summarizedCount: 0,
      pinnedCount: 0
    }
  };

  for (const marker of markers) {
    const survives = shouldKeepitSurvive(
      marker.weight,
      sessionDistance,
      compressionRatio,
      aggressiveness
    );

    const decision = {
      markerId: marker.markerId,
      weight: marker.weight,
      survives,
      isPinned: isPinned(marker.weight),
      threshold,
      marginFromThreshold: marker.weight - threshold
    };

    if (survives) {
      results.surviving.push(decision);
      results.stats.survivingCount++;
      if (isPinned(marker.weight)) {
        results.stats.pinnedCount++;
      }
    } else {
      results.summarized.push(decision);
      results.stats.summarizedCount++;
    }
  }

  return results;
}

/**
 * Calculate threshold for multiple compression scenarios
 * Useful for showing users how different settings affect their keepits
 *
 * @param {Array} markers - Array of keepit markers
 * @returns {object} Survival analysis across different compression levels
 */
export function analyzeKeepitSurvival(markers) {
  const scenarios = [
    { name: 'Light (3:1)', compressionRatio: 3, aggressiveness: 'light' },
    { name: 'Moderate (10:1)', compressionRatio: 10, aggressiveness: 'moderate' },
    { name: 'Standard (15:1)', compressionRatio: 15, aggressiveness: 'moderate' },
    { name: 'Aggressive (25:1)', compressionRatio: 25, aggressiveness: 'aggressive' },
    { name: 'Maximum (50:1)', compressionRatio: 50, aggressiveness: 'aggressive' }
  ];

  const analysis = {
    totalMarkers: markers.length,
    pinnedCount: markers.filter(m => isPinned(m.weight)).length,
    scenarios: []
  };

  for (const scenario of scenarios) {
    const preview = previewDecay(markers, {
      compressionRatio: scenario.compressionRatio,
      aggressiveness: scenario.aggressiveness,
      sessionDistance: 0
    });

    analysis.scenarios.push({
      name: scenario.name,
      compressionRatio: scenario.compressionRatio,
      threshold: preview.threshold,
      surviving: preview.stats.survivingCount,
      summarized: preview.stats.summarizedCount,
      survivalRate: markers.length > 0
        ? (preview.stats.survivingCount / markers.length * 100).toFixed(1) + '%'
        : 'N/A'
    });
  }

  return analysis;
}

/**
 * Get recommended weight for content based on importance level
 *
 * @param {string} importance - Importance level description
 * @returns {number} Recommended weight
 */
export function getRecommendedWeight(importance) {
  const importanceLevels = {
    'always_keep': 1.00,
    'critical': 0.90,
    'very_important': 0.80,
    'important': 0.70,
    'useful': 0.50,
    'nice_to_have': 0.30,
    'minor': 0.15
  };

  const normalized = importance.toLowerCase().replace(/\s+/g, '_');
  return importanceLevels[normalized] || 0.50;
}

/**
 * Explain decay calculation for a specific marker and settings
 * Useful for debugging and user understanding
 *
 * @param {number} weight - Marker weight
 * @param {object} settings - Compression settings
 * @returns {object} Detailed explanation of the calculation
 */
export function explainDecayCalculation(weight, settings) {
  const {
    compressionRatio = 10,
    sessionDistance = 0,
    aggressiveness = null
  } = settings;

  const normalizedWeight = validateWeight(weight);
  const level = getAggressivenessLevel(compressionRatio, aggressiveness);
  const compressionBase = COMPRESSION_BASES[level];
  const ratioPenalty = Math.min(compressionRatio, 100) / 100;
  const normalizedDistance = Math.min(sessionDistance, MAX_SESSION_DISTANCE);
  const distanceFactor = normalizedDistance / MAX_SESSION_DISTANCE;
  const threshold = calculateSurvivalThreshold(compressionRatio, sessionDistance, aggressiveness);
  const survives = shouldKeepitSurvive(weight, sessionDistance, compressionRatio, aggressiveness);

  return {
    input: {
      weight: normalizedWeight,
      compressionRatio,
      sessionDistance,
      aggressiveness: aggressiveness || 'auto'
    },
    calculation: {
      aggressivenessLevel: level,
      compressionBase,
      ratioPenalty: ratioPenalty.toFixed(3),
      distanceFactor: distanceFactor.toFixed(3),
      formula: `${compressionBase} + (${ratioPenalty.toFixed(3)} * ${distanceFactor.toFixed(3)})`,
      threshold: threshold.toFixed(3)
    },
    result: {
      survives,
      isPinned: isPinned(normalizedWeight),
      margin: (normalizedWeight - threshold).toFixed(3),
      reason: isPinned(normalizedWeight)
        ? 'Pinned content (weight 1.00) always survives'
        : survives
          ? `Weight ${normalizedWeight.toFixed(2)} >= threshold ${threshold.toFixed(3)}`
          : `Weight ${normalizedWeight.toFixed(2)} < threshold ${threshold.toFixed(3)}`
    }
  };
}

// Export constants for testing and configuration
export { COMPRESSION_BASES, MAX_SESSION_DISTANCE };
