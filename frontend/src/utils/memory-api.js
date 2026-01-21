/**
 * Memory System API Client
 *
 * Provides client functions for all memory system backend endpoints.
 * Following the pattern established in api.js
 */

const API_BASE = '/api/memory';

// ============================================
// Helper Functions
// ============================================

/**
 * Handle API response errors consistently
 * @param {Response} response - Fetch response object
 * @param {string} defaultMessage - Default error message
 * @throws {Error} With appropriate error message and code
 */
async function handleResponse(response, defaultMessage) {
  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      throw new Error(`${defaultMessage}: ${response.statusText}`);
    }

    const error = new Error(errorData.error?.message || errorData.error || defaultMessage);
    error.code = errorData.error?.code || errorData.code || 'UNKNOWN_ERROR';
    error.status = response.status;
    error.details = errorData.error?.details || errorData.details;
    throw error;
  }
  return response.json();
}

// ============================================
// Status & Configuration
// ============================================

/**
 * Get memory system status
 * @returns {Promise<{initialized: boolean, version: string|null, createdAt: string|null}>}
 */
export async function getMemoryStatus() {
  const response = await fetch(`${API_BASE}/status`);
  return handleResponse(response, 'Failed to get memory status');
}

/**
 * Initialize the memory system
 * @returns {Promise<{success: boolean, config: object}>}
 */
export async function initializeMemory() {
  const response = await fetch(`${API_BASE}/initialize`, {
    method: 'POST'
  });
  return handleResponse(response, 'Failed to initialize memory system');
}

/**
 * Get global memory configuration
 * @returns {Promise<object>}
 */
export async function getMemoryConfig() {
  const response = await fetch(`${API_BASE}/config`);
  return handleResponse(response, 'Failed to get memory config');
}

/**
 * Update global memory configuration
 * @param {object} updates - Configuration updates
 * @returns {Promise<object>}
 */
export async function updateMemoryConfig(updates) {
  const response = await fetch(`${API_BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(response, 'Failed to update memory config');
}

/**
 * Reset configuration to defaults
 * @returns {Promise<{success: boolean, config: object}>}
 */
export async function resetMemoryConfig() {
  const response = await fetch(`${API_BASE}/config/reset`, {
    method: 'POST'
  });
  return handleResponse(response, 'Failed to reset memory config');
}

// ============================================
// Project Endpoints
// ============================================

/**
 * Get all memory projects
 * @returns {Promise<Array<{projectId: string, displayName: string, sessionCount: number, ...}>>}
 */
export async function getMemoryProjects() {
  const response = await fetch(`${API_BASE}/projects`);
  return handleResponse(response, 'Failed to fetch memory projects');
}

/**
 * Get a specific memory project with full details
 * @param {string} projectId - The project ID
 * @returns {Promise<object>}
 */
export async function getMemoryProject(projectId) {
  const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`);
  return handleResponse(response, 'Failed to fetch memory project');
}

/**
 * Get project settings
 * @param {string} projectId - The project ID
 * @returns {Promise<object>}
 */
export async function getProjectSettings(projectId) {
  const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/settings`);
  return handleResponse(response, 'Failed to fetch project settings');
}

/**
 * Update project settings
 * @param {string} projectId - The project ID
 * @param {object} updates - Settings updates
 * @returns {Promise<object>}
 */
export async function updateProjectSettings(projectId, updates) {
  const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(response, 'Failed to update project settings');
}

/**
 * Get project statistics
 * @param {string} projectId - The project ID
 * @returns {Promise<object>}
 */
export async function getProjectStatistics(projectId) {
  const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/statistics`);
  return handleResponse(response, 'Failed to fetch project statistics');
}

/**
 * Find sessions not registered in memory system
 * @param {string} projectId - The project ID
 * @returns {Promise<Array>}
 */
export async function findUnregisteredSessions(projectId) {
  const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/unregistered`);
  return handleResponse(response, 'Failed to find unregistered sessions');
}

// ============================================
// Session Endpoints
// ============================================

/**
 * List registered sessions for a project
 * @param {string} projectId - The project ID
 * @returns {Promise<Array>}
 */
export async function getProjectSessions(projectId) {
  const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions`);
  return handleResponse(response, 'Failed to fetch sessions');
}

/**
 * Register a session in the memory system
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {object} options - Optional registration options
 * @param {string} [options.originalFilePath] - Original file path
 * @returns {Promise<object>}
 */
export async function registerSession(projectId, sessionId, options = {}) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    }
  );
  return handleResponse(response, 'Failed to register session');
}

/**
 * Get session details
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {object} options - Optional options
 * @param {boolean} [options.updateLastAccessed=true] - Update last accessed timestamp
 * @returns {Promise<object>}
 */
export async function getSessionDetails(projectId, sessionId, options = {}) {
  const params = new URLSearchParams();
  if (options.updateLastAccessed === false) {
    params.set('updateLastAccessed', 'false');
  }
  const queryString = params.toString();
  const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(url);
  return handleResponse(response, 'Failed to fetch session details');
}

/**
 * Unregister a session from the memory system
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {object} options - Optional options
 * @param {boolean} [options.deleteSummaries=false] - Delete associated summaries
 * @returns {Promise<{success: boolean, removedSession: object}>}
 */
export async function unregisterSession(projectId, sessionId, options = {}) {
  const params = new URLSearchParams();
  if (options.deleteSummaries) {
    params.set('deleteSummaries', 'true');
  }
  const queryString = params.toString();
  const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(url, { method: 'DELETE' });
  return handleResponse(response, 'Failed to unregister session');
}

/**
 * Refresh session metadata
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {Promise<object>}
 */
export async function refreshSession(projectId, sessionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/refresh`,
    { method: 'POST' }
  );
  return handleResponse(response, 'Failed to refresh session');
}

/**
 * Check if session is registered
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {Promise<{sessionId: string, projectId: string, registered: boolean}>}
 */
export async function getSessionStatus(projectId, sessionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/status`
  );
  return handleResponse(response, 'Failed to get session status');
}

/**
 * Batch register multiple sessions
 * @param {string} projectId - The project ID
 * @param {string[]} sessionIds - Array of session IDs
 * @returns {Promise<{successful: Array, failed: Array}>}
 */
export async function batchRegisterSessions(projectId, sessionIds) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/batch-register`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds })
    }
  );
  return handleResponse(response, 'Failed to batch register sessions');
}

/**
 * Batch unregister multiple sessions
 * @param {string} projectId - The project ID
 * @param {string[]} sessionIds - Array of session IDs
 * @param {object} options - Optional options
 * @param {boolean} [options.deleteSummaries=false] - Delete associated summaries
 * @returns {Promise<{successful: Array, failed: Array}>}
 */
export async function batchUnregisterSessions(projectId, sessionIds, options = {}) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/batch-unregister`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds, deleteSummaries: options.deleteSummaries || false })
    }
  );
  return handleResponse(response, 'Failed to batch unregister sessions');
}

// ============================================
// Compression Version Endpoints
// ============================================

/**
 * Get available compression presets
 * @returns {Promise<object>}
 */
export async function getCompressionPresets() {
  const response = await fetch(`${API_BASE}/presets`);
  return handleResponse(response, 'Failed to fetch compression presets');
}

/**
 * List compression versions for a session
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {Promise<Array>}
 */
export async function getSessionVersions(projectId, sessionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions`
  );
  return handleResponse(response, 'Failed to fetch compression versions');
}

/**
 * Create a new compression version
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {object} settings - Compression settings
 * @param {string} settings.mode - 'uniform' or 'tiered'
 * @param {number} [settings.compactionRatio] - For uniform mode
 * @param {string} [settings.tierPreset] - For tiered mode
 * @param {string} [settings.model] - AI model to use
 * @param {number} [settings.skipFirstMessages] - Messages to skip
 * @param {string} [settings.keepitMode] - How to handle keepit markers
 * @returns {Promise<object>}
 */
export async function createCompressionVersion(projectId, sessionId, settings) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    }
  );
  return handleResponse(response, 'Failed to create compression version');
}

/**
 * Get a specific compression version
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {string} versionId - The version ID (or 'original')
 * @returns {Promise<object>}
 */
export async function getCompressionVersion(projectId, sessionId, versionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions/${encodeURIComponent(versionId)}`
  );
  return handleResponse(response, 'Failed to fetch compression version');
}

/**
 * Get compression version content
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {string} versionId - The version ID
 * @param {string} [format='md'] - Output format ('md' or 'jsonl')
 * @returns {Promise<string>}
 */
export async function getVersionContent(projectId, sessionId, versionId, format = 'md') {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions/${encodeURIComponent(versionId)}/content?format=${format}`
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error = new Error(errorData.error || 'Failed to fetch version content');
    error.code = errorData.code;
    throw error;
  }
  return response.text();
}

/**
 * Delete a compression version
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {string} versionId - The version ID
 * @param {object} options - Optional options
 * @param {boolean} [options.force=false] - Force delete even if used in compositions
 * @returns {Promise<object>}
 */
export async function deleteCompressionVersion(projectId, sessionId, versionId, options = {}) {
  const params = new URLSearchParams();
  if (options.force) {
    params.set('force', 'true');
  }
  const queryString = params.toString();
  const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions/${encodeURIComponent(versionId)}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(url, { method: 'DELETE' });
  return handleResponse(response, 'Failed to delete compression version');
}

/**
 * Validate compression settings without creating a version
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {object} settings - Compression settings to validate
 * @returns {Promise<{valid: boolean, errors?: Array, settings?: object}>}
 */
export async function validateCompressionSettings(projectId, sessionId, settings) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/versions/validate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    }
  );
  return handleResponse(response, 'Failed to validate compression settings');
}

// ============================================
// Keepit Marker Endpoints
// ============================================

/**
 * Get keepit weight presets
 * @returns {Promise<{presets: object, descriptions: object}>}
 */
export async function getKeepitPresets() {
  const response = await fetch(`${API_BASE}/keepit/presets`);
  return handleResponse(response, 'Failed to fetch keepit presets');
}

/**
 * List keepit markers for a session
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {Promise<Array>}
 */
export async function getSessionKeepits(projectId, sessionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/keepits`
  );
  return handleResponse(response, 'Failed to fetch keepit markers');
}

/**
 * Get a specific keepit marker
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {string} markerId - The marker ID
 * @returns {Promise<object>}
 */
export async function getKeepitMarker(projectId, sessionId, markerId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/keepits/${encodeURIComponent(markerId)}`
  );
  return handleResponse(response, 'Failed to fetch keepit marker');
}

/**
 * Update a keepit marker's weight
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {string} markerId - The marker ID
 * @param {number} weight - New weight (0.00-1.00)
 * @param {object} options - Optional options
 * @param {boolean} [options.createBackup=true] - Create backup before modifying
 * @returns {Promise<object>}
 */
export async function updateKeepitWeight(projectId, sessionId, markerId, weight, options = {}) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/keepits/${encodeURIComponent(markerId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weight,
        createBackup: options.createBackup !== false
      })
    }
  );
  return handleResponse(response, 'Failed to update keepit weight');
}

/**
 * Delete a keepit marker
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {string} markerId - The marker ID
 * @param {object} options - Optional options
 * @param {boolean} [options.createBackup=true] - Create backup before modifying
 * @returns {Promise<object>}
 */
export async function deleteKeepitMarker(projectId, sessionId, markerId, options = {}) {
  const params = new URLSearchParams();
  if (options.createBackup === false) {
    params.set('createBackup', 'false');
  }
  const queryString = params.toString();
  const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/keepits/${encodeURIComponent(markerId)}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(url, { method: 'DELETE' });
  return handleResponse(response, 'Failed to delete keepit marker');
}

/**
 * Add a new keepit marker
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {string} messageUuid - The message UUID
 * @param {string} content - Content to mark
 * @param {number} weight - Weight (0.00-1.00)
 * @param {object} options - Optional options
 * @param {boolean} [options.createBackup=true] - Create backup before modifying
 * @returns {Promise<object>}
 */
export async function addKeepitMarker(projectId, sessionId, messageUuid, content, weight, options = {}) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/keepits`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageUuid,
        content,
        weight,
        createBackup: options.createBackup !== false
      })
    }
  );
  return handleResponse(response, 'Failed to add keepit marker');
}

/**
 * Preview which keepits will survive/decay with given settings
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @param {object} settings - Preview settings
 * @param {number} [settings.compressionRatio=10] - Compression ratio
 * @param {number} [settings.sessionDistance=0] - Session distance
 * @param {string} [settings.aggressiveness] - Aggressiveness level
 * @returns {Promise<object>}
 */
export async function previewDecay(projectId, sessionId, settings = {}) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/keepits/decay-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    }
  );
  return handleResponse(response, 'Failed to preview decay');
}

/**
 * Analyze keepit survival across compression scenarios
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {Promise<object>}
 */
export async function analyzeKeepitSurvival(projectId, sessionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/keepits/analyze`,
    { method: 'POST' }
  );
  return handleResponse(response, 'Failed to analyze keepit survival');
}

/**
 * Explain decay calculation for a weight
 * @param {number} weight - The weight value
 * @param {object} settings - Decay settings
 * @returns {Promise<object>}
 */
export async function explainDecay(weight, settings = {}) {
  const response = await fetch(`${API_BASE}/decay/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weight, ...settings })
  });
  return handleResponse(response, 'Failed to explain decay');
}

// ============================================
// Composition Endpoints
// ============================================

/**
 * Get available composition allocation strategies
 * @returns {Promise<{strategies: object}>}
 */
export async function getCompositionStrategies() {
  const response = await fetch(`${API_BASE}/composition/strategies`);
  return handleResponse(response, 'Failed to fetch composition strategies');
}

/**
 * List compositions for a project
 * @param {string} projectId - The project ID
 * @returns {Promise<Array>}
 */
export async function getCompositions(projectId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/compositions`
  );
  return handleResponse(response, 'Failed to fetch compositions');
}

/**
 * Create a new composition
 * @param {string} projectId - The project ID
 * @param {object} request - Composition request
 * @param {string} request.name - Composition name
 * @param {Array} request.components - Session components
 * @param {number} request.totalTokenBudget - Total token budget
 * @param {string} [request.allocationStrategy] - Allocation strategy
 * @returns {Promise<object>}
 */
export async function createComposition(projectId, request) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/compositions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    }
  );
  return handleResponse(response, 'Failed to create composition');
}

/**
 * Preview a composition without creating it
 * @param {string} projectId - The project ID
 * @param {object} request - Composition request
 * @returns {Promise<object>}
 */
export async function previewComposition(projectId, request) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/compositions/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    }
  );
  return handleResponse(response, 'Failed to preview composition');
}

/**
 * Get allocation suggestions for sessions
 * @param {string} projectId - The project ID
 * @param {string[]} sessionIds - Session IDs
 * @param {number} totalTokenBudget - Total budget
 * @returns {Promise<object>}
 */
export async function suggestAllocation(projectId, sessionIds, totalTokenBudget) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/compositions/suggest-allocation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds, totalTokenBudget })
    }
  );
  return handleResponse(response, 'Failed to get allocation suggestion');
}

/**
 * Get composition details
 * @param {string} projectId - The project ID
 * @param {string} compositionId - The composition ID
 * @returns {Promise<object>}
 */
export async function getComposition(projectId, compositionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/compositions/${encodeURIComponent(compositionId)}`
  );
  return handleResponse(response, 'Failed to fetch composition');
}

/**
 * Get composition content
 * @param {string} projectId - The project ID
 * @param {string} compositionId - The composition ID
 * @param {string} [format='md'] - Output format ('md', 'jsonl', or 'metadata')
 * @returns {Promise<string>}
 */
export async function getCompositionContent(projectId, compositionId, format = 'md') {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/compositions/${encodeURIComponent(compositionId)}/content?format=${format}`
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error = new Error(errorData.error || 'Failed to fetch composition content');
    error.code = errorData.code;
    throw error;
  }
  return response.text();
}

/**
 * Delete a composition
 * @param {string} projectId - The project ID
 * @param {string} compositionId - The composition ID
 * @returns {Promise<object>}
 */
export async function deleteComposition(projectId, compositionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/compositions/${encodeURIComponent(compositionId)}`,
    { method: 'DELETE' }
  );
  return handleResponse(response, 'Failed to delete composition');
}

// ============================================
// Statistics Endpoints
// ============================================

/**
 * Get global memory system statistics
 * @returns {Promise<object>}
 */
export async function getGlobalStats() {
  const response = await fetch(`${API_BASE}/stats`);
  return handleResponse(response, 'Failed to fetch global stats');
}

/**
 * Get session statistics
 * @param {string} projectId - The project ID
 * @param {string} sessionId - The session ID
 * @returns {Promise<object>}
 */
export async function getSessionStats(projectId, sessionId) {
  const response = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/statistics`
  );
  return handleResponse(response, 'Failed to fetch session statistics');
}

/**
 * Get cache statistics
 * @returns {Promise<object>}
 */
export async function getCacheStats() {
  const response = await fetch(`${API_BASE}/cache/stats`);
  return handleResponse(response, 'Failed to fetch cache stats');
}

/**
 * Clear the cache
 * @returns {Promise<object>}
 */
export async function clearCache() {
  const response = await fetch(`${API_BASE}/cache/clear`, {
    method: 'POST'
  });
  return handleResponse(response, 'Failed to clear cache');
}

// ============================================
// Lock Management Endpoints
// ============================================

/**
 * Get current lock status
 * @returns {Promise<object>}
 */
export async function getLockStatus() {
  const response = await fetch(`${API_BASE}/locks`);
  return handleResponse(response, 'Failed to fetch lock status');
}

/**
 * Force cleanup of stale locks
 * @returns {Promise<object>}
 */
export async function cleanupStaleLocks() {
  const response = await fetch(`${API_BASE}/locks/cleanup`, {
    method: 'POST'
  });
  return handleResponse(response, 'Failed to cleanup locks');
}

// ============================================
// Export/Import Endpoints
// ============================================

/**
 * Export a project as ZIP
 * @param {string} projectId - The project ID
 * @param {object} options - Export options
 * @param {boolean} [options.includeOriginals=false] - Include original sessions
 * @param {boolean} [options.includeSummaries=true] - Include summaries
 * @param {boolean} [options.includeComposed=true] - Include compositions
 * @returns {Promise<Blob>}
 */
export async function exportProject(projectId, options = {}) {
  const params = new URLSearchParams();
  if (options.includeOriginals) params.set('includeOriginals', 'true');
  if (options.includeSummaries === false) params.set('includeSummaries', 'false');
  if (options.includeComposed === false) params.set('includeComposed', 'false');

  const queryString = params.toString();
  const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/export${queryString ? '?' + queryString : ''}`;

  const response = await fetch(url);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error = new Error(errorData.error || 'Failed to export project');
    error.code = errorData.code;
    throw error;
  }

  return {
    blob: await response.blob(),
    metadata: JSON.parse(response.headers.get('X-Export-Metadata') || '{}'),
    filename: response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `${projectId}-export.zip`
  };
}

/**
 * Import a project from ZIP
 * @param {string} projectId - The project ID
 * @param {File|Blob} file - ZIP file to import
 * @param {object} options - Import options
 * @param {string} [options.mode='merge'] - Import mode ('merge' or 'replace')
 * @returns {Promise<object>}
 */
export async function importProject(projectId, file, options = {}) {
  const formData = new FormData();
  formData.append('file', file);

  const params = new URLSearchParams();
  if (options.mode) params.set('mode', options.mode);

  const queryString = params.toString();
  const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/import${queryString ? '?' + queryString : ''}`;

  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });
  return handleResponse(response, 'Failed to import project');
}
