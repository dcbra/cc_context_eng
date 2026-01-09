<template>
  <div class="sanitization-panel">
    <div class="panel-header">
      <h3>Sanitization Options</h3>
      <button @click="showPreview = !showPreview" class="btn-preview">
        {{ showPreview ? 'Hide Preview' : 'Show Preview' }}
      </button>
    </div>

    <div class="criteria-section">
      <h4>Sanitization Criteria</h4>
      <div class="criteria-list">
        <label class="criteria-item">
          <input
            v-model="criteria.removeErrors"
            type="checkbox"
          />
          <span class="criteria-name">Remove Error Tool Results</span>
          <span class="criteria-desc">Remove tool results that show errors</span>
        </label>

        <label class="criteria-item">
          <input
            v-model="criteria.removeVerbose"
            type="checkbox"
          />
          <span class="criteria-name">Remove Verbose Explanations</span>
          <span class="criteria-desc">Shorten long assistant explanations (>500 chars)</span>
        </label>

        <label class="criteria-item">
          <input
            v-model="criteria.removeDuplicateFileReads"
            type="checkbox"
          />
          <span class="criteria-name">Remove Duplicate File Reads</span>
          <span class="criteria-desc">Keep only first read of each file</span>
        </label>
      </div>
    </div>

    <div class="summary-section">
      <h4>Summary</h4>
      <div class="summary-grid">
        <div class="summary-item">
          <span class="label">Messages to Remove:</span>
          <span class="value">{{ selectedMessageCount }}</span>
        </div>
        <div class="summary-item">
          <span class="label">Files to Sanitize:</span>
          <span class="value">{{ selectedFileCount }}</span>
        </div>
        <div class="summary-item">
          <span class="label">Criteria Applied:</span>
          <span class="value">{{ appliedCriteria }}</span>
        </div>
      </div>
    </div>

    <div v-if="showPreview && previewData" class="preview-section">
      <h4>Preview</h4>
      <div class="preview-content">
        <div class="preview-item">
          <span class="label">Original Messages:</span>
          <span class="value">{{ previewData.original.messages }}</span>
        </div>
        <div class="preview-item">
          <span class="label">Original Tokens:</span>
          <span class="value">{{ previewData.original.tokens }}</span>
        </div>
        <div class="preview-item">
          <span class="label">Resulting Messages:</span>
          <span class="value success">{{ previewData.sanitized.messages }}</span>
        </div>
        <div class="preview-item">
          <span class="label">Resulting Tokens:</span>
          <span class="value success">{{ previewData.sanitized.tokens }}</span>
        </div>
        <div class="preview-item freed">
          <span class="label">Tokens Freed:</span>
          <span class="value">{{ previewData.freed.tokens }} ({{ previewData.freed.percentage.toFixed(1) }}%)</span>
        </div>
      </div>
    </div>

    <div class="actions">
      <button @click="calculatePreview" class="btn-primary">
        {{ showPreview ? 'Recalculate' : 'Calculate Impact' }}
      </button>
      <button @click="applySanitization" class="btn-danger" :disabled="!canApply">
        Apply Sanitization
      </button>
    </div>

    <div v-if="loading" class="loading">Calculating...</div>
    <div v-if="error" class="error">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useSelectionStore } from '../stores/selection.js';

const props = defineProps({
  sessionId: String,
  projectId: String,
  sessionData: Object
});

const emit = defineEmits(['sanitized']);

const selectionStore = useSelectionStore();
const criteria = ref({
  removeErrors: false,
  removeVerbose: false,
  removeDuplicateFileReads: false
});

const showPreview = ref(false);
const previewData = ref(null);
const loading = ref(false);
const error = ref(null);

const selectedMessageCount = computed(() => selectionStore.selectedMessageCount);
const selectedFileCount = computed(() => selectionStore.selectedFileCount);

const appliedCriteria = computed(() => {
  return Object.values(criteria.value).filter(Boolean).length;
});

const canApply = computed(() => {
  return (
    selectedMessageCount.value > 0 ||
    selectedFileCount.value > 0 ||
    appliedCriteria.value > 0
  );
});

async function calculatePreview() {
  loading.value = true;
  error.value = null;

  try {
    const response = await fetch(
      `/api/sessions/${props.sessionId}/preview?projectId=${props.projectId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          removeMessages: Array.from(selectionStore.selectedMessages),
          removeFiles: Array.from(selectionStore.selectedFiles),
          criteria: criteria.value
        })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to calculate preview');
    }

    previewData.value = await response.json();
    showPreview.value = true;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function applySanitization() {
  if (!canApply.value) return;

  loading.value = true;
  error.value = null;

  try {
    const response = await fetch(
      `/api/sanitize/${props.sessionId}?projectId=${props.projectId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          removeMessages: Array.from(selectionStore.selectedMessages),
          removeFiles: Array.from(selectionStore.selectedFiles),
          criteria: criteria.value
        })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to apply sanitization');
    }

    const result = await response.json();
    emit('sanitized', result);
    selectionStore.clearAll();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.sanitization-panel {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e0e0e0;
}

.panel-header h3 {
  margin: 0;
  color: #333;
}

.btn-preview {
  padding: 0.5rem 1rem;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-preview:hover {
  background: #e0e0e0;
}

.criteria-section,
.summary-section,
.preview-section {
  margin-bottom: 1.5rem;
}

.criteria-section h4,
.summary-section h4,
.preview-section h4 {
  margin: 0 0 1rem 0;
  color: #333;
  font-size: 0.95rem;
}

.criteria-list {
  display: grid;
  gap: 0.75rem;
}

.criteria-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.criteria-item:hover {
  background-color: #f0f4ff;
  border-color: #667eea;
}

.criteria-item input {
  margin-top: 3px;
  cursor: pointer;
}

.criteria-name {
  font-weight: 500;
  color: #333;
  display: block;
}

.criteria-desc {
  display: block;
  font-size: 0.85rem;
  color: #999;
  margin-top: 0.25rem;
}

.summary-grid,
.preview-content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.summary-item,
.preview-item {
  padding: 1rem;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
}

.summary-item .label,
.preview-item .label {
  font-size: 0.85rem;
  color: #999;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.summary-item .value,
.preview-item .value {
  font-size: 1.5rem;
  font-weight: 600;
  color: #333;
}

.preview-item .value.success {
  color: #2e7d32;
}

.preview-item.freed {
  background-color: #e8f5e9;
  border-color: #4caf50;
}

.preview-item.freed .value {
  color: #2e7d32;
}

.actions {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.btn-primary,
.btn-danger {
  flex: 1;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: #667eea;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #764ba2;
}

.btn-danger {
  background: #d32f2f;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #b71c1c;
}

.btn-danger:disabled {
  background: #ccc;
  cursor: not-allowed;
  opacity: 0.6;
}

.loading,
.error {
  text-align: center;
  padding: 1rem;
  border-radius: 4px;
  margin-top: 1rem;
}

.loading {
  color: #667eea;
  background-color: #f0f4ff;
}

.error {
  color: #d32f2f;
  background-color: #ffebee;
}
</style>
