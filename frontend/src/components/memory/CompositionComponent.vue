<template>
  <div
    class="composition-component"
    :class="{ dragging, expanded }"
    ref="componentRef"
  >
    <div class="drag-handle" @mousedown="$emit('drag-start', $event)">
      <span class="drag-icon">&#x2630;</span>
    </div>

    <div class="component-main">
      <div class="component-header" @click="expanded = !expanded">
        <div class="component-info">
          <span class="component-order">{{ orderIndex }}</span>
          <div class="session-details">
            <span class="session-name" :title="component.sessionId">
              {{ formatSessionId(component.sessionId) }}
            </span>
            <span v-if="session" class="session-date">
              {{ formatDate(session.firstTimestamp) }}
            </span>
          </div>
        </div>

        <div class="component-stats">
          <span class="stat-item" :title="'Original: ' + component.originalTokens + ' tokens'">
            <span class="stat-label">Original:</span>
            <span class="stat-value">{{ formatTokens(component.originalTokens) }}</span>
          </span>
          <span class="expand-icon" :class="{ rotated: expanded }">&#x25BC;</span>
        </div>
      </div>

      <div v-if="expanded" class="component-details">
        <div class="version-section">
          <label class="section-label">Version:</label>
          <select
            v-model="selectedVersionId"
            @change="handleVersionChange"
            class="version-select"
          >
            <option value="auto">Auto-select best fit</option>
            <option value="original">Original (uncompressed)</option>
            <option
              v-for="v in availableVersions"
              :key="v.versionId"
              :value="v.versionId"
            >
              {{ v.versionId.substring(0, 8) }} - {{ formatTokens(v.outputTokens) }} tokens
              ({{ v.compressionRatio }}x)
            </option>
            <option value="recompress" :disabled="!allowRecompress">
              Recompress to target...
            </option>
          </select>

          <div v-if="selectedVersionId === 'recompress'" class="recompress-settings">
            <label class="recompress-label">
              Target tokens:
              <input
                v-model.number="recompressTarget"
                type="number"
                min="100"
                :max="component.originalTokens"
                step="100"
                class="recompress-input"
              />
            </label>
            <button
              @click="startRecompress"
              class="btn-recompress"
              :disabled="recompressing"
            >
              {{ recompressing ? 'Compressing...' : 'Compress' }}
            </button>
          </div>
        </div>

        <div class="allocation-section">
          <label class="section-label">Token Allocation:</label>
          <div class="allocation-input-group">
            <input
              v-model.number="localAllocation"
              type="number"
              min="0"
              :max="totalBudget"
              step="100"
              class="allocation-input"
              @change="handleAllocationChange"
            />
            <span class="allocation-suffix">tokens</span>
          </div>
          <div class="allocation-helpers">
            <button
              v-for="preset in allocationPresets"
              :key="preset.percent"
              @click="setAllocationPreset(preset.percent)"
              class="preset-btn"
              :title="preset.label"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>

        <div v-if="selectedVersion" class="version-info">
          <div class="info-row">
            <span class="info-label">Compression:</span>
            <span class="info-value">{{ selectedVersion.compressionRatio || 1 }}x</span>
          </div>
          <div class="info-row">
            <span class="info-label">Output tokens:</span>
            <span class="info-value">{{ formatTokens(selectedVersion.outputTokens || component.originalTokens) }}</span>
          </div>
          <div v-if="selectedVersion.keepitStats" class="info-row">
            <span class="info-label">Keepits preserved:</span>
            <span class="info-value">{{ selectedVersion.keepitStats.preserved || 0 }}</span>
          </div>
        </div>
      </div>
    </div>

    <button class="remove-btn" @click="$emit('remove')" title="Remove from composition">
      &times;
    </button>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  component: {
    type: Object,
    required: true
  },
  session: {
    type: Object,
    default: null
  },
  availableVersions: {
    type: Array,
    default: () => []
  },
  orderIndex: {
    type: Number,
    default: 1
  },
  dragging: {
    type: Boolean,
    default: false
  },
  totalBudget: {
    type: Number,
    default: 100000
  },
  allowRecompress: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['update', 'remove', 'drag-start', 'recompress']);

const expanded = ref(false);
const selectedVersionId = ref(props.component.versionId || 'auto');
const localAllocation = ref(props.component.tokenAllocation || 0);
const recompressTarget = ref(Math.floor((props.component.originalTokens || 10000) / 5));
const recompressing = ref(false);
const componentRef = ref(null);

const allocationPresets = [
  { percent: 10, label: '10%' },
  { percent: 25, label: '25%' },
  { percent: 50, label: '50%' },
  { percent: 100, label: 'Max' }
];

const selectedVersion = computed(() => {
  if (selectedVersionId.value === 'auto' || selectedVersionId.value === 'original') {
    return {
      outputTokens: props.component.originalTokens,
      compressionRatio: 1
    };
  }
  return props.availableVersions.find(v => v.versionId === selectedVersionId.value);
});

watch(() => props.component.versionId, (newVal) => {
  selectedVersionId.value = newVal || 'auto';
});

watch(() => props.component.tokenAllocation, (newVal) => {
  localAllocation.value = newVal || 0;
});

function handleVersionChange() {
  emit('update', {
    ...props.component,
    versionId: selectedVersionId.value === 'auto' ? null : selectedVersionId.value
  });
}

function handleAllocationChange() {
  emit('update', {
    ...props.component,
    tokenAllocation: localAllocation.value
  });
}

function setAllocationPreset(percent) {
  if (percent === 100) {
    // Max - use selected version's output tokens or original
    const maxTokens = selectedVersion.value?.outputTokens || props.component.originalTokens;
    localAllocation.value = maxTokens;
  } else {
    localAllocation.value = Math.floor(props.totalBudget * percent / 100);
  }
  handleAllocationChange();
}

function startRecompress() {
  recompressing.value = true;
  emit('recompress', {
    sessionId: props.component.sessionId,
    targetTokens: recompressTarget.value,
    callback: () => {
      recompressing.value = false;
    }
  });
}

function formatSessionId(id) {
  if (!id) return 'Unknown';
  if (id.length > 16) {
    return id.substring(0, 8) + '...' + id.substring(id.length - 4);
  }
  return id;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function formatTokens(num) {
  if (!num || num === 0) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toLocaleString();
}
</script>

<style scoped>
.composition-component {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.composition-component:hover {
  border-color: #cbd5e1;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.composition-component.dragging {
  opacity: 0.5;
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.composition-component.expanded {
  border-color: #667eea;
}

.drag-handle {
  cursor: grab;
  padding: 0.25rem;
  color: #94a3b8;
  user-select: none;
  display: flex;
  align-items: center;
  transition: color 0.2s ease;
}

.drag-handle:hover {
  color: #64748b;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-icon {
  font-size: 1rem;
}

.component-main {
  flex: 1;
  min-width: 0;
}

.component-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  padding: 0.25rem 0;
}

.component-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.component-order {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #667eea;
  color: white;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 600;
  flex-shrink: 0;
}

.session-details {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.session-name {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.9rem;
  font-weight: 500;
  color: #334155;
}

.session-date {
  font-size: 0.75rem;
  color: #64748b;
}

.component-stats {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
}

.stat-label {
  color: #94a3b8;
}

.stat-value {
  color: #475569;
  font-weight: 500;
}

.expand-icon {
  font-size: 0.65rem;
  color: #94a3b8;
  transition: transform 0.2s ease;
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

.component-details {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #475569;
  display: block;
  margin-bottom: 0.375rem;
}

.version-section {
  display: flex;
  flex-direction: column;
}

.version-select {
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.85rem;
  background: white;
  cursor: pointer;
  max-width: 300px;
}

.version-select:hover {
  border-color: #667eea;
}

.version-select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
}

.recompress-settings {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  margin-top: 0.5rem;
  padding: 0.75rem;
  background: #f8fafc;
  border-radius: 6px;
}

.recompress-label {
  font-size: 0.8rem;
  color: #475569;
}

.recompress-input {
  display: block;
  margin-top: 0.25rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  width: 100px;
  font-size: 0.85rem;
}

.btn-recompress {
  padding: 0.375rem 0.75rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-recompress:hover:not(:disabled) {
  background: #5a67d8;
}

.btn-recompress:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.allocation-section {
  display: flex;
  flex-direction: column;
}

.allocation-input-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.allocation-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.85rem;
  width: 120px;
}

.allocation-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
}

.allocation-suffix {
  font-size: 0.85rem;
  color: #64748b;
}

.allocation-helpers {
  display: flex;
  gap: 0.375rem;
  margin-top: 0.5rem;
}

.preset-btn {
  padding: 0.25rem 0.5rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  font-size: 0.75rem;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}

.preset-btn:hover {
  background: #e2e8f0;
  border-color: #cbd5e1;
  color: #475569;
}

.version-info {
  padding: 0.75rem;
  background: #f8fafc;
  border-radius: 6px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  font-size: 0.8rem;
}

.info-label {
  color: #64748b;
}

.info-value {
  color: #334155;
  font-weight: 500;
}

.remove-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 1.25rem;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.remove-btn:hover {
  background: #fee2e2;
  color: #dc2626;
}
</style>
