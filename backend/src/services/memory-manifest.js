import fs from 'fs-extra';
import lockfile from 'proper-lockfile';
import {
  getManifestPath,
  getProjectDir,
  ensureDirectoryStructure
} from './memory-storage.js';
import { migrateManifest, CURRENT_SCHEMA_VERSION } from './memory-migration.js';

// Default manifest schema
const MANIFEST_SCHEMA = {
  version: "1.0.0",
  projectId: null,
  originalPath: null,
  displayName: null,
  createdAt: null,
  lastModified: null,
  sessions: {},
  compositions: {},
  settings: {
    defaultCompressionPreset: "standard",
    autoRegisterNewSessions: false,
    keepitDecayEnabled: true
  }
};

// Lock options for file operations
const LOCK_OPTIONS = {
  stale: 10000, // Consider lock stale after 10 seconds
  retries: {
    retries: 5,
    minTimeout: 100,
    maxTimeout: 1000,
    factor: 2
  }
};

/**
 * Validate a manifest object against the schema
 * Returns { valid: boolean, errors: string[] }
 */
export function validateManifest(manifest) {
  const errors = [];

  // Required fields
  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push('version must be a non-empty string');
  }

  if (!manifest.projectId || typeof manifest.projectId !== 'string') {
    errors.push('projectId must be a non-empty string');
  }

  // Optional but typed fields
  if (manifest.originalPath !== null && typeof manifest.originalPath !== 'string') {
    errors.push('originalPath must be a string or null');
  }

  if (manifest.displayName !== null && typeof manifest.displayName !== 'string') {
    errors.push('displayName must be a string or null');
  }

  if (manifest.createdAt !== null && typeof manifest.createdAt !== 'string') {
    errors.push('createdAt must be an ISO date string or null');
  }

  if (manifest.lastModified !== null && typeof manifest.lastModified !== 'string') {
    errors.push('lastModified must be an ISO date string or null');
  }

  // Sessions validation
  if (typeof manifest.sessions !== 'object' || Array.isArray(manifest.sessions)) {
    errors.push('sessions must be an object');
  } else {
    for (const [sessionId, session] of Object.entries(manifest.sessions)) {
      const sessionErrors = validateSessionEntry(sessionId, session);
      errors.push(...sessionErrors.map(e => `sessions.${sessionId}: ${e}`));
    }
  }

  // Compositions validation
  if (typeof manifest.compositions !== 'object' || Array.isArray(manifest.compositions)) {
    errors.push('compositions must be an object');
  }

  // Settings validation
  if (manifest.settings) {
    const validPresets = ['light', 'standard', 'aggressive', 'custom'];
    if (manifest.settings.defaultCompressionPreset !== undefined &&
        !validPresets.includes(manifest.settings.defaultCompressionPreset)) {
      errors.push(`settings.defaultCompressionPreset must be one of: ${validPresets.join(', ')}`);
    }

    if (manifest.settings.autoRegisterNewSessions !== undefined &&
        typeof manifest.settings.autoRegisterNewSessions !== 'boolean') {
      errors.push('settings.autoRegisterNewSessions must be a boolean');
    }

    if (manifest.settings.keepitDecayEnabled !== undefined &&
        typeof manifest.settings.keepitDecayEnabled !== 'boolean') {
      errors.push('settings.keepitDecayEnabled must be a boolean');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate a session entry within the manifest
 */
function validateSessionEntry(sessionId, session) {
  const errors = [];

  if (!session.sessionId || session.sessionId !== sessionId) {
    errors.push('sessionId must match the key');
  }

  if (!session.originalFile || typeof session.originalFile !== 'string') {
    errors.push('originalFile must be a non-empty string');
  }

  if (typeof session.originalTokens !== 'number' || session.originalTokens < 0) {
    errors.push('originalTokens must be a non-negative number');
  }

  if (typeof session.originalMessages !== 'number' || session.originalMessages < 0) {
    errors.push('originalMessages must be a non-negative number');
  }

  if (session.registeredAt && typeof session.registeredAt !== 'string') {
    errors.push('registeredAt must be an ISO date string');
  }

  if (session.lastAccessed && typeof session.lastAccessed !== 'string') {
    errors.push('lastAccessed must be an ISO date string');
  }

  if (!Array.isArray(session.keepitMarkers)) {
    errors.push('keepitMarkers must be an array');
  }

  if (!Array.isArray(session.compressions)) {
    errors.push('compressions must be an array');
  }

  return errors;
}

/**
 * Create a new manifest with default values
 */
export function createManifest(projectId, options = {}) {
  const now = new Date().toISOString();

  return {
    ...structuredClone(MANIFEST_SCHEMA),
    version: CURRENT_SCHEMA_VERSION,
    projectId,
    originalPath: options.originalPath || null,
    displayName: options.displayName || extractDisplayName(projectId),
    createdAt: now,
    lastModified: now,
    sessions: {},
    compositions: {},
    settings: {
      defaultCompressionPreset: options.compressionPreset || "standard",
      autoRegisterNewSessions: options.autoRegister || false,
      keepitDecayEnabled: options.keepitDecay !== false
    }
  };
}

/**
 * Extract a display name from a project ID
 * Decodes encoded path format: -home-user-project -> /home/user/project
 */
function extractDisplayName(projectId) {
  if (!projectId) return 'Unknown Project';

  // Handle encoded project paths
  if (projectId.startsWith('-')) {
    const decoded = '/' + projectId.slice(1).replace(/-/g, '/');
    const parts = decoded.split('/');
    return parts[parts.length - 1] || decoded;
  }

  return projectId;
}

/**
 * Load a manifest for a project
 * Creates a new manifest if none exists
 * Applies migrations if needed
 */
export async function loadManifest(projectId, options = {}) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId: must be a non-empty string');
  }

  // Ensure project directory structure exists
  await ensureDirectoryStructure(projectId);

  const manifestPath = getManifestPath(projectId);

  if (await fs.pathExists(manifestPath)) {
    return await loadExistingManifest(projectId, manifestPath, options);
  }

  // Create new manifest
  const manifest = createManifest(projectId, options);
  await saveManifest(projectId, manifest);
  return manifest;
}

/**
 * Load an existing manifest file with locking
 */
async function loadExistingManifest(projectId, manifestPath, options = {}) {
  let release = null;

  try {
    // Acquire lock for reading (to ensure we don't read during a write)
    release = await lockfile.lock(manifestPath, LOCK_OPTIONS);

    const content = await fs.readFile(manifestPath, 'utf-8');
    let manifest;

    try {
      manifest = JSON.parse(content);
    } catch (error) {
      throw new Error(`Manifest file is corrupted (invalid JSON): ${error.message}`);
    }

    // Apply migrations if needed
    const migratedManifest = await migrateManifest(manifest);

    // If migration occurred, save the updated manifest
    if (migratedManifest.version !== manifest.version) {
      // Release current lock before saving (saveManifest will acquire its own lock)
      await release();
      release = null;
      await saveManifest(projectId, migratedManifest);
    }

    return migratedManifest;
  } catch (error) {
    if (error.code === 'ELOCKED') {
      throw new Error(`Manifest for project ${projectId} is locked by another process. Please try again.`);
    }
    throw error;
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * Save a manifest for a project with validation and locking
 */
export async function saveManifest(projectId, manifest) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId: must be a non-empty string');
  }

  // Validate manifest before saving
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid manifest: ${validation.errors.join('; ')}`);
  }

  // Ensure directory exists
  await ensureDirectoryStructure(projectId);

  const manifestPath = getManifestPath(projectId);
  const tempPath = manifestPath + '.tmp';
  const projectDir = getProjectDir(projectId);

  let release = null;

  try {
    // For new manifests, lock the parent directory instead
    const lockTarget = await fs.pathExists(manifestPath) ? manifestPath : projectDir;

    // Acquire lock
    release = await lockfile.lock(lockTarget, LOCK_OPTIONS);

    // Update lastModified
    const updatedManifest = {
      ...manifest,
      lastModified: new Date().toISOString()
    };

    // Write to temp file first
    await fs.writeFile(tempPath, JSON.stringify(updatedManifest, null, 2), 'utf-8');

    // Atomic rename
    await fs.rename(tempPath, manifestPath);

    return updatedManifest;
  } catch (error) {
    // Clean up temp file if it exists
    await fs.remove(tempPath).catch(() => {});

    if (error.code === 'ELOCKED') {
      throw new Error(`Cannot save manifest for project ${projectId}: locked by another process`);
    }
    throw new Error(`Failed to save manifest: ${error.message}`);
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * Update specific fields in a manifest
 * Merges updates with existing manifest
 */
export async function updateManifest(projectId, updates) {
  const manifest = await loadManifest(projectId);

  // Deep merge updates
  const updatedManifest = deepMergeManifest(manifest, updates);

  await saveManifest(projectId, updatedManifest);
  return updatedManifest;
}

/**
 * Delete a manifest and optionally its project directory
 */
export async function deleteManifest(projectId, options = { deleteProjectDir: false }) {
  const manifestPath = getManifestPath(projectId);

  if (!await fs.pathExists(manifestPath)) {
    throw new Error(`Manifest for project ${projectId} not found`);
  }

  let release = null;

  try {
    release = await lockfile.lock(manifestPath, LOCK_OPTIONS);

    if (options.deleteProjectDir) {
      const projectDir = getProjectDir(projectId);
      await release();
      release = null;
      await fs.remove(projectDir);
    } else {
      await fs.remove(manifestPath);
    }

    return { success: true, projectId };
  } catch (error) {
    if (error.code === 'ELOCKED') {
      throw new Error(`Cannot delete manifest for project ${projectId}: locked by another process`);
    }
    throw error;
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * Check if a manifest exists for a project
 */
export async function manifestExists(projectId) {
  return fs.pathExists(getManifestPath(projectId));
}

/**
 * Get session from manifest
 */
export async function getSession(projectId, sessionId) {
  const manifest = await loadManifest(projectId);
  return manifest.sessions[sessionId] || null;
}

/**
 * Add or update a session in the manifest
 */
export async function setSession(projectId, sessionId, sessionEntry) {
  const manifest = await loadManifest(projectId);
  manifest.sessions[sessionId] = {
    ...sessionEntry,
    sessionId // Ensure sessionId is always set
  };
  await saveManifest(projectId, manifest);
  return manifest.sessions[sessionId];
}

/**
 * Remove a session from the manifest
 */
export async function removeSession(projectId, sessionId) {
  const manifest = await loadManifest(projectId);

  if (!manifest.sessions[sessionId]) {
    throw new Error(`Session ${sessionId} not found in project ${projectId}`);
  }

  const removedSession = manifest.sessions[sessionId];
  delete manifest.sessions[sessionId];

  await saveManifest(projectId, manifest);
  return removedSession;
}

/**
 * List all sessions in a manifest
 */
export async function listSessions(projectId) {
  const manifest = await loadManifest(projectId);
  return Object.values(manifest.sessions);
}

/**
 * Update a session's lastAccessed timestamp
 */
export async function touchSession(projectId, sessionId) {
  const manifest = await loadManifest(projectId);

  if (!manifest.sessions[sessionId]) {
    throw new Error(`Session ${sessionId} not found in project ${projectId}`);
  }

  manifest.sessions[sessionId].lastAccessed = new Date().toISOString();
  await saveManifest(projectId, manifest);
  return manifest.sessions[sessionId];
}

/**
 * Get manifest settings
 */
export async function getSettings(projectId) {
  const manifest = await loadManifest(projectId);
  return manifest.settings;
}

/**
 * Update manifest settings
 */
export async function updateSettings(projectId, settings) {
  const manifest = await loadManifest(projectId);
  manifest.settings = {
    ...manifest.settings,
    ...settings
  };
  await saveManifest(projectId, manifest);
  return manifest.settings;
}

/**
 * Deep merge helper for manifest updates
 */
function deepMergeManifest(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] === undefined) continue;

    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
        result[key] = deepMergeManifest(result[key], source[key]);
      } else {
        result[key] = { ...source[key] };
      }
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Get manifest schema for reference
 */
export function getManifestSchema() {
  return structuredClone(MANIFEST_SCHEMA);
}
