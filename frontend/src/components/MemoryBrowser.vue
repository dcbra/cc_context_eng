<template>
  <div class="memory-browser">
    <div class="memory-header">
      <h2>Memory Browser</h2>
      <div class="header-controls">
        <div class="project-selector">
          <label for="project-select">Project:</label>
          <select
            id="project-select"
            v-model="selectedProjectId"
            @change="handleProjectChange"
            :disabled="loading.projects"
          >
            <option value="">Select a project...</option>
            <option v-for="p in projects" :key="p.projectId" :value="p.projectId">
              {{ p.displayName || p.projectId }}
            </option>
          </select>
        </div>
        <button @click="refreshData" class="btn-refresh" :disabled="isLoading">
          Refresh
        </button>
      </div>
    </div>

    <div v-if="!memoryStore.initialized" class="not-initialized">
      <div class="init-message">
        <h3>Memory System Not Initialized</h3>
        <p>The memory system needs to be initialized before use.</p>
        <button @click="initializeMemory" class="btn-primary" :disabled="loading.status">
          {{ loading.status ? 'Initializing...' : 'Initialize Memory System' }}
        </button>
      </div>
    </div>

    <div v-else-if="error" class="error-banner">
      <span class="error-icon">!</span>
      <span class="error-text">{{ error.message }}</span>
      <button @click="clearError" class="btn-dismiss">Dismiss</button>
    </div>

    <div v-else class="memory-content">
      <!-- Left Panel: Session List -->
      <div class="sessions-panel">
        <div class="panel-header">
          <h3>Sessions</h3>
          <div class="panel-stats" v-if="selectedProjectId">
            <span class="stat">{{ sessions.length }} registered</span>
            <span class="stat" v-if="unregisteredSessions.length > 0">
              {{ unregisteredSessions.length }} unregistered
            </span>
          </div>
        </div>

        <div v-if="loading.sessions" class="loading-state">
          <div class="spinner"></div>
          <span>Loading sessions...</span>
        </div>

        <div v-else-if="!selectedProjectId" class="empty-state">
          <span>Select a project to view sessions</span>
        </div>

        <div v-else-if="sessions.length === 0 && unregisteredSessions.length === 0" class="empty-state">
          <span>No sessions found for this project</span>
        </div>

        <div v-else class="sessions-list-container">
          <SessionList
            :sessions="sessions"
            :unregisteredSessions="unregisteredSessions"
            :selectedSessionId="selectedSessionId"
            @select="selectSession"
            @register="handleRegisterSession"
          />
        </div>
      </div>

      <!-- Right Panel: Session Details -->
      <div class="details-panel">
        <div v-if="!selectedSession" class="empty-state">
          <span>Select a session to view details</span>
        </div>

        <div v-else-if="loading.session" class="loading-state">
          <div class="spinner"></div>
          <span>Loading session details...</span>
        </div>

        <MemorySessionDetails
          v-else
          :session="selectedSession"
          :versions="versions"
          :keepits="keepits"
          :loading="loading"
          @create-version="openCompressionDialog"
          @view-version="handleViewVersion"
          @delete-version="handleDeleteVersion"
          @compare-versions="openComparisonDialog"
          @view-original="handleViewOriginal"
          @refresh="refreshSessionDetails"
        />
      </div>
    </div>

    <!-- Create Compression Dialog -->
    <CreateCompressionDialog
      v-if="showCompressionDialog"
      :sessionId="selectedSession?.sessionId"
      :projectId="selectedProjectId"
      :originalTokens="selectedSession?.originalTokens || 0"
      :originalMessages="selectedSession?.originalMessages || 0"
      @close="showCompressionDialog = false"
      @created="handleCompressionCreated"
    />

    <!-- Version Comparison Dialog -->
    <VersionComparisonDialog
      v-if="showComparisonDialog"
      :session="selectedSession"
      :versions="versions"
      :projectId="selectedProjectId"
      @close="showComparisonDialog = false"
    />

    <!-- Bulk Version Manager Dialog -->
    <BulkVersionManager
      v-if="showBulkManager"
      :versions="versions"
      :projectId="selectedProjectId"
      :sessionId="selectedSession?.sessionId"
      @close="showBulkManager = false"
      @deleted="handleBulkDeleted"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useMemoryStore } from '../stores/memory.js';
import SessionList from './memory/SessionList.vue';
import MemorySessionDetails from './memory/SessionDetails.vue';
import CreateCompressionDialog from './memory/CreateCompressionDialog.vue';
import VersionComparisonDialog from './memory/VersionComparisonDialog.vue';
import BulkVersionManager from './memory/BulkVersionManager.vue';

const memoryStore = useMemoryStore();

// Local state
const selectedProjectId = ref('');
const selectedSessionId = ref('');
const showCompressionDialog = ref(false);
const showComparisonDialog = ref(false);
const showBulkManager = ref(false);

// Computed from store
const projects = computed(() => memoryStore.projects);
const sessions = computed(() => memoryStore.sessions);
const unregisteredSessions = computed(() => memoryStore.unregisteredSessions);
const selectedSession = computed(() => memoryStore.currentSession);
const versions = computed(() => memoryStore.versions);
const keepits = computed(() => memoryStore.keepits);
const loading = computed(() => memoryStore.loading);
const error = computed(() => memoryStore.error);
const isLoading = computed(() => memoryStore.isLoading);

// Initialize on mount
onMounted(async () => {
  try {
    // Check memory status
    await memoryStore.checkStatus();

    if (memoryStore.initialized) {
      // Load projects
      await memoryStore.loadProjects();
    }
  } catch (err) {
    console.error('Failed to initialize memory browser:', err);
  }
});

// Watch for project changes
watch(selectedProjectId, async (newProjectId) => {
  if (newProjectId) {
    memoryStore.setCurrentProject({ projectId: newProjectId });
    await loadProjectData(newProjectId);
  } else {
    memoryStore.clearCurrentProject();
  }
  // Clear session selection when project changes
  selectedSessionId.value = '';
});

async function initializeMemory() {
  try {
    await memoryStore.initialize();
    await memoryStore.loadProjects();
  } catch (err) {
    console.error('Failed to initialize memory system:', err);
  }
}

async function loadProjectData(projectId) {
  try {
    await Promise.all([
      memoryStore.loadSessions(projectId),
      memoryStore.findUnregisteredSessions(projectId)
    ]);
  } catch (err) {
    console.error('Failed to load project data:', err);
  }
}

function handleProjectChange() {
  // Clear session when project changes
  selectedSessionId.value = '';
  memoryStore.clearCurrentSession();
}

async function selectSession(sessionId) {
  selectedSessionId.value = sessionId;

  if (!sessionId || !selectedProjectId.value) {
    memoryStore.clearCurrentSession();
    return;
  }

  try {
    await memoryStore.loadSession(selectedProjectId.value, sessionId);
    await Promise.all([
      memoryStore.loadVersions(selectedProjectId.value, sessionId),
      memoryStore.loadKeepits(selectedProjectId.value, sessionId)
    ]);
  } catch (err) {
    console.error('Failed to load session details:', err);
  }
}

async function handleRegisterSession(sessionId) {
  if (!selectedProjectId.value) return;

  try {
    await memoryStore.registerSession(selectedProjectId.value, sessionId);
  } catch (err) {
    console.error('Failed to register session:', err);
  }
}

function openCompressionDialog() {
  showCompressionDialog.value = true;
}

function openComparisonDialog() {
  showComparisonDialog.value = true;
}

async function handleCompressionCreated(version) {
  showCompressionDialog.value = false;
  // Refresh versions list
  if (selectedProjectId.value && selectedSessionId.value) {
    await memoryStore.loadVersions(selectedProjectId.value, selectedSessionId.value);
  }
}

async function handleViewVersion(version) {
  try {
    const content = await memoryStore.getVersionContent(
      selectedProjectId.value,
      selectedSessionId.value,
      version.versionId,
      'md'
    );
    // Open in new window or show in modal
    const blob = new Blob([content.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch (err) {
    console.error('Failed to view version:', err);
  }
}

async function handleDeleteVersion(version) {
  if (!confirm(`Delete compression version ${version.versionId}? This cannot be undone.`)) {
    return;
  }

  try {
    await memoryStore.deleteVersion(
      selectedProjectId.value,
      selectedSessionId.value,
      version.versionId
    );
  } catch (err) {
    console.error('Failed to delete version:', err);
  }
}

async function handleViewOriginal() {
  // Navigate to session editor or show original content
  console.log('View original session:', selectedSessionId.value);
}

async function handleBulkDeleted() {
  showBulkManager.value = false;
  // Refresh versions
  if (selectedProjectId.value && selectedSessionId.value) {
    await memoryStore.loadVersions(selectedProjectId.value, selectedSessionId.value);
  }
}

async function refreshData() {
  if (selectedProjectId.value) {
    await loadProjectData(selectedProjectId.value);
    if (selectedSessionId.value) {
      await selectSession(selectedSessionId.value);
    }
  } else {
    await memoryStore.loadProjects();
  }
}

async function refreshSessionDetails() {
  if (selectedProjectId.value && selectedSessionId.value) {
    await selectSession(selectedSessionId.value);
  }
}

function clearError() {
  memoryStore.clearError();
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

.memory-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 2px solid #667eea;
  background-color: #f9f9f9;
}

.memory-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #333;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.project-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.project-selector label {
  font-size: 0.9rem;
  color: #666;
  font-weight: 500;
}

.project-selector select {
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.9rem;
  background: white;
  min-width: 200px;
  cursor: pointer;
}

.project-selector select:focus {
  outline: none;
  border-color: #667eea;
}

.btn-refresh {
  padding: 0.5rem 1rem;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.btn-refresh:hover:not(:disabled) {
  background: #e0e0e0;
}

.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.not-initialized {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 2rem;
}

.init-message {
  text-align: center;
  padding: 2rem;
  background: #f9f9f9;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
}

.init-message h3 {
  margin: 0 0 0.5rem 0;
  color: #333;
}

.init-message p {
  margin: 0 0 1.5rem 0;
  color: #666;
}

.btn-primary {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
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
  transform: none;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  background: #ffebee;
  border-bottom: 1px solid #ffcdd2;
}

.error-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: #d32f2f;
  color: white;
  border-radius: 50%;
  font-weight: bold;
  font-size: 0.9rem;
}

.error-text {
  flex: 1;
  color: #c62828;
  font-size: 0.9rem;
}

.btn-dismiss {
  padding: 0.25rem 0.75rem;
  background: transparent;
  border: 1px solid #d32f2f;
  border-radius: 4px;
  color: #d32f2f;
  cursor: pointer;
  font-size: 0.85rem;
}

.btn-dismiss:hover {
  background: #ffcdd2;
}

.memory-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sessions-panel {
  width: 350px;
  min-width: 300px;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  background: #fafafa;
}

.details-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #e0e0e0;
  background: white;
}

.panel-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #333;
}

.panel-stats {
  display: flex;
  gap: 0.75rem;
}

.panel-stats .stat {
  font-size: 0.8rem;
  color: #666;
  padding: 0.25rem 0.5rem;
  background: #f0f0f0;
  border-radius: 3px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: #999;
  font-size: 0.9rem;
  gap: 0.75rem;
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
  to {
    transform: rotate(360deg);
  }
}

.sessions-list-container {
  flex: 1;
  overflow-y: auto;
}
</style>
