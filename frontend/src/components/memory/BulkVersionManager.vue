<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="bulk-manager">
      <div class="dialog-header">
        <h3>Bulk Version Management</h3>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>

      <div class="bulk-header">
        <label class="select-all">
          <input type="checkbox" v-model="selectAll" @change="toggleAll" />
          <span>Select All</span>
        </label>
        <span class="selected-count" v-if="selectedVersions.length > 0">
          {{ selectedVersions.length }} selected
          <span class="selected-size">({{ formatBytes(selectedSize) }})</span>
        </span>
      </div>

      <div class="version-list">
        <div
          v-for="version in versions"
          :key="version.versionId"
          class="version-row"
          :class="{ selected: isSelected(version), 'in-use': version.usedInCompositions > 0 }"
        >
          <div class="version-checkbox">
            <input
              type="checkbox"
              :checked="isSelected(version)"
              @change="toggleVersion(version)"
              :disabled="version.usedInCompositions > 0"
            />
          </div>

          <div class="version-info">
            <span class="version-id">{{ version.versionId }}</span>
            <div class="version-details">
              <span class="version-mode">{{ formatMode(version.settings) }}</span>
              <span class="version-tokens">{{ formatTokens(version.outputTokens) }}</span>
              <span class="version-ratio">{{ version.compressionRatio?.toFixed(1) || '?' }}:1</span>
            </div>
          </div>

          <span class="version-date">{{ formatDate(version.createdAt) }}</span>

          <span class="version-used" :class="{ 'in-use': version.usedInCompositions > 0 }">
            {{ version.usedInCompositions > 0 ? `In use (${version.usedInCompositions})` : 'Unused' }}
          </span>
        </div>

        <div v-if="versions.length === 0" class="empty-list">
          <span>No compression versions to manage</span>
        </div>
      </div>

      <div v-if="hasInUseVersions && selectedVersions.length > 0" class="warning-banner">
        <span class="warning-icon">!</span>
        <span>Cannot delete versions that are in use by compositions</span>
      </div>

      <div v-if="error" class="error-banner">
        <span class="error-text">{{ error }}</span>
      </div>

      <div class="bulk-actions">
        <div class="action-info">
          <span v-if="selectedVersions.length > 0">
            {{ selectedVersions.length }} version(s) selected for deletion
          </span>
          <span v-else class="hint">
            Select versions to delete them
          </span>
        </div>
        <div class="action-buttons">
          <button @click="$emit('close')" class="btn-secondary">Cancel</button>
          <button
            @click="confirmDelete"
            :disabled="selectedVersions.length === 0 || hasInUseVersions || deleting"
            class="btn-danger"
          >
            {{ deleting ? 'Deleting...' : 'Delete Selected' }}
          </button>
        </div>
      </div>

      <!-- Delete Confirmation Modal -->
      <div v-if="showConfirm" class="confirm-overlay" @click.self="showConfirm = false">
        <div class="confirm-dialog">
          <h4>Confirm Deletion</h4>
          <p>Are you sure you want to delete {{ selectedVersions.length }} compression version(s)?</p>
          <p class="warning-text">This action cannot be undone.</p>

          <div class="versions-to-delete">
            <span v-for="v in selectedVersions.slice(0, 5)" :key="v.versionId" class="version-badge">
              {{ v.versionId }}
            </span>
            <span v-if="selectedVersions.length > 5" class="more-badge">
              +{{ selectedVersions.length - 5 }} more
            </span>
          </div>

          <div class="confirm-actions">
            <button @click="showConfirm = false" class="btn-secondary">Cancel</button>
            <button @click="executeDelete" class="btn-danger" :disabled="deleting">
              {{ deleting ? 'Deleting...' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useMemoryStore } from '../../stores/memory.js';

const props = defineProps({
  versions: {
    type: Array,
    default: () => []
  },
  projectId: {
    type: String,
    required: true
  },
  sessionId: {
    type: String,
    required: true
  }
});

const emit = defineEmits(['close', 'deleted']);

const memoryStore = useMemoryStore();

// Selection state
const selectedVersions = ref([]);
const selectAll = ref(false);
const showConfirm = ref(false);
const deleting = ref(false);
const error = ref(null);

// Computed
const selectedSize = computed(() => {
  return selectedVersions.value.reduce((sum, v) => sum + (v.outputBytes || 0), 0);
});

const hasInUseVersions = computed(() => {
  return selectedVersions.value.some(v => v.usedInCompositions > 0);
});

// Watch for selectAll changes
watch(selectAll, (newVal) => {
  if (newVal) {
    // Select all non-in-use versions
    selectedVersions.value = props.versions.filter(v => v.usedInCompositions === 0);
  } else if (selectedVersions.value.length === props.versions.filter(v => v.usedInCompositions === 0).length) {
    // Only clear if all were selected
    selectedVersions.value = [];
  }
});

function isSelected(version) {
  return selectedVersions.value.some(v => v.versionId === version.versionId);
}

function toggleVersion(version) {
  const idx = selectedVersions.value.findIndex(v => v.versionId === version.versionId);
  if (idx >= 0) {
    selectedVersions.value.splice(idx, 1);
  } else {
    selectedVersions.value.push(version);
  }

  // Update selectAll state
  const selectableVersions = props.versions.filter(v => v.usedInCompositions === 0);
  selectAll.value = selectedVersions.value.length === selectableVersions.length;
}

function toggleAll() {
  // This will be handled by the watch
}

function confirmDelete() {
  if (selectedVersions.value.length === 0 || hasInUseVersions.value) return;
  showConfirm.value = true;
}

async function executeDelete() {
  deleting.value = true;
  error.value = null;

  try {
    // Delete versions one by one
    const results = [];
    for (const version of selectedVersions.value) {
      try {
        await memoryStore.deleteVersion(
          props.projectId,
          props.sessionId,
          version.versionId
        );
        results.push({ versionId: version.versionId, success: true });
      } catch (err) {
        results.push({ versionId: version.versionId, success: false, error: err.message });
      }
    }

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      error.value = `Failed to delete ${failed.length} version(s)`;
    }

    showConfirm.value = false;
    selectedVersions.value = [];
    emit('deleted', results);
  } catch (err) {
    error.value = err.message || 'Failed to delete versions';
  } finally {
    deleting.value = false;
  }
}

function formatMode(settings) {
  if (!settings) return 'Unknown';
  const mode = settings.mode === 'tiered' ? 'Variable' : 'Uniform';
  if (settings.tierPreset) return `${mode} (${settings.tierPreset})`;
  if (settings.compactionRatio) return `${mode} ${settings.compactionRatio}:1`;
  return mode;
}

function formatTokens(tokens) {
  if (!tokens) return '0';
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
  if (tokens >= 1000) return Math.round(tokens / 1000) + 'K';
  return tokens.toLocaleString();
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.bulk-manager {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e0e0e0;
  background: #f9f9f9;
  flex-shrink: 0;
}

.dialog-header h3 {
  margin: 0;
  color: #333;
  font-size: 1.1rem;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #999;
  line-height: 1;
}

.close-btn:hover {
  color: #666;
}

.bulk-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.5rem;
  background: #fafafa;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.select-all {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  color: #333;
}

.select-all input {
  cursor: pointer;
}

.selected-count {
  font-size: 0.85rem;
  color: #667eea;
  font-weight: 500;
}

.selected-size {
  color: #999;
  font-weight: 400;
}

.version-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.version-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  margin-bottom: 0.5rem;
  transition: all 0.2s ease;
}

.version-row:hover {
  border-color: #667eea;
  background-color: #fafbff;
}

.version-row.selected {
  border-color: #667eea;
  background-color: #e8eaf6;
}

.version-row.in-use {
  opacity: 0.6;
  background-color: #fff8e6;
  border-color: #fcd34d;
}

.version-checkbox {
  display: flex;
  align-items: center;
}

.version-checkbox input {
  cursor: pointer;
}

.version-checkbox input:disabled {
  cursor: not-allowed;
}

.version-info {
  flex: 1;
  min-width: 0;
}

.version-id {
  font-family: monospace;
  font-size: 0.85rem;
  font-weight: 600;
  color: #333;
}

.version-details {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

.version-mode {
  font-size: 0.75rem;
  color: #666;
  padding: 0.125rem 0.375rem;
  background: #f0f0f0;
  border-radius: 3px;
}

.version-tokens {
  font-size: 0.75rem;
  color: #667eea;
  font-weight: 500;
}

.version-ratio {
  font-size: 0.75rem;
  font-weight: 600;
  color: #059669;
}

.version-date {
  font-size: 0.75rem;
  color: #999;
  white-space: nowrap;
}

.version-used {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  background: #dcfce7;
  color: #166534;
  white-space: nowrap;
}

.version-used.in-use {
  background: #fef3c7;
  color: #92400e;
}

.empty-list {
  text-align: center;
  padding: 2rem;
  color: #999;
  font-size: 0.9rem;
}

.warning-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: #fef3c7;
  border-top: 1px solid #fcd34d;
  color: #92400e;
  font-size: 0.85rem;
}

.warning-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: #f59e0b;
  color: white;
  border-radius: 50%;
  font-weight: bold;
  font-size: 0.8rem;
}

.error-banner {
  padding: 0.75rem 1.5rem;
  background: #fee2e2;
  border-top: 1px solid #fca5a5;
}

.error-text {
  color: #991b1b;
  font-size: 0.85rem;
}

.bulk-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e0e0e0;
  background: #f9f9f9;
  flex-shrink: 0;
}

.action-info {
  font-size: 0.85rem;
  color: #666;
}

.action-info .hint {
  color: #999;
  font-style: italic;
}

.action-buttons {
  display: flex;
  gap: 0.5rem;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  color: #4a5568;
  border: 1px solid #cbd5e0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: #f7fafc;
}

.btn-danger {
  padding: 0.5rem 1.25rem;
  background: #dc2626;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}

.btn-danger:disabled {
  background: #fca5a5;
  cursor: not-allowed;
}

/* Confirm Dialog */
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}

.confirm-dialog {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.confirm-dialog h4 {
  margin: 0 0 0.75rem 0;
  color: #dc2626;
  font-size: 1.1rem;
}

.confirm-dialog p {
  margin: 0 0 0.5rem 0;
  font-size: 0.9rem;
  color: #333;
}

.confirm-dialog .warning-text {
  color: #dc2626;
  font-weight: 500;
}

.versions-to-delete {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
  padding: 0.75rem;
  background: #f5f5f5;
  border-radius: 4px;
}

.version-badge {
  padding: 0.25rem 0.5rem;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 3px;
  font-size: 0.75rem;
  font-family: monospace;
}

.more-badge {
  padding: 0.25rem 0.5rem;
  background: #e0e0e0;
  color: #666;
  border-radius: 3px;
  font-size: 0.75rem;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}
</style>
