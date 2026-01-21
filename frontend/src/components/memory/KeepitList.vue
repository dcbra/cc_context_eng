<template>
  <div class="keepit-list">
    <div class="list-header">
      <h3>Keepit Markers</h3>
      <div class="header-actions">
        <button @click="refreshKeepits" class="btn-refresh" :disabled="loading">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <span>Loading keepit markers...</span>
    </div>

    <div v-else-if="error" class="error-state">
      <span class="error-icon">!</span>
      <span>{{ error }}</span>
      <button @click="refreshKeepits" class="btn-retry">Retry</button>
    </div>

    <div v-else-if="markers.length === 0" class="empty-state">
      <span class="empty-icon">i</span>
      <span>No keepit markers found in this session.</span>
      <p class="empty-hint">
        Keepit markers are embedded in messages using the format:<br>
        <code>##keepit0.85##Important content here</code>
      </p>
    </div>

    <div v-else class="markers-container">
      <div class="list-summary">
        <span class="summary-count">{{ markers.length }} marker{{ markers.length !== 1 ? 's' : '' }}</span>
        <span class="summary-weight">Avg weight: {{ averageWeight.toFixed(2) }}</span>
      </div>

      <div
        v-for="marker in sortedMarkers"
        :key="marker.id"
        class="keepit-item"
        :class="getWeightClass(marker.weight)"
        @click="$emit('edit', marker)"
      >
        <div class="item-header">
          <span class="weight-badge" :class="getWeightClass(marker.weight)">
            {{ marker.weight.toFixed(2) }}
          </span>
          <span class="weight-label">{{ getWeightLabel(marker.weight) }}</span>
          <span class="message-ref" v-if="marker.messageUuid">
            msg: {{ marker.messageUuid.substring(0, 8) }}...
          </span>
        </div>

        <div class="keepit-content">
          <span class="content-preview">{{ truncateContent(marker.content) }}</span>
        </div>

        <div class="item-footer">
          <div class="survival-info" v-if="marker.survivedIn || marker.summarizedIn">
            <span v-if="marker.survivedIn && marker.survivedIn.length > 0" class="survival-badge survived">
              Survived: {{ marker.survivedIn.length }}
            </span>
            <span v-if="marker.summarizedIn && marker.summarizedIn.length > 0" class="survival-badge summarized">
              Summarized: {{ marker.summarizedIn.length }}
            </span>
          </div>
          <div class="item-actions">
            <button @click.stop="$emit('edit', marker)" class="btn-edit">Edit</button>
            <button @click.stop="confirmDelete(marker)" class="btn-delete">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Dialog -->
    <div v-if="deleteTarget" class="dialog-overlay" @click.self="deleteTarget = null">
      <div class="confirm-dialog">
        <h4>Delete Keepit Marker?</h4>
        <p>This will remove the keepit marker from the original session file.</p>
        <div class="dialog-content">
          <span class="weight-badge" :class="getWeightClass(deleteTarget.weight)">
            {{ deleteTarget.weight.toFixed(2) }}
          </span>
          <span class="delete-preview">{{ truncateContent(deleteTarget.content, 80) }}</span>
        </div>
        <div class="dialog-actions">
          <button @click="deleteTarget = null" class="btn-cancel">Cancel</button>
          <button @click="executeDelete" class="btn-confirm-delete" :disabled="deleting">
            {{ deleting ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useMemoryStore } from '../../stores/memory.js';

const props = defineProps({
  projectId: {
    type: String,
    required: true
  },
  sessionId: {
    type: String,
    required: true
  },
  markers: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['edit', 'delete', 'refresh']);

const memoryStore = useMemoryStore();
const loading = ref(false);
const error = ref(null);
const deleteTarget = ref(null);
const deleting = ref(false);

// Weight presets for labeling
const WEIGHT_PRESETS = {
  pinned: 1.0,
  critical: 0.85,
  important: 0.70,
  notable: 0.50,
  minor: 0.30
};

const sortedMarkers = computed(() => {
  if (!props.markers || props.markers.length === 0) return [];
  // Sort by weight descending (highest weight first)
  return [...props.markers].sort((a, b) => b.weight - a.weight);
});

const averageWeight = computed(() => {
  if (!props.markers || props.markers.length === 0) return 0;
  const sum = props.markers.reduce((acc, m) => acc + m.weight, 0);
  return sum / props.markers.length;
});

function getWeightClass(weight) {
  if (weight >= 0.95) return 'weight-pinned';
  if (weight >= 0.80) return 'weight-critical';
  if (weight >= 0.65) return 'weight-important';
  if (weight >= 0.45) return 'weight-notable';
  return 'weight-minor';
}

function getWeightLabel(weight) {
  if (weight >= 0.95) return 'Pinned';
  if (weight >= 0.80) return 'Critical';
  if (weight >= 0.65) return 'Important';
  if (weight >= 0.45) return 'Notable';
  return 'Minor';
}

function truncateContent(content, maxLength = 150) {
  if (!content) return '';
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength) + '...';
}

async function refreshKeepits() {
  loading.value = true;
  error.value = null;
  try {
    await memoryStore.loadKeepits(props.projectId, props.sessionId);
    emit('refresh');
  } catch (err) {
    error.value = err.message || 'Failed to load keepit markers';
  } finally {
    loading.value = false;
  }
}

function confirmDelete(marker) {
  deleteTarget.value = marker;
}

async function executeDelete() {
  if (!deleteTarget.value) return;

  deleting.value = true;
  try {
    await memoryStore.deleteKeepit(
      props.projectId,
      props.sessionId,
      deleteTarget.value.id
    );
    emit('delete', deleteTarget.value);
    deleteTarget.value = null;
  } catch (err) {
    error.value = err.message || 'Failed to delete keepit marker';
  } finally {
    deleting.value = false;
  }
}

onMounted(() => {
  if (props.markers.length === 0) {
    refreshKeepits();
  }
});

// Watch for projectId/sessionId changes
watch(
  () => [props.projectId, props.sessionId],
  () => {
    if (props.projectId && props.sessionId) {
      refreshKeepits();
    }
  }
);
</script>

<style scoped>
.keepit-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 2px solid #e0e0e0;
  background: #f9f9f9;
  border-radius: 8px 8px 0 0;
}

.list-header h3 {
  margin: 0;
  color: #333;
  font-size: 1.1rem;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-refresh {
  padding: 0.4rem 0.8rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.2s ease;
}

.btn-refresh:hover:not(:disabled) {
  background: #5a6fd6;
}

.btn-refresh:disabled {
  background: #a0aec0;
  cursor: not-allowed;
}

/* States */
.loading-state,
.error-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 2rem;
  text-align: center;
  color: #666;
  flex: 1;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e0e0e0;
  border-top: 3px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  color: #c53030;
  background: #fff5f5;
  border-radius: 4px;
  margin: 1rem;
}

.error-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #fc8181;
  color: white;
  border-radius: 50%;
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.btn-retry {
  margin-top: 0.75rem;
  padding: 0.4rem 0.8rem;
  background: #c53030;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.btn-retry:hover {
  background: #9b2c2c;
}

.empty-state {
  color: #718096;
}

.empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #e2e8f0;
  color: #4a5568;
  border-radius: 50%;
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.empty-hint {
  margin-top: 1rem;
  font-size: 0.85rem;
  color: #a0aec0;
}

.empty-hint code {
  display: inline-block;
  margin-top: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: #edf2f7;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.8rem;
  color: #4a5568;
}

/* List */
.markers-container {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.list-summary {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  background: #f7fafc;
  border-radius: 4px;
  font-size: 0.85rem;
  color: #4a5568;
}

.summary-count {
  font-weight: 600;
}

.summary-weight {
  color: #667eea;
}

/* Keepit Item */
.keepit-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 0.5rem;
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.keepit-item:hover {
  background: #f0f4ff;
  border-color: #667eea;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.keepit-item.weight-pinned {
  border-left: 4px solid #e53e3e;
}

.keepit-item.weight-critical {
  border-left: 4px solid #dd6b20;
}

.keepit-item.weight-important {
  border-left: 4px solid #d69e2e;
}

.keepit-item.weight-notable {
  border-left: 4px solid #38a169;
}

.keepit-item.weight-minor {
  border-left: 4px solid #718096;
}

.item-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.weight-badge {
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  font-family: monospace;
}

.weight-badge.weight-pinned {
  background: #fed7d7;
  color: #c53030;
}

.weight-badge.weight-critical {
  background: #feebc8;
  color: #c05621;
}

.weight-badge.weight-important {
  background: #fefcbf;
  color: #975a16;
}

.weight-badge.weight-notable {
  background: #c6f6d5;
  color: #276749;
}

.weight-badge.weight-minor {
  background: #e2e8f0;
  color: #4a5568;
}

.weight-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: #4a5568;
}

.message-ref {
  margin-left: auto;
  font-size: 0.7rem;
  font-family: monospace;
  color: #a0aec0;
}

.keepit-content {
  padding-left: 0.25rem;
}

.content-preview {
  font-size: 0.9rem;
  color: #333;
  line-height: 1.4;
  word-break: break-word;
}

.item-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 0.25rem;
}

.survival-info {
  display: flex;
  gap: 0.5rem;
}

.survival-badge {
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 500;
}

.survival-badge.survived {
  background: #c6f6d5;
  color: #276749;
}

.survival-badge.summarized {
  background: #feebc8;
  color: #c05621;
}

.item-actions {
  display: flex;
  gap: 0.25rem;
}

.btn-edit,
.btn-delete {
  padding: 0.2rem 0.5rem;
  border: none;
  border-radius: 3px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.btn-edit {
  background: #667eea;
  color: white;
}

.btn-edit:hover {
  background: #5a6fd6;
}

.btn-delete {
  background: #e53e3e;
  color: white;
}

.btn-delete:hover {
  background: #c53030;
}

/* Dialog */
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

.confirm-dialog {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.confirm-dialog h4 {
  margin: 0 0 0.5rem 0;
  color: #c53030;
}

.confirm-dialog p {
  margin: 0 0 1rem 0;
  font-size: 0.9rem;
  color: #666;
}

.dialog-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: #f9f9f9;
  border-radius: 4px;
  margin-bottom: 1rem;
}

.delete-preview {
  font-size: 0.85rem;
  color: #4a5568;
  word-break: break-word;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.btn-cancel {
  padding: 0.5rem 1rem;
  background: #e2e8f0;
  color: #4a5568;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.btn-cancel:hover {
  background: #cbd5e0;
}

.btn-confirm-delete {
  padding: 0.5rem 1rem;
  background: #e53e3e;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.btn-confirm-delete:hover:not(:disabled) {
  background: #c53030;
}

.btn-confirm-delete:disabled {
  background: #feb2b2;
  cursor: not-allowed;
}
</style>
