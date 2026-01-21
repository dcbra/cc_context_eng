<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="keepit-editor">
      <div class="editor-header">
        <h3>Edit Keepit Marker</h3>
        <button @click="$emit('close')" class="btn-close">&times;</button>
      </div>

      <div class="editor-content">
        <!-- Content Preview -->
        <div class="content-section">
          <label class="section-label">Content:</label>
          <div class="content-text">{{ marker.content }}</div>
          <div class="content-meta" v-if="marker.messageUuid">
            <span class="meta-label">Message:</span>
            <span class="meta-value">{{ marker.messageUuid }}</span>
          </div>
        </div>

        <!-- Weight Editor -->
        <div class="weight-section">
          <label class="section-label">Weight:</label>

          <div class="weight-controls">
            <div class="weight-input-group">
              <input
                type="number"
                v-model.number="weight"
                min="0"
                max="1"
                step="0.05"
                class="weight-input"
                @input="clampWeight"
              />
              <span class="weight-indicator" :class="getWeightClass(weight)">
                {{ getWeightLabel(weight) }}
              </span>
            </div>

            <div class="weight-slider">
              <input
                type="range"
                v-model.number="weight"
                min="0"
                max="1"
                step="0.01"
                class="slider"
              />
              <div class="slider-labels">
                <span>0.00</span>
                <span class="current-weight">{{ weight.toFixed(2) }}</span>
                <span>1.00</span>
              </div>
            </div>
          </div>

          <div class="preset-section">
            <span class="preset-label">Quick presets:</span>
            <div class="preset-buttons">
              <button
                v-for="(value, name) in presets"
                :key="name"
                @click="weight = value"
                :class="{ active: Math.abs(weight - value) < 0.01 }"
                class="preset-btn"
                :title="presetDescriptions[name]"
              >
                <span class="preset-name">{{ name }}</span>
                <span class="preset-value">{{ value.toFixed(2) }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Decay Preview -->
        <DecayPreview
          :weight="weight"
          :projectId="projectId"
          :sessionId="sessionId"
        />

        <!-- Weight History -->
        <div v-if="marker.history && marker.history.length > 0" class="history-section">
          <label class="section-label">History:</label>
          <div class="history-list">
            <div
              v-for="(entry, idx) in marker.history.slice(-5)"
              :key="idx"
              class="history-entry"
            >
              <span class="history-weight">{{ entry.weight?.toFixed(2) || entry.oldWeight?.toFixed(2) }}</span>
              <span class="history-arrow">-></span>
              <span class="history-weight">{{ entry.newWeight?.toFixed(2) || '?' }}</span>
              <span class="history-date">{{ formatDate(entry.timestamp || entry.date) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="editor-footer">
        <div v-if="error" class="error-message">
          {{ error }}
        </div>

        <div class="change-indicator" v-if="hasChanges && !error">
          <span class="change-from">{{ marker.weight.toFixed(2) }}</span>
          <span class="change-arrow">-></span>
          <span class="change-to" :class="getWeightClass(weight)">{{ weight.toFixed(2) }}</span>
        </div>

        <div class="footer-actions">
          <button @click="$emit('close')" class="btn-cancel">Cancel</button>
          <button
            @click="saveWeight"
            class="btn-save"
            :disabled="!hasChanges || saving"
          >
            {{ saving ? 'Saving...' : 'Save Weight' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useMemoryStore } from '../../stores/memory.js';
import DecayPreview from './DecayPreview.vue';

const props = defineProps({
  marker: {
    type: Object,
    required: true
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

const emit = defineEmits(['close', 'saved']);

const memoryStore = useMemoryStore();
const weight = ref(props.marker.weight || 0.5);
const saving = ref(false);
const error = ref(null);

// Weight presets
const presets = {
  Pinned: 1.0,
  Critical: 0.85,
  Important: 0.70,
  Notable: 0.50,
  Minor: 0.30
};

const presetDescriptions = {
  Pinned: 'Always survives compression (1.00)',
  Critical: 'Very high priority, rarely summarized (0.85)',
  Important: 'High priority, occasionally summarized (0.70)',
  Notable: 'Medium priority, often summarized in aggressive modes (0.50)',
  Minor: 'Low priority, easily summarized (0.30)'
};

const hasChanges = computed(() => {
  return Math.abs(weight.value - props.marker.weight) > 0.001;
});

function clampWeight() {
  if (weight.value < 0) weight.value = 0;
  if (weight.value > 1) weight.value = 1;
  // Round to 2 decimal places
  weight.value = Math.round(weight.value * 100) / 100;
}

function getWeightClass(w) {
  if (w >= 0.95) return 'weight-pinned';
  if (w >= 0.80) return 'weight-critical';
  if (w >= 0.65) return 'weight-important';
  if (w >= 0.45) return 'weight-notable';
  return 'weight-minor';
}

function getWeightLabel(w) {
  if (w >= 0.95) return 'Pinned';
  if (w >= 0.80) return 'Critical';
  if (w >= 0.65) return 'Important';
  if (w >= 0.45) return 'Notable';
  return 'Minor';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function saveWeight() {
  if (!hasChanges.value || saving.value) return;

  saving.value = true;
  error.value = null;

  try {
    await memoryStore.updateKeepitWeight(
      props.projectId,
      props.sessionId,
      props.marker.id,
      weight.value
    );

    emit('saved', {
      markerId: props.marker.id,
      oldWeight: props.marker.weight,
      newWeight: weight.value
    });
    emit('close');
  } catch (err) {
    error.value = err.message || 'Failed to save weight';
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  // Load presets from backend if available
  if (!memoryStore.keepitPresets) {
    try {
      await memoryStore.loadKeepitPresets();
    } catch (err) {
      // Use default presets if loading fails
      console.warn('Could not load keepit presets, using defaults');
    }
  }
});
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

.keepit-editor {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 560px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.editor-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.btn-close {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  font-size: 1.5rem;
  line-height: 1;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.btn-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

.editor-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.section-label {
  display: block;
  font-weight: 600;
  color: #4a5568;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

/* Content Section */
.content-section {
  background: #f7fafc;
  border-radius: 6px;
  padding: 1rem;
  border-left: 4px solid #667eea;
}

.content-text {
  color: #333;
  font-size: 0.95rem;
  line-height: 1.5;
  word-break: break-word;
  max-height: 150px;
  overflow-y: auto;
}

.content-meta {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #e2e8f0;
  font-size: 0.8rem;
}

.meta-label {
  color: #718096;
}

.meta-value {
  font-family: monospace;
  color: #4a5568;
  margin-left: 0.25rem;
}

/* Weight Section */
.weight-section {
  background: #fafafa;
  border-radius: 6px;
  padding: 1rem;
  border: 1px solid #e2e8f0;
}

.weight-controls {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.weight-input-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.weight-input {
  width: 80px;
  padding: 0.5rem;
  border: 2px solid #e2e8f0;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 600;
  text-align: center;
  font-family: monospace;
}

.weight-input:focus {
  outline: none;
  border-color: #667eea;
}

.weight-indicator {
  padding: 0.35rem 0.75rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 600;
}

.weight-indicator.weight-pinned {
  background: #fed7d7;
  color: #c53030;
}

.weight-indicator.weight-critical {
  background: #feebc8;
  color: #c05621;
}

.weight-indicator.weight-important {
  background: #fefcbf;
  color: #975a16;
}

.weight-indicator.weight-notable {
  background: #c6f6d5;
  color: #276749;
}

.weight-indicator.weight-minor {
  background: #e2e8f0;
  color: #4a5568;
}

/* Slider */
.weight-slider {
  width: 100%;
}

.slider {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(to right,
    #e2e8f0 0%,
    #c6f6d5 25%,
    #fefcbf 50%,
    #feebc8 75%,
    #fed7d7 100%
  );
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  border: 3px solid #667eea;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  border: 3px solid #667eea;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 0.35rem;
  font-size: 0.75rem;
  color: #a0aec0;
}

.current-weight {
  font-weight: 600;
  color: #667eea;
  font-size: 0.85rem;
}

/* Presets */
.preset-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #e2e8f0;
}

.preset-label {
  display: block;
  font-size: 0.8rem;
  color: #718096;
  margin-bottom: 0.5rem;
}

.preset-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.preset-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 70px;
}

.preset-btn:hover {
  background: #f0f4ff;
  border-color: #667eea;
}

.preset-btn.active {
  background: #667eea;
  border-color: #667eea;
  color: white;
}

.preset-name {
  font-size: 0.75rem;
  font-weight: 600;
}

.preset-value {
  font-size: 0.7rem;
  font-family: monospace;
  margin-top: 0.1rem;
  opacity: 0.8;
}

/* History Section */
.history-section {
  background: #f9f9f9;
  border-radius: 6px;
  padding: 0.75rem 1rem;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.history-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  padding: 0.25rem;
}

.history-weight {
  font-family: monospace;
  color: #4a5568;
  font-weight: 500;
}

.history-arrow {
  color: #a0aec0;
}

.history-date {
  margin-left: auto;
  color: #a0aec0;
  font-size: 0.75rem;
}

/* Footer */
.editor-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: #f7fafc;
  border-top: 1px solid #e2e8f0;
}

.change-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.change-from {
  font-family: monospace;
  color: #718096;
}

.change-arrow {
  color: #a0aec0;
}

.change-to {
  font-family: monospace;
  font-weight: 600;
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
}

.change-to.weight-pinned {
  background: #fed7d7;
  color: #c53030;
}

.change-to.weight-critical {
  background: #feebc8;
  color: #c05621;
}

.change-to.weight-important {
  background: #fefcbf;
  color: #975a16;
}

.change-to.weight-notable {
  background: #c6f6d5;
  color: #276749;
}

.change-to.weight-minor {
  background: #e2e8f0;
  color: #4a5568;
}

.footer-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-cancel {
  padding: 0.5rem 1rem;
  background: #e2e8f0;
  color: #4a5568;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.2s ease;
}

.btn-cancel:hover {
  background: #cbd5e0;
}

.btn-save {
  padding: 0.5rem 1.25rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-save:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.error-message {
  flex: 1;
  padding: 0.5rem 0.75rem;
  background: #fed7d7;
  color: #c53030;
  border-radius: 4px;
  font-size: 0.85rem;
  margin-right: 1rem;
}
</style>
