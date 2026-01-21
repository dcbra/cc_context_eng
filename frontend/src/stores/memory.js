/**
 * Memory System Pinia Store
 *
 * Manages state for the memory system including:
 * - Projects and their metadata
 * - Sessions and registration
 * - Compression versions
 * - Keepit markers
 * - Compositions
 * - Loading states and error handling
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import * as memoryApi from '../utils/memory-api.js';

export const useMemoryStore = defineStore('memory', () => {
  // ============================================
  // State
  // ============================================

  // System state
  const initialized = ref(false);
  const config = ref(null);

  // Project state
  const projects = ref([]);
  const currentProject = ref(null);

  // Session state
  const sessions = ref([]);
  const currentSession = ref(null);
  const unregisteredSessions = ref([]);

  // Sync state - tracks which sessions have new messages available
  const syncStatus = ref({}); // Map of sessionId -> { hasNewMessages, newCount, lastSynced }

  // Compression version state
  const versions = ref([]);
  const currentVersion = ref(null);
  const compressionPresets = ref(null);

  // Keepit state
  const keepits = ref([]);
  const keepitPresets = ref(null);
  const decayPreview = ref(null);

  // Composition state
  const compositions = ref([]);
  const currentComposition = ref(null);
  const compositionStrategies = ref(null);

  // Statistics state
  const globalStats = ref(null);
  const projectStats = ref(null);
  const sessionStats = ref(null);

  // Loading states
  const loading = ref({
    status: false,
    projects: false,
    project: false,
    sessions: false,
    session: false,
    versions: false,
    version: false,
    compression: false,
    keepits: false,
    compositions: false,
    composition: false,
    stats: false,
    export: false,
    import: false,
    sync: false
  });

  // Error state
  const error = ref(null);

  // ============================================
  // Getters (Computed)
  // ============================================

  const hasProjects = computed(() => projects.value.length > 0);
  const hasSessions = computed(() => sessions.value.length > 0);
  const hasVersions = computed(() => versions.value.length > 0);
  const hasCompositions = computed(() => compositions.value.length > 0);

  const currentProjectId = computed(() => currentProject.value?.projectId || null);
  const currentSessionId = computed(() => currentSession.value?.sessionId || null);

  const registeredSessionCount = computed(() => sessions.value.length);
  const unregisteredSessionCount = computed(() => unregisteredSessions.value.length);

  const currentSessionVersions = computed(() => {
    if (!currentSession.value) return [];
    return versions.value;
  });

  const currentSessionKeepits = computed(() => {
    if (!currentSession.value) return [];
    return keepits.value;
  });

  const isLoading = computed(() => Object.values(loading.value).some(v => v));

  const isCompressionInProgress = computed(() => loading.value.compression);

  // ============================================
  // Internal Helpers
  // ============================================

  function setError(err) {
    error.value = {
      message: err.message || 'An error occurred',
      code: err.code || 'UNKNOWN_ERROR',
      details: err.details || null
    };
    console.error('Memory store error:', error.value);
  }

  function clearError() {
    error.value = null;
  }

  // ============================================
  // System Actions
  // ============================================

  /**
   * Check memory system status
   */
  async function checkStatus() {
    loading.value.status = true;
    clearError();
    try {
      const status = await memoryApi.getMemoryStatus();
      initialized.value = status.initialized;
      return status;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.status = false;
    }
  }

  /**
   * Initialize the memory system
   */
  async function initialize() {
    loading.value.status = true;
    clearError();
    try {
      const result = await memoryApi.initializeMemory();
      initialized.value = true;
      config.value = result.config;
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.status = false;
    }
  }

  /**
   * Load global configuration
   */
  async function loadConfig() {
    loading.value.status = true;
    clearError();
    try {
      config.value = await memoryApi.getMemoryConfig();
      return config.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.status = false;
    }
  }

  /**
   * Update global configuration
   */
  async function updateConfig(updates) {
    loading.value.status = true;
    clearError();
    try {
      config.value = await memoryApi.updateMemoryConfig(updates);
      return config.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.status = false;
    }
  }

  // ============================================
  // Project Actions
  // ============================================

  /**
   * Load all memory projects
   */
  async function loadProjects() {
    loading.value.projects = true;
    clearError();
    try {
      projects.value = await memoryApi.getMemoryProjects();
      return projects.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.projects = false;
    }
  }

  /**
   * Load a specific project with full details
   */
  async function loadProject(projectId) {
    loading.value.project = true;
    clearError();
    try {
      currentProject.value = await memoryApi.getMemoryProject(projectId);
      return currentProject.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.project = false;
    }
  }

  /**
   * Set current project (without loading)
   */
  function setCurrentProject(project) {
    currentProject.value = project;
    // Clear session-related state when project changes
    sessions.value = [];
    currentSession.value = null;
    versions.value = [];
    keepits.value = [];
    compositions.value = [];
  }

  /**
   * Clear current project
   */
  function clearCurrentProject() {
    currentProject.value = null;
    sessions.value = [];
    currentSession.value = null;
    versions.value = [];
    keepits.value = [];
    compositions.value = [];
    unregisteredSessions.value = [];
  }

  /**
   * Load project statistics
   */
  async function loadProjectStats(projectId) {
    loading.value.stats = true;
    clearError();
    try {
      projectStats.value = await memoryApi.getProjectStatistics(projectId);
      return projectStats.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.stats = false;
    }
  }

  // ============================================
  // Session Actions
  // ============================================

  /**
   * Load sessions for current project
   */
  async function loadSessions(projectId = null) {
    const pid = projectId || currentProjectId.value;
    if (!pid) {
      throw new Error('No project selected');
    }

    loading.value.sessions = true;
    clearError();
    try {
      sessions.value = await memoryApi.getProjectSessions(pid);
      return sessions.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.sessions = false;
    }
  }

  /**
   * Load session details
   */
  async function loadSession(projectId, sessionId) {
    loading.value.session = true;
    clearError();
    try {
      currentSession.value = await memoryApi.getSessionDetails(projectId, sessionId);
      return currentSession.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.session = false;
    }
  }

  /**
   * Set current session (without loading)
   */
  function setCurrentSession(session) {
    currentSession.value = session;
    // Clear session-specific state
    versions.value = [];
    currentVersion.value = null;
    keepits.value = [];
    decayPreview.value = null;
  }

  /**
   * Clear current session
   */
  function clearCurrentSession() {
    currentSession.value = null;
    versions.value = [];
    currentVersion.value = null;
    keepits.value = [];
    decayPreview.value = null;
  }

  /**
   * Register a session in the memory system
   */
  async function registerSession(projectId, sessionId, options = {}) {
    loading.value.sessions = true;
    clearError();
    try {
      const session = await memoryApi.registerSession(projectId, sessionId, options);

      // Update local state
      sessions.value.push(session);

      // Update project session count if we have the project loaded
      const project = projects.value.find(p => p.projectId === projectId);
      if (project) {
        project.sessionCount = (project.sessionCount || 0) + 1;
      }

      // Remove from unregistered list
      const idx = unregisteredSessions.value.findIndex(s => s.sessionId === sessionId);
      if (idx !== -1) {
        unregisteredSessions.value.splice(idx, 1);
      }

      return session;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.sessions = false;
    }
  }

  /**
   * Unregister a session from the memory system
   */
  async function unregisterSession(projectId, sessionId, options = {}) {
    loading.value.sessions = true;
    clearError();
    try {
      const result = await memoryApi.unregisterSession(projectId, sessionId, options);

      // Update local state
      const idx = sessions.value.findIndex(s => s.sessionId === sessionId);
      if (idx !== -1) {
        sessions.value.splice(idx, 1);
      }

      // Update project session count
      const project = projects.value.find(p => p.projectId === projectId);
      if (project && project.sessionCount > 0) {
        project.sessionCount--;
      }

      // Clear current session if it was unregistered
      if (currentSession.value?.sessionId === sessionId) {
        clearCurrentSession();
      }

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.sessions = false;
    }
  }

  /**
   * Batch register multiple sessions
   */
  async function batchRegisterSessions(projectId, sessionIds) {
    loading.value.sessions = true;
    clearError();
    try {
      const result = await memoryApi.batchRegisterSessions(projectId, sessionIds);

      // Update local state with successful registrations
      for (const item of result.successful) {
        sessions.value.push(item.entry);
      }

      // Update project session count
      const project = projects.value.find(p => p.projectId === projectId);
      if (project) {
        project.sessionCount = (project.sessionCount || 0) + result.successful.length;
      }

      // Remove successful from unregistered
      const successIds = new Set(result.successful.map(s => s.sessionId));
      unregisteredSessions.value = unregisteredSessions.value.filter(
        s => !successIds.has(s.sessionId)
      );

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.sessions = false;
    }
  }

  /**
   * Find unregistered sessions for a project
   */
  async function findUnregisteredSessions(projectId = null) {
    const pid = projectId || currentProjectId.value;
    if (!pid) {
      throw new Error('No project selected');
    }

    loading.value.sessions = true;
    clearError();
    try {
      unregisteredSessions.value = await memoryApi.findUnregisteredSessions(pid);
      return unregisteredSessions.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.sessions = false;
    }
  }

  /**
   * Refresh session metadata
   */
  async function refreshSession(projectId, sessionId) {
    loading.value.session = true;
    clearError();
    try {
      const session = await memoryApi.refreshSession(projectId, sessionId);

      // Update local state
      const idx = sessions.value.findIndex(s => s.sessionId === sessionId);
      if (idx !== -1) {
        sessions.value[idx] = { ...sessions.value[idx], ...session };
      }

      if (currentSession.value?.sessionId === sessionId) {
        currentSession.value = { ...currentSession.value, ...session };
      }

      return session;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.session = false;
    }
  }

  // ============================================
  // Session Sync Actions
  // ============================================

  /**
   * Check sync status for a session
   */
  async function checkSyncStatus(projectId, sessionId) {
    loading.value.sync = true;
    clearError();
    try {
      const status = await memoryApi.getSyncStatus(projectId, sessionId);

      // Update sync status map
      syncStatus.value[sessionId] = {
        hasNewMessages: status.hasNewMessages,
        newCount: status.newCount,
        lastSynced: status.lastSynced,
        originalExists: status.originalExists
      };

      return status;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.sync = false;
    }
  }

  /**
   * Check sync status for all sessions in the current project
   */
  async function checkAllSyncStatus(projectId = null) {
    const pid = projectId || currentProjectId.value;
    if (!pid) {
      throw new Error('No project selected');
    }

    loading.value.sync = true;
    clearError();
    try {
      // Check sync status for each session in parallel
      const results = await Promise.all(
        sessions.value.map(session =>
          memoryApi.getSyncStatus(pid, session.sessionId)
            .then(status => ({ sessionId: session.sessionId, status }))
            .catch(() => ({ sessionId: session.sessionId, status: null }))
        )
      );

      // Update sync status map
      for (const result of results) {
        if (result.status) {
          syncStatus.value[result.sessionId] = {
            hasNewMessages: result.status.hasNewMessages,
            newCount: result.status.newCount,
            lastSynced: result.status.lastSynced,
            originalExists: result.status.originalExists
          };
        }
      }

      return syncStatus.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.sync = false;
    }
  }

  /**
   * Sync a session - append new messages from original
   */
  async function syncSession(projectId, sessionId) {
    loading.value.sync = true;
    clearError();
    try {
      const result = await memoryApi.syncSession(projectId, sessionId);

      // Update session in local state
      const idx = sessions.value.findIndex(s => s.sessionId === sessionId);
      if (idx !== -1) {
        sessions.value[idx] = {
          ...sessions.value[idx],
          lastSyncedTimestamp: result.newLastTimestamp,
          lastSyncedMessageUuid: result.newLastMessageUuid,
          messageCount: result.newMessageCount,
          originalMessages: result.newMessageCount
        };
      }

      if (currentSession.value?.sessionId === sessionId) {
        currentSession.value = {
          ...currentSession.value,
          lastSyncedTimestamp: result.newLastTimestamp,
          lastSyncedMessageUuid: result.newLastMessageUuid,
          messageCount: result.newMessageCount,
          originalMessages: result.newMessageCount
        };
      }

      // Clear sync status for this session (it's now up to date)
      syncStatus.value[sessionId] = {
        hasNewMessages: false,
        newCount: 0,
        lastSynced: result.newLastTimestamp,
        originalExists: true
      };

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.sync = false;
    }
  }

  /**
   * Clear sync status for all sessions
   */
  function clearSyncStatus() {
    syncStatus.value = {};
  }

  // ============================================
  // Compression Version Actions
  // ============================================

  /**
   * Load compression presets
   */
  async function loadCompressionPresets() {
    clearError();
    try {
      compressionPresets.value = await memoryApi.getCompressionPresets();
      return compressionPresets.value;
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  /**
   * Load compression versions for a session
   */
  async function loadVersions(projectId, sessionId) {
    loading.value.versions = true;
    clearError();
    try {
      versions.value = await memoryApi.getSessionVersions(projectId, sessionId);
      return versions.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.versions = false;
    }
  }

  /**
   * Create a new compression version
   */
  async function createCompressionVersion(projectId, sessionId, settings) {
    loading.value.compression = true;
    clearError();
    try {
      const version = await memoryApi.createCompressionVersion(projectId, sessionId, settings);

      // Add to local versions list
      versions.value.push(version);

      // Update session compression count
      const session = sessions.value.find(s => s.sessionId === sessionId);
      if (session) {
        session.compressionCount = (session.compressionCount || 0) + 1;
      }

      return version;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.compression = false;
    }
  }

  /**
   * Load a specific compression version
   */
  async function loadVersion(projectId, sessionId, versionId) {
    loading.value.version = true;
    clearError();
    try {
      currentVersion.value = await memoryApi.getCompressionVersion(projectId, sessionId, versionId);
      return currentVersion.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.version = false;
    }
  }

  /**
   * Get version content
   */
  async function getVersionContent(projectId, sessionId, versionId, format = 'md') {
    clearError();
    try {
      return await memoryApi.getVersionContent(projectId, sessionId, versionId, format);
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  /**
   * Delete a compression version
   */
  async function deleteVersion(projectId, sessionId, versionId, options = {}) {
    loading.value.versions = true;
    clearError();
    try {
      const result = await memoryApi.deleteCompressionVersion(projectId, sessionId, versionId, options);

      // Remove from local state
      const idx = versions.value.findIndex(v => v.versionId === versionId);
      if (idx !== -1) {
        versions.value.splice(idx, 1);
      }

      // Update session compression count
      const session = sessions.value.find(s => s.sessionId === sessionId);
      if (session && session.compressionCount > 0) {
        session.compressionCount--;
      }

      // Clear current version if it was deleted
      if (currentVersion.value?.versionId === versionId) {
        currentVersion.value = null;
      }

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.versions = false;
    }
  }

  /**
   * Validate compression settings
   */
  async function validateCompressionSettings(projectId, sessionId, settings) {
    clearError();
    try {
      return await memoryApi.validateCompressionSettings(projectId, sessionId, settings);
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  // ============================================
  // Keepit Actions
  // ============================================

  /**
   * Load keepit presets
   */
  async function loadKeepitPresets() {
    clearError();
    try {
      keepitPresets.value = await memoryApi.getKeepitPresets();
      return keepitPresets.value;
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  /**
   * Load keepit markers for a session
   */
  async function loadKeepits(projectId, sessionId) {
    loading.value.keepits = true;
    clearError();
    try {
      keepits.value = await memoryApi.getSessionKeepits(projectId, sessionId);
      return keepits.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.keepits = false;
    }
  }

  /**
   * Update keepit marker weight
   */
  async function updateKeepitWeight(projectId, sessionId, markerId, weight, options = {}) {
    loading.value.keepits = true;
    clearError();
    try {
      const result = await memoryApi.updateKeepitWeight(projectId, sessionId, markerId, weight, options);

      // Update local state
      const idx = keepits.value.findIndex(k => k.id === markerId);
      if (idx !== -1) {
        keepits.value[idx] = { ...keepits.value[idx], weight: result.newWeight || weight };
      }

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.keepits = false;
    }
  }

  /**
   * Delete a keepit marker
   */
  async function deleteKeepit(projectId, sessionId, markerId, options = {}) {
    loading.value.keepits = true;
    clearError();
    try {
      const result = await memoryApi.deleteKeepitMarker(projectId, sessionId, markerId, options);

      // Remove from local state
      const idx = keepits.value.findIndex(k => k.id === markerId);
      if (idx !== -1) {
        keepits.value.splice(idx, 1);
      }

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.keepits = false;
    }
  }

  /**
   * Add a new keepit marker
   */
  async function addKeepit(projectId, sessionId, messageUuid, content, weight, options = {}) {
    loading.value.keepits = true;
    clearError();
    try {
      const result = await memoryApi.addKeepitMarker(projectId, sessionId, messageUuid, content, weight, options);

      // Add to local state
      if (result.marker) {
        keepits.value.push(result.marker);
      }

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.keepits = false;
    }
  }

  /**
   * Preview decay for keepit markers
   */
  async function previewKeepitDecay(projectId, sessionId, settings = {}) {
    clearError();
    try {
      decayPreview.value = await memoryApi.previewDecay(projectId, sessionId, settings);
      return decayPreview.value;
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  /**
   * Analyze keepit survival
   */
  async function analyzeKeepitSurvival(projectId, sessionId) {
    clearError();
    try {
      return await memoryApi.analyzeKeepitSurvival(projectId, sessionId);
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  // ============================================
  // Composition Actions
  // ============================================

  /**
   * Load composition strategies
   */
  async function loadCompositionStrategies() {
    clearError();
    try {
      compositionStrategies.value = await memoryApi.getCompositionStrategies();
      return compositionStrategies.value;
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  /**
   * Load compositions for a project
   */
  async function loadCompositions(projectId = null) {
    const pid = projectId || currentProjectId.value;
    if (!pid) {
      throw new Error('No project selected');
    }

    loading.value.compositions = true;
    clearError();
    try {
      compositions.value = await memoryApi.getCompositions(pid);
      return compositions.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.compositions = false;
    }
  }

  /**
   * Create a new composition
   */
  async function createComposition(projectId, request) {
    loading.value.composition = true;
    clearError();
    try {
      const composition = await memoryApi.createComposition(projectId, request);

      // Add to local state
      compositions.value.push(composition);

      return composition;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.composition = false;
    }
  }

  /**
   * Load a specific composition
   */
  async function loadComposition(projectId, compositionId) {
    loading.value.composition = true;
    clearError();
    try {
      currentComposition.value = await memoryApi.getComposition(projectId, compositionId);
      return currentComposition.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.composition = false;
    }
  }

  /**
   * Preview a composition
   */
  async function previewComposition(projectId, request) {
    clearError();
    try {
      return await memoryApi.previewComposition(projectId, request);
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  /**
   * Get allocation suggestions
   */
  async function suggestAllocation(projectId, sessionIds, totalTokenBudget) {
    clearError();
    try {
      return await memoryApi.suggestAllocation(projectId, sessionIds, totalTokenBudget);
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  /**
   * Get composition content
   */
  async function getCompositionContent(projectId, compositionId, format = 'md') {
    clearError();
    try {
      return await memoryApi.getCompositionContent(projectId, compositionId, format);
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  /**
   * Delete a composition
   */
  async function deleteComposition(projectId, compositionId) {
    loading.value.compositions = true;
    clearError();
    try {
      const result = await memoryApi.deleteComposition(projectId, compositionId);

      // Remove from local state
      const idx = compositions.value.findIndex(c => c.id === compositionId);
      if (idx !== -1) {
        compositions.value.splice(idx, 1);
      }

      // Clear current composition if it was deleted
      if (currentComposition.value?.id === compositionId) {
        currentComposition.value = null;
      }

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.compositions = false;
    }
  }

  // ============================================
  // Statistics Actions
  // ============================================

  /**
   * Load global statistics
   */
  async function loadGlobalStats() {
    loading.value.stats = true;
    clearError();
    try {
      globalStats.value = await memoryApi.getGlobalStats();
      return globalStats.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.stats = false;
    }
  }

  /**
   * Load session statistics
   */
  async function loadSessionStats(projectId, sessionId) {
    loading.value.stats = true;
    clearError();
    try {
      sessionStats.value = await memoryApi.getSessionStats(projectId, sessionId);
      return sessionStats.value;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.stats = false;
    }
  }

  // ============================================
  // Export/Import Actions
  // ============================================

  /**
   * Export a project
   */
  async function exportProject(projectId, options = {}) {
    loading.value.export = true;
    clearError();
    try {
      return await memoryApi.exportProject(projectId, options);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.export = false;
    }
  }

  /**
   * Import a project
   */
  async function importProject(projectId, file, options = {}) {
    loading.value.import = true;
    clearError();
    try {
      const result = await memoryApi.importProject(projectId, file, options);

      // Reload project data after import
      await loadProject(projectId);
      await loadSessions(projectId);

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      loading.value.import = false;
    }
  }

  // ============================================
  // Reset Actions
  // ============================================

  /**
   * Reset all store state
   */
  function reset() {
    initialized.value = false;
    config.value = null;
    projects.value = [];
    currentProject.value = null;
    sessions.value = [];
    currentSession.value = null;
    unregisteredSessions.value = [];
    syncStatus.value = {};
    versions.value = [];
    currentVersion.value = null;
    compressionPresets.value = null;
    keepits.value = [];
    keepitPresets.value = null;
    decayPreview.value = null;
    compositions.value = [];
    currentComposition.value = null;
    compositionStrategies.value = null;
    globalStats.value = null;
    projectStats.value = null;
    sessionStats.value = null;
    error.value = null;

    // Reset loading states
    Object.keys(loading.value).forEach(key => {
      loading.value[key] = false;
    });
  }

  // ============================================
  // Return Public API
  // ============================================

  return {
    // State
    initialized,
    config,
    projects,
    currentProject,
    sessions,
    currentSession,
    unregisteredSessions,
    syncStatus,
    versions,
    currentVersion,
    compressionPresets,
    keepits,
    keepitPresets,
    decayPreview,
    compositions,
    currentComposition,
    compositionStrategies,
    globalStats,
    projectStats,
    sessionStats,
    loading,
    error,

    // Computed
    hasProjects,
    hasSessions,
    hasVersions,
    hasCompositions,
    currentProjectId,
    currentSessionId,
    registeredSessionCount,
    unregisteredSessionCount,
    currentSessionVersions,
    currentSessionKeepits,
    isLoading,
    isCompressionInProgress,

    // System actions
    checkStatus,
    initialize,
    loadConfig,
    updateConfig,

    // Project actions
    loadProjects,
    loadProject,
    setCurrentProject,
    clearCurrentProject,
    loadProjectStats,

    // Session actions
    loadSessions,
    loadSession,
    setCurrentSession,
    clearCurrentSession,
    registerSession,
    unregisterSession,
    batchRegisterSessions,
    findUnregisteredSessions,
    refreshSession,

    // Sync actions
    checkSyncStatus,
    checkAllSyncStatus,
    syncSession,
    clearSyncStatus,

    // Version actions
    loadCompressionPresets,
    loadVersions,
    createCompressionVersion,
    loadVersion,
    getVersionContent,
    deleteVersion,
    validateCompressionSettings,

    // Keepit actions
    loadKeepitPresets,
    loadKeepits,
    updateKeepitWeight,
    deleteKeepit,
    addKeepit,
    previewKeepitDecay,
    analyzeKeepitSurvival,

    // Composition actions
    loadCompositionStrategies,
    loadCompositions,
    createComposition,
    loadComposition,
    previewComposition,
    suggestAllocation,
    getCompositionContent,
    deleteComposition,

    // Statistics actions
    loadGlobalStats,
    loadSessionStats,

    // Export/Import actions
    exportProject,
    importProject,

    // Reset
    reset,
    clearError
  };
});
