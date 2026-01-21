/**
 * Validation functions for memory compression versions
 */

import {
  VALID_MODES,
  VALID_AGGRESSIVENESS,
  VALID_TIER_PRESETS,
  VALID_MODELS,
  VALID_KEEPIT_MODES
} from './memory-versions-config.js';

// ============================================
// Settings Validation
// ============================================

/**
 * Validate compression settings
 * Returns { valid: boolean, errors: string[] }
 */
export function validateCompressionSettings(settings) {
  const errors = [];

  // Mode is required
  if (!settings.mode || !VALID_MODES.includes(settings.mode)) {
    errors.push(`mode must be one of: ${VALID_MODES.join(', ')}`);
  }

  // Validate uniform mode settings
  if (settings.mode === 'uniform') {
    if (settings.compactionRatio !== undefined) {
      if (typeof settings.compactionRatio !== 'number' ||
          settings.compactionRatio < 2 ||
          settings.compactionRatio > 50) {
        errors.push('compactionRatio must be a number between 2 and 50');
      }
    }
    if (settings.aggressiveness !== undefined) {
      if (!VALID_AGGRESSIVENESS.includes(settings.aggressiveness)) {
        errors.push(`aggressiveness must be one of: ${VALID_AGGRESSIVENESS.join(', ')}`);
      }
    }
  }

  // Validate tiered mode settings
  if (settings.mode === 'tiered') {
    if (settings.tierPreset !== undefined && settings.tierPreset !== null) {
      if (!VALID_TIER_PRESETS.includes(settings.tierPreset)) {
        errors.push(`tierPreset must be one of: ${VALID_TIER_PRESETS.join(', ')}`);
      }
    }

    // Custom tiers validation
    if (settings.customTiers) {
      const tierErrors = validateCustomTiers(settings.customTiers);
      errors.push(...tierErrors);
    }
  }

  // Validate model
  if (settings.model !== undefined) {
    if (!VALID_MODELS.includes(settings.model)) {
      errors.push(`model must be one of: ${VALID_MODELS.join(', ')}`);
    }
  }

  // Validate skipFirstMessages
  if (settings.skipFirstMessages !== undefined) {
    if (typeof settings.skipFirstMessages !== 'number' || settings.skipFirstMessages < 0) {
      errors.push('skipFirstMessages must be a non-negative number');
    }
  }

  // Validate keepitMode (placeholder for Phase 3)
  if (settings.keepitMode !== undefined) {
    if (!VALID_KEEPIT_MODES.includes(settings.keepitMode)) {
      errors.push(`keepitMode must be one of: ${VALID_KEEPIT_MODES.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate custom tier configuration
 * @param {Array} customTiers - Array of tier configurations
 * @returns {Array} Array of error messages
 */
export function validateCustomTiers(customTiers) {
  const errors = [];

  if (!Array.isArray(customTiers)) {
    return ['customTiers must be an array'];
  }

  for (let i = 0; i < customTiers.length; i++) {
    const tier = customTiers[i];

    if (typeof tier.endPercent !== 'number' ||
        tier.endPercent < 1 ||
        tier.endPercent > 100) {
      errors.push(`customTiers[${i}].endPercent must be between 1 and 100`);
    }

    if (typeof tier.compactionRatio !== 'number' ||
        tier.compactionRatio < 2 ||
        tier.compactionRatio > 50) {
      errors.push(`customTiers[${i}].compactionRatio must be between 2 and 50`);
    }

    if (tier.aggressiveness &&
        !VALID_AGGRESSIVENESS.includes(tier.aggressiveness)) {
      errors.push(`customTiers[${i}].aggressiveness must be ${VALID_AGGRESSIVENESS.join(', ')}`);
    }
  }

  return errors;
}

// ============================================
// Input Validation Helpers
// ============================================

/**
 * Validate that a session exists and has required data
 * @param {Object} session - Session object
 * @param {string} sessionId - Session ID for error messages
 * @param {string} projectId - Project ID for error messages
 * @throws {Error} If session is invalid
 */
export function validateSessionExists(session, sessionId, projectId) {
  if (!session) {
    const error = new Error(`Session ${sessionId} not found in project ${projectId}`);
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }
}

/**
 * Validate that a version exists
 * @param {Object} compression - Compression record
 * @param {string} versionId - Version ID for error messages
 * @param {string} sessionId - Session ID for error messages
 * @throws {Error} If version is not found
 */
export function validateVersionExists(compression, versionId, sessionId) {
  if (!compression) {
    const error = new Error(`Version ${versionId} not found for session ${sessionId}`);
    error.code = 'VERSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }
}

/**
 * Validate minimum message count for compression
 * @param {number} messageCount - Number of messages
 * @param {number} minimum - Minimum required (default: 2)
 * @throws {Error} If insufficient messages
 */
export function validateMinimumMessages(messageCount, minimum = 2) {
  if (messageCount < minimum) {
    const error = new Error(`Must have at least ${minimum} messages to compress`);
    error.code = 'INSUFFICIENT_MESSAGES';
    error.status = 400;
    throw error;
  }
}
