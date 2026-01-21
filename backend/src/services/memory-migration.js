import fs from 'fs-extra';
import path from 'path';
import { getProjectDir, getManifestPath } from './memory-storage.js';

// Current schema version
export const CURRENT_SCHEMA_VERSION = '1.0.0';

/**
 * Migration definitions for each version
 * Each migration contains:
 *   - description: Human-readable description of changes
 *   - migrate: Async function that transforms the manifest
 *
 * Migrations are applied in semver order when loading old manifests
 */
const MIGRATIONS = {
  '1.0.0': {
    description: 'Base version - no migration needed',
    migrate: async (manifest) => manifest
  }
  // Future migrations will be added here:
  // '1.1.0': {
  //   description: 'Add new field X to sessions',
  //   migrate: async (manifest) => {
  //     for (const session of Object.values(manifest.sessions)) {
  //       session.newFieldX = session.newFieldX ?? 'default';
  //     }
  //     return manifest;
  //   }
  // }
};

/**
 * Compare two semver version strings
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function semverCompare(a, b) {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;

    if (partA < partB) return -1;
    if (partA > partB) return 1;
  }

  return 0;
}

/**
 * Get all version numbers in sorted order
 */
export function getSortedVersions() {
  return Object.keys(MIGRATIONS).sort(semverCompare);
}

/**
 * Check if a migration is needed for a manifest
 */
export function needsMigration(manifest) {
  const currentVersion = manifest.version || '1.0.0';
  return semverCompare(currentVersion, CURRENT_SCHEMA_VERSION) < 0;
}

/**
 * Create a backup of the manifest before migration
 */
async function createMigrationBackup(projectId, manifest) {
  const projectDir = getProjectDir(projectId);
  const backupDir = path.join(projectDir, '.migration-backups');
  await fs.ensureDir(backupDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `manifest-${manifest.version}-${timestamp}.json`);

  await fs.writeFile(backupPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return backupPath;
}

/**
 * Migrate a manifest to the current schema version
 * Applies all migrations between the current version and CURRENT_SCHEMA_VERSION
 *
 * @param {object} manifest - The manifest object to migrate
 * @param {object} options - Migration options
 * @param {boolean} options.createBackup - Whether to create a backup before migration (default: true)
 * @param {string} options.projectId - Project ID for backup location (required if createBackup is true)
 * @returns {object} The migrated manifest
 */
export async function migrateManifest(manifest, options = {}) {
  const { createBackup = true, projectId = manifest.projectId } = options;

  const currentVersion = manifest.version || '1.0.0';

  // Check if migration is needed
  if (semverCompare(currentVersion, CURRENT_SCHEMA_VERSION) >= 0) {
    // Already at current or newer version
    return manifest;
  }

  // Create backup before migration if requested
  let backupPath = null;
  if (createBackup && projectId) {
    try {
      backupPath = await createMigrationBackup(projectId, manifest);
    } catch (error) {
      // Log warning but continue with migration
      console.warn(`Failed to create migration backup: ${error.message}`);
    }
  }

  // Get sorted list of all versions
  const versions = getSortedVersions();

  // Clone manifest to avoid mutation
  let migrated = structuredClone(manifest);

  // Apply each migration in order
  for (const version of versions) {
    // Skip versions at or below current version
    if (semverCompare(version, currentVersion) <= 0) {
      continue;
    }

    // Skip versions above target version
    if (semverCompare(version, CURRENT_SCHEMA_VERSION) > 0) {
      continue;
    }

    const migration = MIGRATIONS[version];
    if (!migration || !migration.migrate) {
      continue;
    }

    try {
      migrated = await migration.migrate(migrated);
      migrated.version = version;

      // Track migration history
      if (!migrated._migrationHistory) {
        migrated._migrationHistory = [];
      }
      migrated._migrationHistory.push({
        from: currentVersion,
        to: version,
        timestamp: new Date().toISOString(),
        description: migration.description
      });
    } catch (error) {
      // Restore from backup if available
      if (backupPath && await fs.pathExists(backupPath)) {
        console.error(`Migration to ${version} failed. Backup available at: ${backupPath}`);
      }
      throw new Error(`Migration to version ${version} failed: ${error.message}`);
    }
  }

  // Ensure final version is set
  migrated.version = CURRENT_SCHEMA_VERSION;

  return migrated;
}

/**
 * List all available migrations
 */
export function listMigrations() {
  const versions = getSortedVersions();
  return versions.map(version => ({
    version,
    description: MIGRATIONS[version]?.description || 'No description'
  }));
}

/**
 * Get migration info for a specific version
 */
export function getMigrationInfo(version) {
  const migration = MIGRATIONS[version];
  if (!migration) {
    return null;
  }
  return {
    version,
    description: migration.description,
    hasHandler: typeof migration.migrate === 'function'
  };
}

/**
 * Register a new migration
 * This is useful for plugins or dynamic migration registration
 *
 * @param {string} version - The version this migration upgrades TO
 * @param {object} migration - The migration definition
 * @param {string} migration.description - Description of the migration
 * @param {function} migration.migrate - Async function that transforms the manifest
 */
export function registerMigration(version, migration) {
  if (!version || typeof version !== 'string') {
    throw new Error('Version must be a non-empty string');
  }

  if (!migration || typeof migration !== 'object') {
    throw new Error('Migration must be an object');
  }

  if (typeof migration.migrate !== 'function') {
    throw new Error('Migration must have a migrate function');
  }

  MIGRATIONS[version] = migration;
}

/**
 * Validate manifest structure after migration
 * Returns warnings for any unexpected fields or missing required fields
 */
export function validateMigratedManifest(manifest) {
  const warnings = [];
  const errors = [];

  // Required fields
  const requiredFields = ['version', 'projectId', 'sessions', 'settings'];
  for (const field of requiredFields) {
    if (manifest[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check version format
  if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    warnings.push(`Version "${manifest.version}" does not follow semver format`);
  }

  // Check sessions structure
  if (manifest.sessions && typeof manifest.sessions === 'object') {
    for (const [sessionId, session] of Object.entries(manifest.sessions)) {
      if (!session.sessionId) {
        warnings.push(`Session ${sessionId} missing sessionId field`);
      }
      if (!session.originalFile) {
        warnings.push(`Session ${sessionId} missing originalFile field`);
      }
      if (typeof session.originalTokens !== 'number') {
        warnings.push(`Session ${sessionId} missing or invalid originalTokens field`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Get list of migration backups for a project
 */
export async function listMigrationBackups(projectId) {
  const backupDir = path.join(getProjectDir(projectId), '.migration-backups');

  if (!await fs.pathExists(backupDir)) {
    return [];
  }

  const files = await fs.readdir(backupDir);
  const backups = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(backupDir, file);
    const stats = await fs.stat(filePath);

    // Parse version from filename: manifest-1.0.0-2024-01-15T10-30-00-000Z.json
    const match = file.match(/manifest-(\d+\.\d+\.\d+)-(.+)\.json/);
    if (match) {
      backups.push({
        file,
        path: filePath,
        version: match[1],
        timestamp: match[2].replace(/-/g, ':').replace('T', 'T').replace('Z', 'Z'),
        size: stats.size,
        created: stats.birthtime
      });
    }
  }

  return backups.sort((a, b) => b.created - a.created);
}

/**
 * Restore a manifest from a migration backup
 */
export async function restoreFromBackup(projectId, backupFile) {
  const backupDir = path.join(getProjectDir(projectId), '.migration-backups');
  const backupPath = path.join(backupDir, backupFile);

  if (!await fs.pathExists(backupPath)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }

  const content = await fs.readFile(backupPath, 'utf-8');
  const manifest = JSON.parse(content);

  // Write to manifest location
  const manifestPath = getManifestPath(projectId);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return manifest;
}

/**
 * Clean up old migration backups (keep only recent N backups)
 */
export async function cleanupMigrationBackups(projectId, keepCount = 5) {
  const backups = await listMigrationBackups(projectId);

  if (backups.length <= keepCount) {
    return { deleted: 0, kept: backups.length };
  }

  const toDelete = backups.slice(keepCount);

  for (const backup of toDelete) {
    await fs.remove(backup.path);
  }

  return {
    deleted: toDelete.length,
    kept: keepCount
  };
}
