/**
 * Configuration and presets for memory compression versions
 * Contains constants, default settings, and preset information
 */

import {
  TIER_PRESETS,
  COMPACTION_RATIOS
} from './summarizer.js';

// Re-export for use by routes
export { TIER_PRESETS, COMPACTION_RATIOS };

// ============================================
// Default Settings
// ============================================

/**
 * Default compression settings
 */
export const DEFAULT_COMPRESSION_SETTINGS = {
  mode: 'tiered',
  tierPreset: 'standard',
  model: 'opus',
  skipFirstMessages: 0,
  keepitMode: 'ignore',
  sessionDistance: null
};

/**
 * Default uniform mode settings
 */
export const DEFAULT_UNIFORM_SETTINGS = {
  compactionRatio: 10,
  aggressiveness: 'moderate'
};

/**
 * Valid values for compression settings
 */
export const VALID_MODES = ['uniform', 'tiered'];
export const VALID_AGGRESSIVENESS = ['minimal', 'moderate', 'aggressive'];
export const VALID_TIER_PRESETS = ['gentle', 'standard', 'aggressive'];
export const VALID_MODELS = ['opus', 'sonnet', 'haiku'];
export const VALID_KEEPIT_MODES = ['decay', 'preserve-all', 'ignore'];

/**
 * Compression level mapping
 */
export const COMPRESSION_LEVELS = {
  light: 1,
  moderate: 2,
  aggressive: 3
};

/**
 * Reverse mapping: level number to name
 */
export const COMPRESSION_LEVEL_NAMES = {
  1: 'light',
  2: 'moderate',
  3: 'aggressive'
};

// ============================================
// Preset Information for UI
// ============================================

/**
 * Get presets info for UI display
 */
export function getPresetsInfo() {
  return {
    tierPresets: {
      gentle: {
        description: 'Preserves more detail, lighter compression',
        tiers: TIER_PRESETS.gentle
      },
      standard: {
        description: 'Balanced compression for most use cases',
        tiers: TIER_PRESETS.standard
      },
      aggressive: {
        description: 'Maximum compression, essential info only',
        tiers: TIER_PRESETS.aggressive
      }
    },
    compactionRatios: COMPACTION_RATIOS,
    aggressivenessLevels: VALID_AGGRESSIVENESS,
    models: VALID_MODELS
  };
}

// ============================================
// Compression Settings Functions
// ============================================

/**
 * Get compression settings with defaults applied
 * @param {Object} settings - User-provided settings
 * @returns {Object} Settings with defaults applied
 */
export function getCompressionSettings(settings = {}) {
  const base = { ...DEFAULT_COMPRESSION_SETTINGS };

  if (settings.mode === 'uniform') {
    return {
      ...base,
      ...settings,
      compactionRatio: settings.compactionRatio || DEFAULT_UNIFORM_SETTINGS.compactionRatio,
      aggressiveness: settings.aggressiveness || DEFAULT_UNIFORM_SETTINGS.aggressiveness
    };
  }

  return {
    ...base,
    ...settings
  };
}
