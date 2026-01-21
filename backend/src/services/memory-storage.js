import fs from 'fs-extra';
import path from 'path';
import os from 'os';

// Memory system root directory
const MEMORY_ROOT = path.join(os.homedir(), '.claude-memory');

// Default global configuration
const DEFAULT_CONFIG = {
  version: "1.0.0",
  createdAt: null, // Set on first creation
  storage: {
    maxCacheSize: "1GB",
    compressionRetention: "all"
  },
  defaults: {
    compressionPreset: "standard",
    keepitDecayEnabled: true,
    autoRegisterSessions: false,
    model: "opus"
  },
  keepitDecay: {
    compressionBase: { light: 0.1, moderate: 0.3, aggressive: 0.5 },
    maxSessionDistance: 10,
    pinnedWeight: 1.0
  }
};

/**
 * Get the memory system root directory path
 */
export function getMemoryRoot() {
  return MEMORY_ROOT;
}

/**
 * Get the path to global config file
 */
export function getConfigPath() {
  return path.join(MEMORY_ROOT, 'config.json');
}

/**
 * Get the projects directory path
 */
export function getProjectsDir() {
  return path.join(MEMORY_ROOT, 'projects');
}

/**
 * Get the cache directory path
 */
export function getCacheDir() {
  return path.join(MEMORY_ROOT, 'cache');
}

/**
 * Get the directory path for a specific project
 */
export function getProjectDir(projectId) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId: must be a non-empty string');
  }
  return path.join(getProjectsDir(), projectId);
}

/**
 * Get the originals directory path for a project
 */
export function getOriginalsDir(projectId) {
  return path.join(getProjectDir(projectId), 'originals');
}

/**
 * Get the summaries directory path for a project
 */
export function getSummariesDir(projectId) {
  return path.join(getProjectDir(projectId), 'summaries');
}

/**
 * Get the composed directory path for a project
 */
export function getComposedDir(projectId) {
  return path.join(getProjectDir(projectId), 'composed');
}

/**
 * Get the manifest file path for a project
 */
export function getManifestPath(projectId) {
  return path.join(getProjectDir(projectId), 'manifest.json');
}

/**
 * Ensure the memory root directory exists
 */
export async function ensureMemoryRoot() {
  try {
    await fs.ensureDir(MEMORY_ROOT);
    return MEMORY_ROOT;
  } catch (error) {
    if (error.code === 'EACCES') {
      throw new Error(`Permission denied creating memory directory at ${MEMORY_ROOT}. Check filesystem permissions.`);
    }
    throw new Error(`Failed to create memory root directory: ${error.message}`);
  }
}

/**
 * Ensure the cache directory exists
 */
export async function ensureCacheDir() {
  try {
    await fs.ensureDir(getCacheDir());
    return getCacheDir();
  } catch (error) {
    if (error.code === 'EACCES') {
      throw new Error(`Permission denied creating cache directory. Check filesystem permissions.`);
    }
    throw new Error(`Failed to create cache directory: ${error.message}`);
  }
}

/**
 * Ensure all required directories exist for a project
 * Creates:
 *   - ~/.claude-memory/
 *   - ~/.claude-memory/projects/{projectId}/
 *   - ~/.claude-memory/projects/{projectId}/originals/
 *   - ~/.claude-memory/projects/{projectId}/summaries/
 *   - ~/.claude-memory/projects/{projectId}/composed/
 *   - ~/.claude-memory/cache/
 *
 * This function is idempotent - safe to call multiple times
 */
export async function ensureDirectoryStructure(projectId) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId: must be a non-empty string');
  }

  try {
    // Create all directories in parallel
    await Promise.all([
      fs.ensureDir(MEMORY_ROOT),
      fs.ensureDir(getProjectsDir()),
      fs.ensureDir(getProjectDir(projectId)),
      fs.ensureDir(getOriginalsDir(projectId)),
      fs.ensureDir(getSummariesDir(projectId)),
      fs.ensureDir(getComposedDir(projectId)),
      fs.ensureDir(getCacheDir())
    ]);

    return {
      root: MEMORY_ROOT,
      project: getProjectDir(projectId),
      originals: getOriginalsDir(projectId),
      summaries: getSummariesDir(projectId),
      composed: getComposedDir(projectId),
      cache: getCacheDir()
    };
  } catch (error) {
    if (error.code === 'EACCES') {
      throw new Error(`Permission denied creating directories for project ${projectId}. Check filesystem permissions.`);
    }
    throw new Error(`Failed to create directory structure for project ${projectId}: ${error.message}`);
  }
}

/**
 * Check if the memory system has been initialized (root directory exists)
 */
export async function isMemoryInitialized() {
  return fs.pathExists(MEMORY_ROOT);
}

/**
 * Check if a project exists in the memory system
 */
export async function projectExists(projectId) {
  return fs.pathExists(getProjectDir(projectId));
}

// ============================================
// Configuration Management (Task 1.2)
// ============================================

/**
 * Validate configuration values
 * Returns an object with { valid: boolean, errors: string[] }
 */
export function validateConfig(config) {
  const errors = [];

  // Version validation
  if (!config.version || typeof config.version !== 'string') {
    errors.push('version must be a non-empty string');
  }

  // Storage validation
  if (config.storage) {
    if (config.storage.maxCacheSize !== undefined && typeof config.storage.maxCacheSize !== 'string') {
      errors.push('storage.maxCacheSize must be a string (e.g., "1GB")');
    }
    if (config.storage.compressionRetention !== undefined) {
      const validRetention = ['all', 'latest', 'none'];
      if (!validRetention.includes(config.storage.compressionRetention)) {
        errors.push(`storage.compressionRetention must be one of: ${validRetention.join(', ')}`);
      }
    }
  }

  // Defaults validation
  if (config.defaults) {
    const validPresets = ['light', 'standard', 'aggressive', 'custom'];
    if (config.defaults.compressionPreset !== undefined && !validPresets.includes(config.defaults.compressionPreset)) {
      errors.push(`defaults.compressionPreset must be one of: ${validPresets.join(', ')}`);
    }
    if (typeof config.defaults.keepitDecayEnabled !== 'boolean' && config.defaults.keepitDecayEnabled !== undefined) {
      errors.push('defaults.keepitDecayEnabled must be a boolean');
    }
    if (typeof config.defaults.autoRegisterSessions !== 'boolean' && config.defaults.autoRegisterSessions !== undefined) {
      errors.push('defaults.autoRegisterSessions must be a boolean');
    }
    const validModels = ['opus', 'sonnet', 'haiku'];
    if (config.defaults.model !== undefined && !validModels.includes(config.defaults.model)) {
      errors.push(`defaults.model must be one of: ${validModels.join(', ')}`);
    }
  }

  // KeepIt Decay validation
  if (config.keepitDecay) {
    if (config.keepitDecay.maxSessionDistance !== undefined) {
      const maxDist = config.keepitDecay.maxSessionDistance;
      if (typeof maxDist !== 'number' || maxDist < 1 || maxDist > 100) {
        errors.push('keepitDecay.maxSessionDistance must be a number between 1 and 100');
      }
    }
    if (config.keepitDecay.pinnedWeight !== undefined) {
      const weight = config.keepitDecay.pinnedWeight;
      if (typeof weight !== 'number' || weight < 0 || weight > 10) {
        errors.push('keepitDecay.pinnedWeight must be a number between 0 and 10');
      }
    }
    if (config.keepitDecay.compressionBase !== undefined) {
      const base = config.keepitDecay.compressionBase;
      if (typeof base !== 'object') {
        errors.push('keepitDecay.compressionBase must be an object');
      } else {
        for (const [key, value] of Object.entries(base)) {
          if (typeof value !== 'number' || value < 0 || value > 1) {
            errors.push(`keepitDecay.compressionBase.${key} must be a number between 0 and 1`);
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Load the global configuration
 * Creates a new config with defaults if none exists
 */
export async function loadGlobalConfig() {
  await ensureMemoryRoot();
  const configPath = getConfigPath();

  if (await fs.pathExists(configPath)) {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);

      // Merge with defaults to ensure all fields exist
      const merged = deepMerge(structuredClone(DEFAULT_CONFIG), config);
      return merged;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Config file is corrupted (invalid JSON): ${error.message}`);
      }
      throw new Error(`Failed to load config: ${error.message}`);
    }
  }

  // Create new config with defaults
  const newConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    createdAt: new Date().toISOString()
  };

  await saveGlobalConfig(newConfig);
  return newConfig;
}

/**
 * Save the global configuration
 * Validates before saving
 */
export async function saveGlobalConfig(config) {
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid configuration: ${validation.errors.join('; ')}`);
  }

  await ensureMemoryRoot();
  const configPath = getConfigPath();

  // Write atomically using temp file
  const tempPath = configPath + '.tmp';
  try {
    await fs.writeFile(tempPath, JSON.stringify(config, null, 2), 'utf-8');
    await fs.rename(tempPath, configPath);
  } catch (error) {
    // Clean up temp file if rename failed
    await fs.remove(tempPath).catch(() => {});
    throw new Error(`Failed to save config: ${error.message}`);
  }
}

/**
 * Get a specific configuration value by path
 * Supports dot notation (e.g., "defaults.model", "keepitDecay.maxSessionDistance")
 */
export async function getConfigValue(path) {
  const config = await loadGlobalConfig();
  return getNestedValue(config, path);
}

/**
 * Set a specific configuration value by path
 * Supports dot notation (e.g., "defaults.model", "keepitDecay.maxSessionDistance")
 */
export async function setConfigValue(path, value) {
  const config = await loadGlobalConfig();
  setNestedValue(config, path, value);
  await saveGlobalConfig(config);
  return config;
}

/**
 * Reset configuration to defaults
 */
export async function resetConfig() {
  const newConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    createdAt: new Date().toISOString()
  };
  await saveGlobalConfig(newConfig);
  return newConfig;
}

/**
 * Get the default configuration (for reference)
 */
export function getDefaultConfig() {
  return structuredClone(DEFAULT_CONFIG);
}

// ============================================
// Helper Functions
// ============================================

/**
 * Deep merge two objects
 * Source values override target values
 */
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj, path) {
  if (!path) return obj;
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === undefined || current === null) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}
