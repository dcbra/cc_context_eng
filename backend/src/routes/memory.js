import express from 'express';
import fs from 'fs-extra';
import multer from 'multer';
import {
  getProjectsDir,
  getProjectDir,
  loadGlobalConfig,
  saveGlobalConfig,
  getConfigValue,
  setConfigValue,
  resetConfig,
  ensureMemoryRoot,
  isMemoryInitialized
} from '../services/memory-storage.js';
import {
  loadManifest,
  manifestExists,
  updateSettings,
  getSettings
} from '../services/memory-manifest.js';
import {
  registerSession,
  unregisterSession,
  getSessionDetails,
  listRegisteredSessions,
  isSessionRegistered,
  refreshSession,
  getProjectSessionStats,
  findUnregisteredSessions
} from '../services/memory-session.js';
import {
  detectNewMessages,
  syncNewMessages,
  getSyncStatus
} from '../services/memory-sync.js';
import {
  createCompressionVersion,
  listCompressionVersions,
  getCompressionVersion,
  getVersionContent,
  deleteCompressionVersion,
  validateCompressionSettings,
  getPresetsInfo,
  TIER_PRESETS,
  COMPACTION_RATIOS
} from '../services/memory-versions.js';
import {
  listKeepitMarkers,
  getKeepitMarker,
  updateKeepitMarkerWeight,
  deleteKeepitMarker,
  addKeepitMarker
} from '../services/keepit-updater.js';
import { previewDecay, analyzeKeepitSurvival, explainDecayCalculation } from '../services/keepit-decay.js';
import { WEIGHT_PRESETS } from '../services/keepit-parser.js';
import {
  composeContext,
  getComposition,
  listCompositions,
  deleteComposition,
  getCompositionContent,
  previewComposition,
  allocateTokenBudget,
  suggestAllocation
} from '../services/composition-engine.js';

// Phase 5 imports
import {
  acquireSessionLock,
  withSessionLock,
  getLockStatus,
  cleanupStaleLocks,
  OperationType
} from '../services/memory-lock.js';
import {
  getProjectStats,
  getGlobalStats,
  getSessionStats,
  getCacheStats,
  clearCache
} from '../services/memory-stats.js';
import {
  exportProject,
  importProject
} from '../services/memory-export.js';

// Phase 2 - Delta Compression imports
import {
  getDeltaStatus,
  getHighestPartNumber,
  getPartsByNumber
} from '../services/memory-delta.js';
import {
  createDeltaCompression,
  recompressPart
} from '../services/memory-versions-delta.js';
import {
  MemoryError,
  ValidationError,
  CompressionInProgressError,
  asyncHandler
} from '../services/memory-errors.js';
import {
  validateParams,
  validateCompressionSettings as validateCompressionSettingsMiddleware,
  validateCompositionRequest,
  validateKeepitUpdate,
  validateKeepitCreate,
  validateImportOptions,
  validateFormatQuery,
  sanitizeRequestBody
} from '../middleware/memory-validation.js';

const router = express.Router();

// Configure multer for file uploads (ZIP import)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' ||
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new ValidationError('Only ZIP files are allowed'));
    }
  }
});

// Apply sanitization to all requests
router.use(sanitizeRequestBody);

// ============================================
// Health & Status Endpoints
// ============================================

/**
 * GET /api/memory/status
 * Get memory system status and initialization state
 */
router.get('/status', async (req, res, next) => {
  try {
    const initialized = await isMemoryInitialized();
    let config = null;

    if (initialized) {
      config = await loadGlobalConfig();
    }

    res.json({
      initialized,
      version: config?.version || null,
      createdAt: config?.createdAt || null
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memory/initialize
 * Initialize the memory system (creates root directory and config)
 */
router.post('/initialize', async (req, res, next) => {
  try {
    await ensureMemoryRoot();
    const config = await loadGlobalConfig();

    res.json({
      success: true,
      config
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Configuration Endpoints
// ============================================

/**
 * GET /api/memory/config
 * Get the global memory system configuration
 */
router.get('/config', async (req, res, next) => {
  try {
    const config = await loadGlobalConfig();
    res.json(config);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/memory/config
 * Update the global memory system configuration
 */
router.put('/config', async (req, res, next) => {
  try {
    const updates = req.body;

    // Load current config and merge with updates
    const currentConfig = await loadGlobalConfig();
    const newConfig = {
      ...currentConfig,
      ...updates,
      // Preserve version and createdAt
      version: currentConfig.version,
      createdAt: currentConfig.createdAt
    };

    await saveGlobalConfig(newConfig);
    res.json(newConfig);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/memory/config/:path
 * Get a specific configuration value by path (e.g., defaults.model)
 */
router.get('/config/:path(*)', async (req, res, next) => {
  try {
    const configPath = req.params.path;
    const value = await getConfigValue(configPath);

    if (value === undefined) {
      return res.status(404).json({
        error: `Configuration path not found: ${configPath}`
      });
    }

    res.json({ path: configPath, value });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/memory/config/:path
 * Set a specific configuration value by path
 */
router.put('/config/:path(*)', async (req, res, next) => {
  try {
    const configPath = req.params.path;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({
        error: 'Request body must include a "value" field'
      });
    }

    const config = await setConfigValue(configPath, value);
    res.json({ path: configPath, value, config });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memory/config/reset
 * Reset configuration to defaults
 */
router.post('/config/reset', async (req, res, next) => {
  try {
    const config = await resetConfig();
    res.json({
      success: true,
      config
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Project Endpoints (Task 1.6)
// ============================================

/**
 * GET /api/memory/projects
 * List all projects in the memory system
 */
router.get('/projects', async (req, res, next) => {
  try {
    const projectsDir = getProjectsDir();

    if (!await fs.pathExists(projectsDir)) {
      return res.json([]);
    }

    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    const projects = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectId = entry.name;

      // Skip if no manifest
      if (!await manifestExists(projectId)) continue;

      try {
        const manifest = await loadManifest(projectId);
        const sessionCount = Object.keys(manifest.sessions).length;

        // Calculate total tokens and compressions
        let totalTokens = 0;
        let totalCompressions = 0;
        for (const session of Object.values(manifest.sessions)) {
          totalTokens += session.originalTokens || 0;
          totalCompressions += session.compressions?.length || 0;
        }

        projects.push({
          projectId,
          displayName: manifest.displayName,
          originalPath: manifest.originalPath,
          sessionCount,
          totalTokens,
          totalCompressions,
          createdAt: manifest.createdAt,
          lastModified: manifest.lastModified,
          settings: manifest.settings
        });
      } catch (error) {
        // Log but continue with other projects
        console.warn(`Failed to load manifest for project ${projectId}:`, error.message);
      }
    }

    // Sort by last modified (most recent first)
    projects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

    res.json(projects);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId
 * Get full project details including manifest
 */
router.get('/projects/:projectId', async (req, res, next) => {
  try {
    const { projectId } = req.params;

    if (!await manifestExists(projectId)) {
      return res.status(404).json({
        error: `Project not found: ${projectId}`
      });
    }

    const manifest = await loadManifest(projectId);
    const stats = await getProjectSessionStats(projectId);

    res.json({
      ...manifest,
      stats
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/settings
 * Get project settings
 */
router.get('/projects/:projectId/settings', async (req, res, next) => {
  try {
    const { projectId } = req.params;

    if (!await manifestExists(projectId)) {
      return res.status(404).json({
        error: `Project not found: ${projectId}`
      });
    }

    const settings = await getSettings(projectId);
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/memory/projects/:projectId/settings
 * Update project settings
 */
router.put('/projects/:projectId/settings', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const updates = req.body;

    if (!await manifestExists(projectId)) {
      return res.status(404).json({
        error: `Project not found: ${projectId}`
      });
    }

    const settings = await updateSettings(projectId, updates);
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/unregistered
 * Find sessions in Claude Code that aren't registered in memory system
 */
router.get('/projects/:projectId/unregistered', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const unregistered = await findUnregisteredSessions(projectId);
    res.json(unregistered);
  } catch (error) {
    next(error);
  }
});

// ============================================
// Session Endpoints (Task 1.5 & 1.6)
// ============================================

/**
 * GET /api/memory/projects/:projectId/sessions
 * List all registered sessions for a project
 */
router.get('/projects/:projectId/sessions', async (req, res, next) => {
  try {
    const { projectId } = req.params;

    // Return empty array if project doesn't exist yet (will be created on first registration)
    if (!await manifestExists(projectId)) {
      return res.json([]);
    }

    const sessions = await listRegisteredSessions(projectId);

    // Add compression version counts per session
    const sessionsWithCounts = sessions.map(session => ({
      ...session,
      compressionCount: session.compressions?.length || 0
    }));

    // Sort by last accessed (most recent first)
    sessionsWithCounts.sort((a, b) => {
      const aTime = a.lastAccessed ? new Date(a.lastAccessed) : new Date(0);
      const bTime = b.lastAccessed ? new Date(b.lastAccessed) : new Date(0);
      return bTime - aTime;
    });

    res.json(sessionsWithCounts);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/sessions/:sessionId
 * Register a session in the memory system
 */
router.post('/projects/:projectId/sessions/:sessionId', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;
    const { originalFilePath } = req.body;

    const sessionEntry = await registerSession(projectId, sessionId, {
      originalFilePath
    });

    res.status(201).json(sessionEntry);
  } catch (error) {
    // Handle specific error codes
    if (error.code === 'SESSION_ALREADY_REGISTERED') {
      return res.status(409).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'SESSION_FILE_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'SESSION_PARSE_ERROR') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId
 * Get details of a specific registered session
 */
router.get('/projects/:projectId/sessions/:sessionId', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;
    const { updateLastAccessed } = req.query;

    const session = await getSessionDetails(projectId, sessionId, {
      updateLastAccessed: updateLastAccessed !== 'false'
    });

    res.json(session);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * DELETE /api/memory/projects/:projectId/sessions/:sessionId
 * Unregister a session from the memory system
 */
router.delete('/projects/:projectId/sessions/:sessionId', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;
    const { deleteSummaries } = req.query;

    const removedSession = await unregisterSession(projectId, sessionId, {
      deleteSummaries: deleteSummaries === 'true'
    });

    res.json({
      success: true,
      removedSession
    });
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/sessions/:sessionId/refresh
 * Refresh a session's metadata by re-parsing the original file
 */
router.post('/projects/:projectId/sessions/:sessionId/refresh', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;

    const session = await refreshSession(projectId, sessionId);
    res.json(session);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'SESSION_FILE_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId/status
 * Check if a session is registered
 */
router.get('/projects/:projectId/sessions/:sessionId/status', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;

    const registered = await isSessionRegistered(projectId, sessionId);

    res.json({
      sessionId,
      projectId,
      registered
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Sync Endpoints
// ============================================

/**
 * GET /api/memory/sessions/:projectId/:sessionId/sync/status
 * Check sync status - whether original session has new messages
 */
router.get('/sessions/:projectId/:sessionId/sync/status', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;

    const status = await getSyncStatus(projectId, sessionId);
    res.json(status);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * POST /api/memory/sessions/:projectId/:sessionId/sync
 * Perform sync - append new messages from original to memory copy
 */
router.post('/sessions/:projectId/:sessionId/sync', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;

    const result = await syncNewMessages(projectId, sessionId);
    res.json(result);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'ORIGINAL_NOT_FOUND' || error.code === 'COPY_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/stats
 * Get session statistics for a project
 */
router.get('/projects/:projectId/stats', async (req, res, next) => {
  try {
    const { projectId } = req.params;

    if (!await manifestExists(projectId)) {
      return res.status(404).json({
        error: `Project not found: ${projectId}`
      });
    }

    const stats = await getProjectSessionStats(projectId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// ============================================
// Delta Compression Endpoints (Incremental Compression)
// ============================================

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId/delta/status
 * Get delta status - what new messages exist since last compression
 * Returns: { hasDelta, deltaCount, lastCompressedTimestamp, nextPartNumber }
 */
router.get('/projects/:projectId/sessions/:sessionId/delta/status', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;

    const status = await getDeltaStatus(projectId, sessionId);
    res.json(status);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/sessions/:sessionId/delta/compress
 * Create delta compression - compress only new messages since last compression
 * Body: { mode, tierPreset, model, ... } (compression settings)
 * Returns: compression record for the new part
 */
router.post('/projects/:projectId/sessions/:sessionId/delta/compress', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;
    const settings = req.body;

    const result = await createDeltaCompression(projectId, sessionId, settings);
    res.status(201).json(result);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'SESSION_FILE_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'NO_DELTA' || error.code === 'INSUFFICIENT_MESSAGES' ||
        error.code === 'INVALID_SETTINGS') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'COMPRESSION_IN_PROGRESS') {
      return res.status(409).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/sessions/:sessionId/parts/:partNumber/recompress
 * Re-compress an existing part at a different compression level
 * Body: { compressionLevel } or full compression settings
 * Returns: new compression record for same part at different level
 */
router.post('/projects/:projectId/sessions/:sessionId/parts/:partNumber/recompress', async (req, res, next) => {
  try {
    const { projectId, sessionId, partNumber } = req.params;
    const settings = req.body;

    const result = await recompressPart(projectId, sessionId, parseInt(partNumber, 10), settings);
    res.status(201).json(result);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'PART_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'INVALID_PART' || error.code === 'INSUFFICIENT_MESSAGES' ||
        error.code === 'INVALID_SETTINGS') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'VERSION_EXISTS' || error.code === 'COMPRESSION_IN_PROGRESS') {
      return res.status(409).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId/parts
 * List all compression parts for a session, organized by part number
 * Returns: { parts: [{ partNumber, versions: [...], messageRange }] }
 */
router.get('/projects/:projectId/sessions/:sessionId/parts', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;

    if (!await manifestExists(projectId)) {
      return res.status(404).json({
        error: `Project not found: ${projectId}`,
        code: 'PROJECT_NOT_FOUND'
      });
    }

    const manifest = await loadManifest(projectId);
    const session = manifest.sessions[sessionId];

    if (!session) {
      return res.status(404).json({
        error: `Session ${sessionId} not found in project ${projectId}`,
        code: 'SESSION_NOT_FOUND'
      });
    }

    const partsByNumber = getPartsByNumber(session);

    // Convert Map to array for JSON serialization
    const parts = [];
    for (const [partNumber, versions] of partsByNumber) {
      parts.push({
        partNumber,
        messageRange: versions[0]?.messageRange || null,
        versions: versions.map(v => ({
          versionId: v.versionId,
          file: v.file,
          compressionLevel: v.compressionLevel,
          outputTokens: v.outputTokens,
          outputMessages: v.outputMessages,
          compressionRatio: v.compressionRatio,
          createdAt: v.createdAt,
          settings: v.settings
        }))
      });
    }

    // Sort by part number
    parts.sort((a, b) => a.partNumber - b.partNumber);

    res.json({
      sessionId,
      totalParts: parts.length,
      parts
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Batch Operations
// ============================================

/**
 * POST /api/memory/projects/:projectId/sessions/batch-register
 * Register multiple sessions at once
 */
router.post('/projects/:projectId/sessions/batch-register', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { sessionIds } = req.body;

    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      return res.status(400).json({
        error: 'Request body must include a non-empty "sessionIds" array'
      });
    }

    const results = {
      successful: [],
      failed: []
    };

    for (const sessionId of sessionIds) {
      try {
        const sessionEntry = await registerSession(projectId, sessionId);
        results.successful.push({
          sessionId,
          entry: sessionEntry
        });
      } catch (error) {
        results.failed.push({
          sessionId,
          error: error.message,
          code: error.code
        });
      }
    }

    res.status(results.failed.length > 0 ? 207 : 201).json(results);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/sessions/batch-unregister
 * Unregister multiple sessions at once
 */
router.post('/projects/:projectId/sessions/batch-unregister', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { sessionIds, deleteSummaries } = req.body;

    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      return res.status(400).json({
        error: 'Request body must include a non-empty "sessionIds" array'
      });
    }

    const results = {
      successful: [],
      failed: []
    };

    for (const sessionId of sessionIds) {
      try {
        const removedSession = await unregisterSession(projectId, sessionId, {
          deleteSummaries: deleteSummaries === true
        });
        results.successful.push({
          sessionId,
          removed: removedSession
        });
      } catch (error) {
        results.failed.push({
          sessionId,
          error: error.message,
          code: error.code
        });
      }
    }

    res.status(results.failed.length > 0 ? 207 : 200).json(results);
  } catch (error) {
    next(error);
  }
});

// ============================================
// Compression Version Endpoints (Phase 2)
// ============================================

/**
 * GET /api/memory/presets
 * Get available compression presets and configuration options
 */
router.get('/presets', async (req, res, next) => {
  try {
    const presets = getPresetsInfo();
    res.json(presets);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/sessions/:sessionId/versions
 * Create a new compression version for a session
 */
router.post('/projects/:projectId/sessions/:sessionId/versions', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;
    const settings = req.body;

    // Validate settings
    const validation = validateCompressionSettings(settings);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid compression settings',
        details: validation.errors
      });
    }

    // Check if session exists
    if (!await manifestExists(projectId)) {
      return res.status(404).json({
        error: `Project not found: ${projectId}`
      });
    }

    const compressionRecord = await createCompressionVersion(projectId, sessionId, settings);
    res.status(201).json(compressionRecord);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'INVALID_SETTINGS') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'INSUFFICIENT_MESSAGES') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'SESSION_PARSE_ERROR') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'COMPRESSION_FAILED') {
      return res.status(500).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId/versions
 * List all compression versions for a session (includes "original" pseudo-version)
 */
router.get('/projects/:projectId/sessions/:sessionId/versions', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;

    const versions = await listCompressionVersions(projectId, sessionId);
    res.json(versions);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId/versions/:versionId
 * Get details of a specific compression version
 * Use versionId='original' for the original session
 */
router.get('/projects/:projectId/sessions/:sessionId/versions/:versionId', async (req, res, next) => {
  try {
    const { projectId, sessionId, versionId } = req.params;

    const version = await getCompressionVersion(projectId, sessionId, versionId);
    res.json(version);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'VERSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId/versions/:versionId/content
 * Get the content of a compression version
 * Query param: format=md|jsonl (default: md)
 */
router.get('/projects/:projectId/sessions/:sessionId/versions/:versionId/content', async (req, res, next) => {
  try {
    const { projectId, sessionId, versionId } = req.params;
    const { format = 'md' } = req.query;

    if (!['md', 'jsonl'].includes(format)) {
      return res.status(400).json({
        error: 'Invalid format. Must be "md" or "jsonl"'
      });
    }

    const result = await getVersionContent(projectId, sessionId, versionId, format);
    res.set('Content-Type', result.contentType);
    res.send(result.content);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'VERSION_NOT_FOUND' || error.code === 'VERSION_FILE_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId/versions/:versionId/download
 * Download a compression version file
 * Query param: format=md|jsonl (default: md)
 */
router.get('/projects/:projectId/sessions/:sessionId/versions/:versionId/download', async (req, res, next) => {
  try {
    const { projectId, sessionId, versionId } = req.params;
    const { format = 'md' } = req.query;

    if (!['md', 'jsonl'].includes(format)) {
      return res.status(400).json({
        error: 'Invalid format. Must be "md" or "jsonl"'
      });
    }

    const result = await getVersionContent(projectId, sessionId, versionId, format);
    res.set('Content-Type', result.contentType);
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'VERSION_NOT_FOUND' || error.code === 'VERSION_FILE_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * DELETE /api/memory/projects/:projectId/sessions/:sessionId/versions/:versionId
 * Delete a compression version
 * Query param: force=true to delete even if used in compositions
 */
router.delete('/projects/:projectId/sessions/:sessionId/versions/:versionId', async (req, res, next) => {
  try {
    const { projectId, sessionId, versionId } = req.params;
    const { force } = req.query;

    const result = await deleteCompressionVersion(projectId, sessionId, versionId, {
      force: force === 'true'
    });

    res.json(result);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'VERSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'VERSION_IN_USE') {
      return res.status(409).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'CANNOT_DELETE_ORIGINAL') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/sessions/:sessionId/versions/validate
 * Validate compression settings without creating a version (dry run)
 */
router.post('/projects/:projectId/sessions/:sessionId/versions/validate', async (req, res, next) => {
  try {
    const settings = req.body;

    const validation = validateCompressionSettings(settings);

    if (!validation.valid) {
      return res.status(400).json({
        valid: false,
        errors: validation.errors
      });
    }

    res.json({
      valid: true,
      settings: {
        mode: settings.mode,
        ...(settings.mode === 'uniform' ? {
          compactionRatio: settings.compactionRatio || 10,
          aggressiveness: settings.aggressiveness || 'moderate'
        } : {
          tierPreset: settings.tierPreset || 'standard',
          tiers: settings.customTiers || TIER_PRESETS[settings.tierPreset || 'standard']
        }),
        model: settings.model || 'opus',
        skipFirstMessages: settings.skipFirstMessages || 0,
        keepitMode: settings.keepitMode || 'ignore'
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Keepit Marker Endpoints (Phase 3)
// ============================================

/**
 * GET /api/memory/keepit/presets
 * Get available keepit weight presets
 */
router.get('/keepit/presets', async (req, res, next) => {
  try {
    res.json({
      presets: WEIGHT_PRESETS,
      descriptions: {
        PINNED: 'Always survives - permanent marker (1.00)',
        CRITICAL: 'Survives most compressions (0.90)',
        IMPORTANT: 'High priority preservation (0.75)',
        NOTABLE: 'Moderate priority (0.50)',
        MINOR: 'Low priority - survives light compression (0.25)',
        HINT: 'Lowest priority - easily decayed (0.10)'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId/keepits
 * List all keepit markers for a session
 */
router.get('/projects/:projectId/sessions/:sessionId/keepits', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;

    const markers = await listKeepitMarkers(projectId, sessionId);
    res.json(markers);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId/keepits/:markerId
 * Get a specific keepit marker
 */
router.get('/projects/:projectId/sessions/:sessionId/keepits/:markerId', async (req, res, next) => {
  try {
    const { projectId, sessionId, markerId } = req.params;

    const marker = await getKeepitMarker(projectId, sessionId, markerId);
    res.json(marker);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'KEEPIT_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * PUT /api/memory/projects/:projectId/sessions/:sessionId/keepits/:markerId
 * Update a keepit marker's weight
 * IMPORTANT: This modifies the ORIGINAL session file (per design doc Section 5.4)
 */
router.put('/projects/:projectId/sessions/:sessionId/keepits/:markerId', async (req, res, next) => {
  try {
    const { projectId, sessionId, markerId } = req.params;
    const { weight, createBackup = true } = req.body;

    if (weight === undefined) {
      return res.status(400).json({
        error: 'Request body must include a "weight" field (0.00-1.00)'
      });
    }

    const result = await updateKeepitMarkerWeight(projectId, sessionId, markerId, weight, {
      createBackup
    });

    res.json(result);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'KEEPIT_NOT_FOUND' ||
        error.code === 'SESSION_FILE_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'KEEPIT_CONTENT_NOT_FOUND') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * DELETE /api/memory/projects/:projectId/sessions/:sessionId/keepits/:markerId
 * Delete a keepit marker (removes pattern, preserves content)
 * IMPORTANT: This modifies the ORIGINAL session file
 */
router.delete('/projects/:projectId/sessions/:sessionId/keepits/:markerId', async (req, res, next) => {
  try {
    const { projectId, sessionId, markerId } = req.params;
    const { createBackup } = req.query;

    const result = await deleteKeepitMarker(projectId, sessionId, markerId, {
      createBackup: createBackup !== 'false'
    });

    res.json(result);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'KEEPIT_NOT_FOUND' ||
        error.code === 'SESSION_FILE_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'KEEPIT_CONTENT_NOT_FOUND') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/sessions/:sessionId/keepits
 * Add a new keepit marker to a message
 * IMPORTANT: This modifies the ORIGINAL session file
 */
router.post('/projects/:projectId/sessions/:sessionId/keepits', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;
    const { messageUuid, content, weight, createBackup = true } = req.body;

    if (!messageUuid) {
      return res.status(400).json({
        error: 'Request body must include "messageUuid"'
      });
    }
    if (!content) {
      return res.status(400).json({
        error: 'Request body must include "content" to mark'
      });
    }
    if (weight === undefined) {
      return res.status(400).json({
        error: 'Request body must include "weight" (0.00-1.00)'
      });
    }

    const result = await addKeepitMarker(projectId, sessionId, messageUuid, content, weight, {
      createBackup
    });

    res.status(201).json(result);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'MESSAGE_NOT_FOUND' ||
        error.code === 'SESSION_FILE_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'CONTENT_NOT_FOUND' || error.code === 'ALREADY_MARKED') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/sessions/:sessionId/keepits/decay-preview
 * Preview which keepits will survive/decay with given compression settings
 */
router.post('/projects/:projectId/sessions/:sessionId/keepits/decay-preview', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;
    const { compressionRatio = 10, sessionDistance = 0, aggressiveness = null } = req.body;

    const markers = await listKeepitMarkers(projectId, sessionId);

    if (markers.length === 0) {
      return res.json({
        message: 'No keepit markers found in session',
        preview: null
      });
    }

    const preview = previewDecay(markers, {
      compressionRatio,
      sessionDistance,
      aggressiveness
    });

    res.json(preview);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/sessions/:sessionId/keepits/analyze
 * Analyze keepit survival across different compression scenarios
 */
router.post('/projects/:projectId/sessions/:sessionId/keepits/analyze', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;

    const markers = await listKeepitMarkers(projectId, sessionId);

    if (markers.length === 0) {
      return res.json({
        message: 'No keepit markers found in session',
        analysis: null
      });
    }

    const analysis = analyzeKeepitSurvival(markers);
    res.json(analysis);
  } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * POST /api/memory/decay/explain
 * Explain the decay calculation for a specific weight and settings
 * (No session required - just explains the formula)
 */
router.post('/decay/explain', async (req, res, next) => {
  try {
    const { weight, compressionRatio = 10, sessionDistance = 0, aggressiveness = null } = req.body;

    if (weight === undefined) {
      return res.status(400).json({
        error: 'Request body must include "weight" (0.00-1.00)'
      });
    }

    const explanation = explainDecayCalculation(weight, {
      compressionRatio,
      sessionDistance,
      aggressiveness
    });

    res.json(explanation);
  } catch (error) {
    next(error);
  }
});

// ============================================
// Composition Endpoints (Phase 4)
// ============================================

/**
 * GET /api/memory/composition/strategies
 * Get available allocation strategies and their descriptions
 */
router.get('/composition/strategies', async (req, res, next) => {
  try {
    res.json({
      strategies: {
        equal: {
          name: 'Equal',
          description: 'Divides budget equally among all sessions'
        },
        proportional: {
          name: 'Proportional',
          description: 'Allocates based on original session sizes (larger sessions get more budget)'
        },
        recency: {
          name: 'Recency',
          description: 'Prioritizes recent sessions (later sessions get more budget)'
        },
        'inverse-recency': {
          name: 'Inverse Recency',
          description: 'Prioritizes older sessions (earlier sessions get more budget)'
        },
        custom: {
          name: 'Custom',
          description: 'Uses custom weights specified per component'
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/compositions
 * Create a new composition from multiple sessions
 */
router.post('/projects/:projectId/compositions', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const request = req.body;

    // Validate required fields
    if (!request.name) {
      return res.status(400).json({
        error: 'Request body must include "name"'
      });
    }

    if (!request.components || !Array.isArray(request.components) || request.components.length === 0) {
      return res.status(400).json({
        error: 'Request body must include "components" array with at least one session'
      });
    }

    if (!request.totalTokenBudget || typeof request.totalTokenBudget !== 'number') {
      return res.status(400).json({
        error: 'Request body must include "totalTokenBudget" as a number'
      });
    }

    // Validate component structure
    for (const comp of request.components) {
      if (!comp.sessionId) {
        return res.status(400).json({
          error: 'Each component must have a "sessionId"'
        });
      }
    }

    const composition = await composeContext(projectId, request);
    res.status(201).json(composition);
  } catch (error) {
    if (error.code === 'INVALID_NAME' || error.code === 'NO_COMPONENTS' ||
        error.code === 'INVALID_BUDGET' || error.code === 'INVALID_SETTINGS') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'SESSION_NOT_FOUND' || error.code === 'VERSION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/compositions
 * List all compositions for a project
 */
router.get('/projects/:projectId/compositions', async (req, res, next) => {
  try {
    const { projectId } = req.params;

    if (!await manifestExists(projectId)) {
      return res.json([]);
    }

    const compositions = await listCompositions(projectId);
    res.json(compositions);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/compositions/preview
 * Preview a composition without creating it
 */
router.post('/projects/:projectId/compositions/preview', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const request = req.body;

    if (!request.components || !Array.isArray(request.components) || request.components.length === 0) {
      return res.status(400).json({
        error: 'Request body must include "components" array with at least one session'
      });
    }

    if (!request.totalTokenBudget || typeof request.totalTokenBudget !== 'number') {
      return res.status(400).json({
        error: 'Request body must include "totalTokenBudget" as a number'
      });
    }

    const preview = await previewComposition(projectId, request);
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memory/projects/:projectId/compositions/suggest-allocation
 * Get allocation recommendations for given sessions and budget
 */
router.post('/projects/:projectId/compositions/suggest-allocation', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { sessionIds, totalTokenBudget } = req.body;

    if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
      return res.status(400).json({
        error: 'Request body must include "sessionIds" array'
      });
    }

    if (!totalTokenBudget || typeof totalTokenBudget !== 'number') {
      return res.status(400).json({
        error: 'Request body must include "totalTokenBudget" as a number'
      });
    }

    const manifest = await loadManifest(projectId);

    // Build session info
    const sessions = [];
    for (const sessionId of sessionIds) {
      const session = manifest.sessions[sessionId];
      if (!session) {
        return res.status(404).json({
          error: `Session not found: ${sessionId}`,
          code: 'SESSION_NOT_FOUND'
        });
      }
      sessions.push({
        sessionId,
        originalTokens: session.originalTokens,
        originalMessages: session.originalMessages
      });
    }

    const suggestion = suggestAllocation(sessions, totalTokenBudget);
    res.json(suggestion);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/compositions/:compositionId
 * Get details of a specific composition
 */
router.get('/projects/:projectId/compositions/:compositionId', async (req, res, next) => {
  try {
    const { projectId, compositionId } = req.params;

    const composition = await getComposition(projectId, compositionId);
    res.json(composition);
  } catch (error) {
    if (error.code === 'COMPOSITION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/compositions/:compositionId/content
 * Get the content of a composition
 * Query param: format=md|jsonl|metadata (default: md)
 */
router.get('/projects/:projectId/compositions/:compositionId/content', async (req, res, next) => {
  try {
    const { projectId, compositionId } = req.params;
    const { format = 'md' } = req.query;

    if (!['md', 'jsonl', 'metadata'].includes(format)) {
      return res.status(400).json({
        error: 'Invalid format. Must be "md", "jsonl", or "metadata"'
      });
    }

    const result = await getCompositionContent(projectId, compositionId, format);
    res.set('Content-Type', result.contentType);
    res.send(result.content);
  } catch (error) {
    if (error.code === 'COMPOSITION_NOT_FOUND' || error.code === 'COMPOSITION_FILE_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'INVALID_FORMAT') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * GET /api/memory/projects/:projectId/compositions/:compositionId/download
 * Download a composition file
 * Query param: format=md|jsonl|metadata (default: md)
 */
router.get('/projects/:projectId/compositions/:compositionId/download', async (req, res, next) => {
  try {
    const { projectId, compositionId } = req.params;
    const { format = 'md' } = req.query;

    if (!['md', 'jsonl', 'metadata'].includes(format)) {
      return res.status(400).json({
        error: 'Invalid format. Must be "md", "jsonl", or "metadata"'
      });
    }

    const result = await getCompositionContent(projectId, compositionId, format);
    res.set('Content-Type', result.contentType);
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (error) {
    if (error.code === 'COMPOSITION_NOT_FOUND' || error.code === 'COMPOSITION_FILE_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    if (error.code === 'INVALID_FORMAT') {
      return res.status(400).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

/**
 * DELETE /api/memory/projects/:projectId/compositions/:compositionId
 * Delete a composition
 */
router.delete('/projects/:projectId/compositions/:compositionId', async (req, res, next) => {
  try {
    const { projectId, compositionId } = req.params;

    const result = await deleteComposition(projectId, compositionId);
    res.json(result);
  } catch (error) {
    if (error.code === 'COMPOSITION_NOT_FOUND') {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

// ============================================
// Phase 5: Statistics Endpoints
// ============================================

/**
 * GET /api/memory/stats
 * Get global memory system statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await getGlobalStats();
  res.json(stats);
}));

/**
 * GET /api/memory/projects/:projectId/statistics
 * Get comprehensive statistics for a project
 * (Different from /stats which returns session stats only)
 */
router.get('/projects/:projectId/statistics', asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  if (!await manifestExists(projectId)) {
    throw new ValidationError(`Project not found: ${projectId}`);
  }

  const stats = await getProjectStats(projectId);
  res.json(stats);
}));

/**
 * GET /api/memory/projects/:projectId/sessions/:sessionId/statistics
 * Get statistics for a specific session
 */
router.get('/projects/:projectId/sessions/:sessionId/statistics', asyncHandler(async (req, res) => {
  const { projectId, sessionId } = req.params;

  const stats = await getSessionStats(projectId, sessionId);
  res.json(stats);
}));

/**
 * GET /api/memory/cache/stats
 * Get cache statistics
 */
router.get('/cache/stats', asyncHandler(async (req, res) => {
  const stats = await getCacheStats();
  res.json(stats);
}));

/**
 * POST /api/memory/cache/clear
 * Clear the cache directory
 */
router.post('/cache/clear', asyncHandler(async (req, res) => {
  const result = await clearCache();
  res.json(result);
}));

// ============================================
// Phase 5: Lock Management Endpoints
// ============================================

/**
 * GET /api/memory/locks
 * Get current lock status (active operations)
 */
router.get('/locks', asyncHandler(async (req, res) => {
  const status = getLockStatus();
  res.json(status);
}));

/**
 * POST /api/memory/locks/cleanup
 * Force cleanup of stale locks
 */
router.post('/locks/cleanup', asyncHandler(async (req, res) => {
  const result = cleanupStaleLocks();
  res.json(result);
}));

// ============================================
// Phase 5: Export/Import Endpoints
// ============================================

/**
 * GET /api/memory/projects/:projectId/export
 * Export a project's memory data as a ZIP archive
 * Query params:
 *   - includeOriginals: boolean (default: false)
 *   - includeSummaries: boolean (default: true)
 *   - includeComposed: boolean (default: true)
 */
router.get('/projects/:projectId/export', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const {
    includeOriginals = 'false',
    includeSummaries = 'true',
    includeComposed = 'true'
  } = req.query;

  const options = {
    includeOriginals: includeOriginals === 'true',
    includeSummaries: includeSummaries !== 'false',
    includeComposed: includeComposed !== 'false'
  };

  const { archive, metadata, filename } = await exportProject(projectId, options);

  // Set response headers for ZIP download
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Export-Metadata': JSON.stringify(metadata)
  });

  // Pipe archive to response
  archive.pipe(res);

  // Finalize the archive
  await archive.finalize();
}));

/**
 * POST /api/memory/projects/:projectId/import
 * Import memory data from a ZIP archive
 * Body: multipart/form-data with 'file' field containing ZIP
 * Query params:
 *   - mode: 'merge' | 'replace' (default: 'merge')
 */
router.post('/projects/:projectId/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const { mode = 'merge' } = req.query;

    if (!req.file) {
      throw new ValidationError('No file uploaded. Please upload a ZIP file.');
    }

    const result = await importProject(projectId, req.file.buffer, {
      mode
    });

    res.json(result);
  })
);

/**
 * POST /api/memory/projects/:projectId/import-from-path
 * Import memory data from a ZIP file path on server
 * (Useful for CLI/scripting)
 */
router.post('/projects/:projectId/import-from-path', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { filePath, mode = 'merge' } = req.body;

  if (!filePath) {
    throw new ValidationError('filePath is required');
  }

  const result = await importProject(projectId, filePath, {
    mode
  });

  res.json(result);
}));

// ============================================
// Phase 5: Compression with Locking
// ============================================

/**
 * POST /api/memory/projects/:projectId/sessions/:sessionId/versions
 * Create a new compression version for a session (with locking)
 * This overrides the existing endpoint to add lock support
 */
// Note: The original endpoint above handles this, but we ensure
// locking is integrated in the memory-versions.js service

// ============================================
// Phase 5: Enhanced Error Handling
// ============================================

// Memory-specific error handler middleware
// This is applied at the router level for all memory routes
router.use((err, req, res, next) => {
  // Handle MemoryError instances with standardized format
  if (err instanceof MemoryError) {
    const response = err.toResponse();

    // Add stack trace in development mode
    if (process.env.NODE_ENV === 'development') {
      response.error.stack = err.stack;
    }

    return res.status(err.statusCode).json(response);
  }

  // Handle multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'File size exceeds maximum allowed (100MB)'
      }
    });
  }

  // Handle errors with code property (legacy format)
  if (err.code && typeof err.code === 'string') {
    const statusCode = err.status || err.statusCode || 500;
    const response = {
      error: {
        code: err.code,
        message: err.message
      }
    };

    if (process.env.NODE_ENV === 'development') {
      response.error.stack = err.stack;
    }

    return res.status(statusCode).json(response);
  }

  // Pass to global error handler
  next(err);
});

export default router;
