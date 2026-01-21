<template>
  <div class="memory-browser">
    <!-- Header -->
    <div class="browser-header">
      <div class="header-left">
        <h2>Memory Browser</h2>
        <span v-if="initialized" class="status-badge initialized">System Ready</span>
        <span v-else class="status-badge not-initialized">Not Initialized</span>
      </div>
      <div class="header-actions">
        <button @click="showSettings = true" class="btn-icon" title="Settings">
          <span class="icon">&#9881;</span>
        </button>
        <button @click="refresh" class="btn-secondary" :disabled="loading.projects">
          {{ loading.projects ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <!-- Initialize prompt -->
    <div v-if="!initialized && !loading.status" class="initialize-section">
      <div class="initialize-card">
        <h3>Memory System Not Initialized</h3>
        <p>Initialize the memory system to start tracking session compressions and keepit markers.</p>
        <button @click="initializeSystem" class="btn-primary" :disabled="loading.status">
          Initialize Memory System
        </button>
      </div>
    </div>

    <!-- Main content -->
    <div v-else-if="initialized" class="browser-content">
      <!-- Breadcrumb navigation -->
      <div class="breadcrumb">
        <span class="breadcrumb-item" :class="{ active: !currentProject }" @click="clearSelection">
          Projects
        </span>
        <template v-if="currentProject">
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-item" :class="{ active: currentProject && !currentSession }" @click="clearSession">
            {{ currentProject.displayName || currentProject.projectId }}
          </span>
        </template>
        <template v-if="currentSession">
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-item active">
            {{ currentSession.fileName || currentSession.sessionId }}
          </span>
        </template>
      </div>

      <!-- Project List View -->
      <div v-if="!currentProject" class="project-list">
        <div v-if="loading.projects" class="loading-state">
          <div class="spinner"></div>
          <span>Loading projects...</span>
        </div>

        <div v-else-if="projects.length === 0" class="empty-state">
          <div class="empty-icon">&#128193;</div>
          <h3>No Projects Found</h3>
          <p>Register sessions from the Session Editor to see them here.</p>
        </div>

        <div v-else class="projects-grid">
          <div
            v-for="project in projects"
            :key="project.projectId"
            class="project-card"
            @click="selectProject(project)"
          >
            <div class="project-name">{{ project.displayName || project.projectId }}</div>
            <div class="project-stats">
              <span class="stat">
                <span class="stat-value">{{ project.sessionCount || 0 }}</span>
                <span class="stat-label">sessions</span>
              </span>
              <span class="stat">
                <span class="stat-value">{{ project.versionCount || 0 }}</span>
                <span class="stat-label">versions</span>
              </span>
            </div>
            <div v-if="project.lastAccessed" class="project-meta">
              Last accessed: {{ formatDate(project.lastAccessed) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Session List View -->
      <div v-else-if="currentProject && !currentSession" class="session-view">
        <SessionList
          :projectId="currentProject.projectId"
          :sessions="sessions"
          :unregisteredSessions="unregisteredSessions"
          :loading="loading.sessions"
          @select="selectSession"
          @register="handleRegister"
          @unregister="handleUnregister"
        />

        <!-- Actions panel -->
        <div class="actions-panel">
          <button @click="findUnregistered" class="btn-secondary" :disabled="loading.sessions">
            Find Unregistered Sessions
          </button>
          <button @click="showCompositionBuilder = true" class="btn-primary" :disabled="sessions.length === 0">
            Create Composition
          </button>
        </div>
      </div>

      <!-- Session Details View -->
      <div v-else-if="currentSession" class="session-details-view">
        <SessionDetails
          :projectId="currentProject.projectId"
          :sessionId="currentSession.sessionId"
          :session="currentSession"
          :versions="versions"
          :keepits="keepits"
          :loading="loading"
          @back="clearSession"
          @refresh="refreshCurrentSession"
          @create-version="showCreateCompressionDialog = true"
          @view-version="handleViewVersion"
          @delete-version="handleDeleteVersion"
          @view-original="handleViewOriginal"
        />
      </div>
    </div>

    <!-- Error display -->
    <div v-if="error" class="error-banner">
      <span class="error-icon">&#9888;</span>
      <span class="error-message">{{ error.message || error }}</span>
      <button @click="clearError" class="btn-close">&times;</button>
    </div>

    <!-- Settings Dialog -->
    <MemorySettingsDialog
      v-if="showSettings"
      @close="showSettings = false"
      @saved="handleSettingsSaved"
    />

    <!-- Composition Builder Dialog -->
    <CompositionBuilder
      v-if="showCompositionBuilder && currentProject"
      :projectId="currentProject.projectId"
      :sessions="sessions"
      @close="showCompositionBuilder = false"
      @created="handleCompositionCreated"
    />

    <!-- Create Compression Dialog -->
    <CreateCompressionDialog
      v-if="showCreateCompressionDialog && currentProject && currentSession"
      :projectId="currentProject.projectId"
      :sessionId="currentSession.sessionId"
      @close="showCreateCompressionDialog = false"
      @created="handleCompressionCreated"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useMemoryStore } from '../../stores/memory.js';
import SessionList from './SessionList.vue';
import SessionDetails from './SessionDetails.vue';
import CompositionBuilder from './CompositionBuilder.vue';
import CreateCompressionDialog from './CreateCompressionDialog.vue';
import MemorySettingsDialog from './MemorySettingsDialog.vue';

const emit = defineEmits(['navigate-to-session']);

const memoryStore = useMemoryStore();

// Local state
const showSettings = ref(false);
const showCompositionBuilder = ref(false);
const showCreateCompressionDialog = ref(false);

// Store state bindings
const initialized = computed(() => memoryStore.initialized);
const projects = computed(() => memoryStore.projects);
const currentProject = computed(() => memoryStore.currentProject);
const currentSession = computed(() => memoryStore.currentSession);
const sessions = computed(() => memoryStore.sessions);
const unregisteredSessions = computed(() => memoryStore.unregisteredSessions);
const versions = computed(() => memoryStore.versions);
const keepits = computed(() => memoryStore.keepits);
const loading = computed(() => memoryStore.loading);
const error = computed(() => memoryStore.error);

// Lifecycle
onMounted(async () => {
  await checkAndLoadStatus();
});

// Methods
async function checkAndLoadStatus() {
  try {
    await memoryStore.checkStatus();
    if (memoryStore.initialized) {
      await memoryStore.loadProjects();
    }
  } catch (err) {
    console.error('Failed to check memory status:', err);
  }
}

async function initializeSystem() {
  try {
    await memoryStore.initialize();
    await memoryStore.loadProjects();
  } catch (err) {
    console.error('Failed to initialize memory system:', err);
  }
}

async function refresh() {
  try {
    if (currentProject.value && currentSession.value) {
      await memoryStore.loadSession(currentProject.value.projectId, currentSession.value.sessionId);
    } else if (currentProject.value) {
      await memoryStore.loadSessions(currentProject.value.projectId);
    } else {
      await memoryStore.loadProjects();
    }
  } catch (err) {
    console.error('Refresh failed:', err);
  }
}

async function selectProject(project) {
  memoryStore.setCurrentProject(project);
  try {
    await memoryStore.loadSessions(project.projectId);
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

async function selectSession(session) {
  memoryStore.setCurrentSession(session);
  try {
    await memoryStore.loadVersions(currentProject.value.projectId, session.sessionId);
    await memoryStore.loadKeepits(currentProject.value.projectId, session.sessionId);
  } catch (err) {
    console.error('Failed to load session details:', err);
  }
}

function clearSelection() {
  memoryStore.clearCurrentProject();
}

function clearSession() {
  memoryStore.clearCurrentSession();
}

function clearError() {
  memoryStore.clearError();
}

async function handleRegister(sessionData) {
  const sessionId = typeof sessionData === 'string' ? sessionData : sessionData.sessionId;
  try {
    await memoryStore.registerSession(currentProject.value.projectId, sessionId);
  } catch (err) {
    console.error('Failed to register session:', err);
  }
}

async function handleUnregister(session) {
  if (!confirm(`Unregister session "${session.fileName || session.sessionId}"? This will remove it from the memory system.`)) {
    return;
  }
  try {
    await memoryStore.unregisterSession(currentProject.value.projectId, session.sessionId);
  } catch (err) {
    console.error('Failed to unregister session:', err);
  }
}

async function findUnregistered() {
  try {
    await memoryStore.findUnregisteredSessions(currentProject.value.projectId);
  } catch (err) {
    console.error('Failed to find unregistered sessions:', err);
  }
}

function handleSettingsSaved() {
  showSettings.value = false;
  // Optionally refresh
}

function handleCompositionCreated(composition) {
  showCompositionBuilder.value = false;
  // Could navigate to the composition view
}

async function handleCompressionCreated(version) {
  showCreateCompressionDialog.value = false;
  // Refresh the versions list
  if (currentProject.value && currentSession.value) {
    await memoryStore.loadVersions(currentProject.value.projectId, currentSession.value.sessionId);
  }
}

async function refreshCurrentSession() {
  if (!currentProject.value || !currentSession.value) return;

  try {
    await memoryStore.loadVersions(currentProject.value.projectId, currentSession.value.sessionId);
    await memoryStore.loadKeepits(currentProject.value.projectId, currentSession.value.sessionId);
  } catch (err) {
    console.error('Failed to refresh session:', err);
  }
}

function handleViewVersion(version) {
  // Could open a version viewer dialog or navigate
  console.log('View version:', version);
}

async function handleDeleteVersion(version) {
  if (!currentProject.value || !currentSession.value) return;

  if (!confirm(`Delete compression version "${version.versionId}"? This cannot be undone.`)) {
    return;
  }

  try {
    await memoryStore.deleteVersion(currentProject.value.projectId, currentSession.value.sessionId, version.versionId);
  } catch (err) {
    console.error('Failed to delete version:', err);
  }
}

function handleViewOriginal() {
  if (!currentProject.value || !currentSession.value) return;

  // Navigate to the session editor for this session
  emit('navigate-to-session', {
    sessionId: currentSession.value.sessionId,
    projectId: currentProject.value.projectId,
    fileName: currentSession.value.fileName || currentSession.value.sessionId
  });
}

function formatDate(dateString) {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}
</script>

<style scoped>
.memory-browser {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

/* Header */
.browser-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid #e0e0e0;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.browser-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #333;
}

.status-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-badge.initialized {
  background: #c6f6d5;
  color: #276749;
}

.status-badge.not-initialized {
  background: #fed7d7;
  color: #c53030;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-icon {
  padding: 0.5rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1.2rem;
  transition: all 0.2s ease;
}

.btn-icon:hover {
  background: #f1f5f9;
  border-color: #667eea;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-secondary:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #667eea;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Initialize Section */
.initialize-section {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.initialize-card {
  text-align: center;
  padding: 3rem;
  background: #f8fafc;
  border-radius: 12px;
  border: 2px dashed #e2e8f0;
  max-width: 400px;
}

.initialize-card h3 {
  margin: 0 0 1rem 0;
  color: #333;
}

.initialize-card p {
  margin: 0 0 1.5rem 0;
  color: #666;
  line-height: 1.6;
}

/* Browser Content */
.browser-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.9rem;
}

.breadcrumb-item {
  color: #667eea;
  cursor: pointer;
  transition: color 0.2s ease;
}

.breadcrumb-item:hover {
  text-decoration: underline;
}

.breadcrumb-item.active {
  color: #333;
  cursor: default;
  font-weight: 500;
}

.breadcrumb-item.active:hover {
  text-decoration: none;
}

.breadcrumb-separator {
  color: #a0aec0;
}

/* Project List */
.project-list {
  flex: 1;
  padding: 1.5rem;
  overflow-y: auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: #666;
  gap: 1rem;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #f0f0f0;
  border-top: 3px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  text-align: center;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.empty-state h3 {
  margin: 0 0 0.5rem 0;
  color: #333;
}

.empty-state p {
  margin: 0;
  color: #666;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.project-card {
  padding: 1.25rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.project-card:hover {
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
  transform: translateY(-2px);
}

.project-name {
  font-size: 1.1rem;
  font-weight: 600;
  color: #333;
  margin-bottom: 0.75rem;
  word-break: break-word;
}

.project-stats {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 0.75rem;
}

.stat {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #667eea;
}

.stat-label {
  font-size: 0.75rem;
  color: #a0aec0;
  text-transform: uppercase;
}

.project-meta {
  font-size: 0.8rem;
  color: #a0aec0;
}

/* Session View */
.session-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.actions-panel {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

/* Session Details View */
.session-details-view {
  flex: 1;
  overflow: hidden;
}

/* Error Banner */
.error-banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: #fff5f5;
  border-top: 1px solid #feb2b2;
  color: #c53030;
}

.error-icon {
  font-size: 1.25rem;
}

.error-message {
  flex: 1;
  font-size: 0.9rem;
}

.btn-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #c53030;
  padding: 0;
  line-height: 1;
}

.btn-close:hover {
  color: #9b2c2c;
}
</style>
