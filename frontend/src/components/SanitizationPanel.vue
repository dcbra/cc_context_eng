<template>
  <div class="sanitization-panel">
    <div class="panel-header">
      <h3>Sanitization Options</h3>
      <button @click="showPreview = !showPreview" class="btn-preview">
        {{ showPreview ? 'Hide Preview' : 'Show Preview' }}
      </button>
    </div>

    <div v-if="hasManualSelections" class="info-banner">
      <span class="info-icon">ℹ️</span>
      <div class="info-text">
        <strong>Manual Selection Active:</strong>
        {{ selectedMessageCount }} messages selected. All criteria will be ignored - only selected messages will be removed.
      </div>
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
          <div class="criteria-content">
            <span class="criteria-name">Remove Verbose Explanations</span>
            <span class="criteria-desc">
              Shorten long assistant explanations (>{{ criteria.verboseThreshold }} chars)
            </span>
            <div v-if="criteria.removeVerbose" class="threshold-input-group">
              <label>
                Character threshold:
                <input
                  v-model.number="criteria.verboseThreshold"
                  type="number"
                  min="100"
                  max="2000"
                  step="50"
                  class="threshold-input"
                />
              </label>
            </div>
          </div>
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

      <div class="criteria-group">
        <h5 class="group-title">Message Types to Remove</h5>
        <div class="message-types-grid">
          <label class="criteria-item-compact">
            <input v-model="criteria.messageTypes" type="checkbox" value="tool" />
            <span class="criteria-name">Tool Use</span>
          </label>
          <label class="criteria-item-compact">
            <input v-model="criteria.messageTypes" type="checkbox" value="tool-result" />
            <span class="criteria-name">Tool Result</span>
          </label>
          <label class="criteria-item-compact">
            <input v-model="criteria.messageTypes" type="checkbox" value="thinking" />
            <span class="criteria-name">Thinking</span>
          </label>
          <label class="criteria-item-compact">
            <input v-model="criteria.messageTypes" type="checkbox" value="assistant" />
            <span class="criteria-name">Assistant</span>
          </label>
          <label class="criteria-item-compact">
            <input v-model="criteria.messageTypes" type="checkbox" value="you" />
            <span class="criteria-name">You (User)</span>
          </label>
        </div>
      </div>

      <div class="criteria-item slider-item">
        <div class="criteria-content full-width">
          <span class="criteria-name">Message Range</span>
          <span class="criteria-desc">
            Apply criteria to oldest {{ criteria.percentageRange }}% of messages
          </span>
          <div class="slider-container">
            <input
              v-model.number="criteria.percentageRange"
              type="range"
              min="0"
              max="100"
              step="5"
              class="range-slider"
            />
            <div class="slider-labels">
              <span>0%</span>
              <span class="slider-value">{{ criteria.percentageRange }}%</span>
              <span>100%</span>
            </div>
          </div>
        </div>
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
  removeDuplicateFileReads: false,
  messageTypes: [],           // NEW: Array for multi-select message types
  verboseThreshold: 500,      // NEW: Configurable character threshold
  percentageRange: 0          // NEW: 0-100% slider for message range
});

const showPreview = ref(false);
const previewData = ref(null);
const loading = ref(false);
const error = ref(null);

const selectedMessageCount = computed(() => selectionStore.selectedMessageCount);
const selectedFileCount = computed(() => selectionStore.selectedFileCount);

const hasManualSelections = computed(() => {
  return selectionStore.selectedMessageCount > 0;
});

const appliedCriteria = computed(() => {
  let count = 0;
  if (criteria.value.removeErrors) count++;
  if (criteria.value.removeVerbose) count++;
  if (criteria.value.removeDuplicateFileReads) count++;
  if (criteria.value.messageTypes && criteria.value.messageTypes.length > 0) count++;
  if (criteria.value.percentageRange > 0) count++;
  return count;
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
    const requestBody = {
      removeMessages: Array.from(selectionStore.selectedMessages),
      removeFiles: Array.from(selectionStore.selectedFiles),
      criteria: {
        ...criteria.value,
        // Add manual selection info for priority handling
        manuallySelected: selectionStore.selectedMessageCount > 0
          ? Array.from(selectionStore.selectedMessages)
          : undefined
      }
    };

    const response = await fetch(
      `/api/sessions/${props.sessionId}/preview?projectId=${props.projectId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
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
    const requestBody = {
      removeMessages: Array.from(selectionStore.selectedMessages),
      removeFiles: Array.from(selectionStore.selectedFiles),
      criteria: {
        ...criteria.value,
        // Add manual selection info for priority handling
        manuallySelected: selectionStore.selectedMessageCount > 0
          ? Array.from(selectionStore.selectedMessages)
          : undefined
      }
    };

    const response = await fetch(
      `/api/sanitize/${props.sessionId}?projectId=${props.projectId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
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

/* Info banner */
.info-banner {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  background-color: #e3f2fd;
  border: 1px solid #667eea;
  border-radius: 4px;
  margin-bottom: 1.5rem;
  align-items: flex-start;
}

.info-icon {
  font-size: 1.2rem;
  line-height: 1;
}

.info-text {
  flex: 1;
  font-size: 0.9rem;
  color: #333;
  line-height: 1.4;
}

/* Criteria group */
.criteria-group {
  margin-bottom: 1rem;
  padding: 1rem;
  background-color: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
}

.group-title {
  margin: 0 0 0.75rem 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: #555;
}

/* Message types grid */
.message-types-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.5rem;
}

.criteria-item-compact {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background-color: white;
  border: 1px solid #e0e0e0;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.criteria-item-compact:hover {
  background-color: #f0f4ff;
  border-color: #667eea;
}

.criteria-item-compact input[type="checkbox"] {
  cursor: pointer;
}

.criteria-item-compact .criteria-name {
  font-size: 0.85rem;
  color: #333;
  font-weight: 500;
}

/* Criteria content flex */
.criteria-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.criteria-content.full-width {
  width: 100%;
}

/* Verbose threshold input */
.threshold-input-group {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background-color: #f9f9f9;
  border-radius: 3px;
  border: 1px solid #e0e0e0;
}

.threshold-input-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #555;
}

.threshold-input {
  width: 100px;
  padding: 0.25rem 0.5rem;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 0.85rem;
}

/* Range slider */
.slider-item {
  display: block;
  padding: 1rem;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  margin-bottom: 1.5rem;
}

.slider-container {
  margin-top: 0.75rem;
  width: 100%;
}

.range-slider {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, #667eea 0%, #764ba2 100%);
  outline: none;
  opacity: 0.7;
  transition: opacity 0.2s;
  -webkit-appearance: none;
  appearance: none;
}

.range-slider:hover {
  opacity: 1;
}

.range-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.range-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  border: none;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: #999;
}

.slider-value {
  font-weight: 600;
  color: #667eea;
  font-size: 1rem;
}
</style>
