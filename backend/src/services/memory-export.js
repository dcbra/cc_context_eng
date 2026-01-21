/**
 * Memory System Export/Import Service
 *
 * Handles exporting and importing memory data as ZIP archives.
 *
 * Phase 5 - Task 5.5: Import/Export Memory Data
 */

import fs from 'fs-extra';
import path from 'path';
import archiver from 'archiver';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import {
  getProjectDir,
  getOriginalsDir,
  getSummariesDir,
  getComposedDir,
  getManifestPath,
  ensureDirectoryStructure,
  getCacheDir
} from './memory-storage.js';
import {
  loadManifest,
  saveManifest,
  manifestExists,
  validateManifest
} from './memory-manifest.js';
import { InvalidImportError, FileSystemError, ValidationError } from './memory-errors.js';
import { CURRENT_SCHEMA_VERSION } from './memory-migration.js';

// ============================================
// Export Functions
// ============================================

/**
 * Export a project's memory data as a ZIP archive
 *
 * @param {string} projectId - Project ID to export
 * @param {Object} options - Export options
 * @param {boolean} options.includeOriginals - Include original session files (default: false)
 * @param {boolean} options.includeSummaries - Include summary files (default: true)
 * @param {boolean} options.includeComposed - Include composition files (default: true)
 * @returns {Promise<Object>} Export result with stream and metadata
 */
export async function exportProject(projectId, options = {}) {
  const {
    includeOriginals = false,
    includeSummaries = true,
    includeComposed = true
  } = options;

  // Verify project exists
  if (!await manifestExists(projectId)) {
    throw new ValidationError(`Project not found: ${projectId}`);
  }

  const projectDir = getProjectDir(projectId);
  const manifest = await loadManifest(projectId);

  // Create archive
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  });

  // Track what's being exported
  const exportInfo = {
    projectId,
    displayName: manifest.displayName,
    exportedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    includes: {
      manifest: true,
      originals: includeOriginals,
      summaries: includeSummaries,
      composed: includeComposed
    },
    stats: {
      sessions: Object.keys(manifest.sessions).length,
      compressions: 0,
      compositions: Object.keys(manifest.compositions || {}).length,
      files: 0,
      estimatedSize: 0
    }
  };

  // Count compressions
  for (const session of Object.values(manifest.sessions)) {
    exportInfo.stats.compressions += (session.compressions || []).length;
  }

  // Add manifest.json (always included)
  const manifestPath = getManifestPath(projectId);
  if (await fs.pathExists(manifestPath)) {
    archive.file(manifestPath, { name: 'manifest.json' });
    exportInfo.stats.files++;
  }

  // Add export metadata
  const metadataContent = JSON.stringify(exportInfo, null, 2);
  archive.append(metadataContent, { name: 'export-metadata.json' });
  exportInfo.stats.files++;

  // Add originals directory
  if (includeOriginals) {
    const originalsDir = getOriginalsDir(projectId);
    if (await fs.pathExists(originalsDir)) {
      archive.directory(originalsDir, 'originals');
      exportInfo.stats.files += await countFiles(originalsDir);
    }
  }

  // Add summaries directory
  if (includeSummaries) {
    const summariesDir = getSummariesDir(projectId);
    if (await fs.pathExists(summariesDir)) {
      archive.directory(summariesDir, 'summaries');
      exportInfo.stats.files += await countFiles(summariesDir);
    }
  }

  // Add composed directory
  if (includeComposed) {
    const composedDir = getComposedDir(projectId);
    if (await fs.pathExists(composedDir)) {
      archive.directory(composedDir, 'composed');
      exportInfo.stats.files += await countFiles(composedDir);
    }
  }

  return {
    archive,
    metadata: exportInfo,
    filename: `memory-export-${projectId}-${Date.now()}.zip`
  };
}

/**
 * Export project to a file
 *
 * @param {string} projectId - Project ID
 * @param {string} outputPath - Output file path
 * @param {Object} options - Export options
 * @returns {Promise<Object>} Export result
 */
export async function exportProjectToFile(projectId, outputPath, options = {}) {
  const { archive, metadata, filename } = await exportProject(projectId, options);

  // Create output stream
  const output = createWriteStream(outputPath);

  // Track size
  let totalBytes = 0;
  archive.on('data', (chunk) => {
    totalBytes += chunk.length;
  });

  // Pipe archive to output
  archive.pipe(output);

  // Finalize archive
  await archive.finalize();

  // Wait for output to finish
  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
  });

  return {
    ...metadata,
    outputPath,
    size: totalBytes,
    sizeFormatted: formatBytes(totalBytes)
  };
}

// ============================================
// Import Functions
// ============================================

/**
 * Import memory data from a ZIP archive
 *
 * @param {string} projectId - Target project ID
 * @param {Buffer|string} zipSource - ZIP file buffer or path
 * @param {Object} options - Import options
 * @param {string} options.mode - Import mode: 'merge' or 'replace'
 * @returns {Promise<Object>} Import result
 */
export async function importProject(projectId, zipSource, options = {}) {
  const { mode = 'merge' } = options;

  // Create temp directory for extraction
  const tempDir = path.join(getCacheDir(), `import-${uuidv4()}`);
  await fs.ensureDir(tempDir);

  try {
    // Extract ZIP
    await extractZip(zipSource, tempDir);

    // Validate extracted content
    const extractedManifestPath = path.join(tempDir, 'manifest.json');
    if (!await fs.pathExists(extractedManifestPath)) {
      throw new InvalidImportError('ZIP archive does not contain manifest.json');
    }

    // Parse and validate manifest
    let importManifest;
    try {
      const manifestContent = await fs.readFile(extractedManifestPath, 'utf-8');
      importManifest = JSON.parse(manifestContent);
    } catch (error) {
      throw new InvalidImportError(`Invalid manifest.json: ${error.message}`);
    }

    // Validate manifest structure
    const validation = validateManifest(importManifest);
    if (!validation.valid) {
      throw new InvalidImportError('Invalid manifest structure', validation.errors);
    }

    // Check schema version compatibility
    if (!isCompatibleVersion(importManifest.version)) {
      throw new InvalidImportError(
        `Incompatible schema version: ${importManifest.version}. ` +
        `Current version: ${CURRENT_SCHEMA_VERSION}`
      );
    }

    // Read export metadata if present
    let exportMetadata = null;
    const metadataPath = path.join(tempDir, 'export-metadata.json');
    if (await fs.pathExists(metadataPath)) {
      try {
        exportMetadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      } catch (e) {
        // Ignore metadata parsing errors
      }
    }

    // Ensure target project structure
    await ensureDirectoryStructure(projectId);

    // Handle import based on mode
    const importResult = mode === 'replace'
      ? await replaceImport(projectId, tempDir, importManifest)
      : await mergeImport(projectId, tempDir, importManifest);

    return {
      success: true,
      projectId,
      mode,
      sourceProject: importManifest.projectId,
      sourceVersion: importManifest.version,
      exportedAt: exportMetadata?.exportedAt || null,
      ...importResult
    };

  } finally {
    // Cleanup temp directory
    await fs.remove(tempDir).catch(() => {});
  }
}

/**
 * Replace import - clears existing data and imports new
 */
async function replaceImport(projectId, tempDir, importManifest) {
  const projectDir = getProjectDir(projectId);

  // Clear existing data
  await fs.emptyDir(getOriginalsDir(projectId));
  await fs.emptyDir(getSummariesDir(projectId));
  await fs.emptyDir(getComposedDir(projectId));

  // Copy files
  const stats = await copyImportFiles(tempDir, projectId);

  // Update manifest with new project ID
  const newManifest = {
    ...importManifest,
    projectId,
    lastModified: new Date().toISOString()
  };

  await saveManifest(projectId, newManifest);

  return {
    sessionsImported: Object.keys(newManifest.sessions).length,
    compositionsImported: Object.keys(newManifest.compositions || {}).length,
    filesImported: stats.files,
    bytesImported: stats.bytes,
    replaced: true,
    merged: false
  };
}

/**
 * Merge import - preserves existing data, adds/updates from import
 */
async function mergeImport(projectId, tempDir, importManifest) {
  // Load existing manifest (or create new)
  let existingManifest;
  if (await manifestExists(projectId)) {
    existingManifest = await loadManifest(projectId);
  } else {
    existingManifest = {
      version: CURRENT_SCHEMA_VERSION,
      projectId,
      originalPath: importManifest.originalPath,
      displayName: importManifest.displayName,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      sessions: {},
      compositions: {},
      settings: importManifest.settings
    };
  }

  const stats = {
    sessionsAdded: 0,
    sessionsUpdated: 0,
    compositionsAdded: 0,
    files: 0,
    bytes: 0
  };

  // Merge sessions
  for (const [sessionId, session] of Object.entries(importManifest.sessions)) {
    if (existingManifest.sessions[sessionId]) {
      // Update existing session
      existingManifest.sessions[sessionId] = mergeSession(
        existingManifest.sessions[sessionId],
        session
      );
      stats.sessionsUpdated++;
    } else {
      // Add new session
      existingManifest.sessions[sessionId] = session;
      stats.sessionsAdded++;
    }
  }

  // Merge compositions (add new ones, don't update existing)
  for (const [compId, composition] of Object.entries(importManifest.compositions || {})) {
    if (!existingManifest.compositions[compId]) {
      existingManifest.compositions[compId] = composition;
      stats.compositionsAdded++;
    }
  }

  // Copy files (don't overwrite existing)
  const copyStats = await copyImportFiles(tempDir, projectId, { overwrite: false });
  stats.files = copyStats.files;
  stats.bytes = copyStats.bytes;

  // Save merged manifest
  existingManifest.lastModified = new Date().toISOString();
  await saveManifest(projectId, existingManifest);

  return {
    sessionsImported: stats.sessionsAdded + stats.sessionsUpdated,
    sessionsAdded: stats.sessionsAdded,
    sessionsUpdated: stats.sessionsUpdated,
    compositionsImported: stats.compositionsAdded,
    filesImported: stats.files,
    bytesImported: stats.bytes,
    replaced: false,
    merged: true
  };
}

/**
 * Merge two session objects
 */
function mergeSession(existing, imported) {
  return {
    ...existing,
    ...imported,
    // Preserve existing compressions and add new ones
    compressions: [
      ...(existing.compressions || []),
      ...(imported.compressions || []).filter(
        ic => !(existing.compressions || []).some(ec => ec.versionId === ic.versionId)
      )
    ],
    // Merge keepit markers
    keepitMarkers: mergeKeepitMarkers(
      existing.keepitMarkers || [],
      imported.keepitMarkers || []
    )
  };
}

/**
 * Merge keepit marker arrays
 */
function mergeKeepitMarkers(existing, imported) {
  const merged = [...existing];
  const existingIds = new Set(existing.map(k => k.id));

  for (const marker of imported) {
    if (!existingIds.has(marker.id)) {
      merged.push(marker);
    }
  }

  return merged;
}

/**
 * Copy import files to project directory
 */
async function copyImportFiles(tempDir, projectId, options = {}) {
  const { overwrite = true } = options;
  const stats = { files: 0, bytes: 0 };

  // Copy originals
  const tempOriginals = path.join(tempDir, 'originals');
  if (await fs.pathExists(tempOriginals)) {
    const copyResult = await copyDirectory(
      tempOriginals,
      getOriginalsDir(projectId),
      { overwrite }
    );
    stats.files += copyResult.files;
    stats.bytes += copyResult.bytes;
  }

  // Copy summaries
  const tempSummaries = path.join(tempDir, 'summaries');
  if (await fs.pathExists(tempSummaries)) {
    const copyResult = await copyDirectory(
      tempSummaries,
      getSummariesDir(projectId),
      { overwrite }
    );
    stats.files += copyResult.files;
    stats.bytes += copyResult.bytes;
  }

  // Copy composed
  const tempComposed = path.join(tempDir, 'composed');
  if (await fs.pathExists(tempComposed)) {
    const copyResult = await copyDirectory(
      tempComposed,
      getComposedDir(projectId),
      { overwrite }
    );
    stats.files += copyResult.files;
    stats.bytes += copyResult.bytes;
  }

  return stats;
}

/**
 * Copy directory contents recursively
 */
async function copyDirectory(src, dest, options = {}) {
  const { overwrite = true } = options;
  const stats = { files: 0, bytes: 0 };

  await fs.ensureDir(dest);

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      const subStats = await copyDirectory(srcPath, destPath, options);
      stats.files += subStats.files;
      stats.bytes += subStats.bytes;
    } else if (entry.isFile()) {
      // Check if destination exists
      if (!overwrite && await fs.pathExists(destPath)) {
        continue;
      }

      await fs.copy(srcPath, destPath, { overwrite });
      const fileStat = await fs.stat(destPath);
      stats.files++;
      stats.bytes += fileStat.size;
    }
  }

  return stats;
}

// ============================================
// ZIP Handling Utilities
// ============================================

/**
 * Extract ZIP file to directory
 * Uses Node.js built-in zlib with manual ZIP parsing
 */
async function extractZip(source, destDir) {
  // For ZIP extraction, we'll use a simpler approach with fs-extra
  // and the built-in unzip command if available, or a pure JS solution

  // Check if source is a path or buffer
  let zipPath;
  let tempZipPath = null;

  if (Buffer.isBuffer(source)) {
    // Write buffer to temp file
    tempZipPath = path.join(getCacheDir(), `temp-${uuidv4()}.zip`);
    await fs.writeFile(tempZipPath, source);
    zipPath = tempZipPath;
  } else if (typeof source === 'string') {
    zipPath = source;
  } else {
    throw new InvalidImportError('Invalid ZIP source: must be a file path or Buffer');
  }

  try {
    // Verify file exists
    if (!await fs.pathExists(zipPath)) {
      throw new InvalidImportError(`ZIP file not found: ${zipPath}`);
    }

    // Use unzip command if available (more reliable)
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      await execAsync(`unzip -o "${zipPath}" -d "${destDir}"`);
    } catch (unzipError) {
      // Fallback: try with pure Node.js (basic implementation)
      await extractZipPureNode(zipPath, destDir);
    }

  } finally {
    // Cleanup temp file
    if (tempZipPath) {
      await fs.remove(tempZipPath).catch(() => {});
    }
  }
}

/**
 * Pure Node.js ZIP extraction (basic implementation)
 * This is a fallback if unzip command is not available
 */
async function extractZipPureNode(zipPath, destDir) {
  const zlib = await import('zlib');
  const { Readable } = await import('stream');

  // Read the ZIP file
  const zipBuffer = await fs.readFile(zipPath);

  // Basic ZIP file parsing
  // ZIP files have entries with local file headers followed by data

  let offset = 0;

  while (offset < zipBuffer.length - 30) {
    // Check for local file header signature (0x04034b50)
    const signature = zipBuffer.readUInt32LE(offset);

    if (signature !== 0x04034b50) {
      // Not a local file header, might be central directory
      break;
    }

    // Parse local file header
    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 22);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
    const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);

    // Get filename
    const fileNameStart = offset + 30;
    const fileName = zipBuffer.slice(fileNameStart, fileNameStart + fileNameLength).toString('utf-8');

    // Calculate data offset
    const dataStart = fileNameStart + fileNameLength + extraFieldLength;

    // Skip directories
    if (!fileName.endsWith('/')) {
      const destPath = path.join(destDir, fileName);

      // Ensure parent directory exists
      await fs.ensureDir(path.dirname(destPath));

      // Extract file data
      const compressedData = zipBuffer.slice(dataStart, dataStart + compressedSize);

      let fileData;
      if (compressionMethod === 0) {
        // Stored (no compression)
        fileData = compressedData;
      } else if (compressionMethod === 8) {
        // Deflate
        try {
          fileData = zlib.inflateRawSync(compressedData);
        } catch (inflateError) {
          throw new InvalidImportError(`Failed to decompress file ${fileName}: ${inflateError.message}`);
        }
      } else {
        throw new InvalidImportError(`Unsupported compression method: ${compressionMethod}`);
      }

      // Write file
      await fs.writeFile(destPath, fileData);
    }

    // Move to next entry
    offset = dataStart + compressedSize;
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Count files in directory recursively
 */
async function countFiles(dirPath) {
  let count = 0;

  if (!await fs.pathExists(dirPath)) {
    return 0;
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countFiles(path.join(dirPath, entry.name));
    } else if (entry.isFile()) {
      count++;
    }
  }

  return count;
}

/**
 * Check if schema version is compatible
 */
function isCompatibleVersion(version) {
  // Parse versions
  const parse = (v) => {
    const parts = v.split('.').map(Number);
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  };

  const current = parse(CURRENT_SCHEMA_VERSION);
  const imported = parse(version);

  // Major version must match
  // Minor version of import can be <= current
  return imported.major === current.major && imported.minor <= current.minor;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================
// Exports
// ============================================

export default {
  exportProject,
  exportProjectToFile,
  importProject,
  isCompatibleVersion
};
