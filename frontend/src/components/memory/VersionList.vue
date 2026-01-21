<template>
  <div class="version-list">
    <!-- Parts-based view (when parts available) -->
    <template v-if="groupedParts.length > 0">
      <div v-for="part in groupedParts" :key="part.partNumber" class="part-group">
        <div class="part-header">
          <div class="part-title">
            <span class="part-number">Part {{ part.partNumber }}</span>
            <span v-if="part.messageRange" class="part-range">
              Messages {{ part.messageRange.startIndex + 1 }}-{{ part.messageRange.endIndex }}
            </span>
          </div>
          <button
            @click="$emit('recompress-part', part.partNumber)"
            class="btn-recompress"
            title="Re-compress this part at different level"
          >
            + Version
          </button>
        </div>

        <div v-for="version in part.versions" :key="version.versionId" class="version-item">
          <div class="version-info">
            <div class="version-header">
              <span class="version-id">{{ version.versionId }}</span>
              <span v-if="version.compressionLevel" class="compression-level" :class="'level-' + version.compressionLevel">
                {{ getLevelLabel(version.compressionLevel) }}
              </span>
              <span class="version-date">{{ formatDate(version.createdAt) }}</span>
            </div>
            <div class="version-details">
              <span class="version-mode">
                {{ formatMode(version.settings) }}
              </span>
              <span class="version-tokens">
                {{ formatTokens(version.outputTokens) }} tokens
              </span>
              <span class="version-ratio" :class="getRatioClass(version.compressionRatio)">
                {{ version.compressionRatio ? version.compressionRatio.toFixed(1) : '?' }}:1
              </span>
            </div>
          </div>
          <div class="version-actions">
            <button @click="$emit('view', version)" class="btn-action" title="View content">
              <ViewIcon />
            </button>
            <button
              @click="$emit('delete', version)"
              class="btn-action btn-danger"
              title="Delete version"
              :disabled="version.usedInCompositions > 0"
            >
              <DeleteIcon />
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Legacy view (flat list when no parts) -->
    <template v-else>
      <div v-for="version in versions" :key="version.versionId" class="version-item">
        <div class="version-info">
          <div class="version-header">
            <span class="version-id">{{ version.versionId }}</span>
            <span class="version-date">{{ formatDate(version.createdAt) }}</span>
          </div>
          <div class="version-details">
            <span class="version-mode">
              {{ formatMode(version.settings) }}
            </span>
            <span class="version-tokens">
              {{ formatTokens(version.outputTokens) }} tokens
            </span>
            <span class="version-ratio" :class="getRatioClass(version.compressionRatio)">
              {{ version.compressionRatio ? version.compressionRatio.toFixed(1) : '?' }}:1
            </span>
          </div>
          <div v-if="version.description" class="version-description">
            {{ version.description }}
          </div>
        </div>
        <div class="version-actions">
          <button @click="$emit('view', version)" class="btn-action" title="View content">
            <ViewIcon />
          </button>
          <button
            @click="$emit('delete', version)"
            class="btn-action btn-danger"
            title="Delete version"
            :disabled="version.usedInCompositions > 0"
          >
            <DeleteIcon />
          </button>
        </div>
      </div>
    </template>

    <div v-if="versions.length === 0" class="no-versions">
      <span>No compression versions yet</span>
      <p class="hint">Create a compression to reduce token count while preserving important context</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import ViewIcon from './icons/ViewIcon.vue';
import DeleteIcon from './icons/DeleteIcon.vue';

const props = defineProps({
  versions: {
    type: Array,
    default: () => []
  },
  parts: {
    type: Array,
    default: () => []
  }
});

defineEmits(['view', 'delete', 'recompress-part']);

// Group versions by part number
const groupedParts = computed(() => {
  // If parts are provided directly from API, use them
  if (props.parts && props.parts.length > 0) {
    return props.parts.map(part => ({
      partNumber: part.partNumber,
      messageRange: part.messageRange,
      versions: part.versions || []
    })).sort((a, b) => a.partNumber - b.partNumber);
  }

  // Otherwise, group versions by partNumber if they have one
  const groups = new Map();

  for (const v of props.versions) {
    if (v.partNumber === undefined) continue; // Skip versions without part info
    const partNum = v.partNumber || 1;
    if (!groups.has(partNum)) {
      groups.set(partNum, {
        partNumber: partNum,
        messageRange: v.messageRange,
        versions: []
      });
    }
    groups.get(partNum).versions.push(v);
  }

  // Sort versions within each part by compression level
  for (const group of groups.values()) {
    group.versions.sort((a, b) => (a.compressionLevel || 1) - (b.compressionLevel || 1));
  }

  // Return sorted by part number
  return Array.from(groups.values()).sort((a, b) => a.partNumber - b.partNumber);
});

function formatMode(settings) {
  if (!settings) return 'Unknown';

  const mode = settings.mode === 'tiered' ? 'Variable' : 'Uniform';

  if (settings.mode === 'tiered' && settings.tierPreset) {
    return `${mode} (${settings.tierPreset})`;
  }

  if (settings.compactionRatio) {
    return `${mode} ${settings.compactionRatio}:1`;
  }

  return mode;
}

function formatTokens(tokens) {
  if (!tokens) return '0';
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  }
  if (tokens >= 1000) {
    return Math.round(tokens / 1000) + 'K';
  }
  return tokens.toLocaleString();
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getRatioClass(ratio) {
  if (!ratio) return '';
  if (ratio >= 10) return 'ratio-high';
  if (ratio >= 5) return 'ratio-medium';
  return 'ratio-low';
}

function getLevelLabel(level) {
  if (level === 1) return 'Light';
  if (level === 2) return 'Moderate';
  if (level === 3) return 'Aggressive';
  return 'Custom';
}
</script>

<style scoped>
.version-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.part-group {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.part-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 1px solid #e0e0e0;
}

.part-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.part-number {
  font-weight: 600;
  font-size: 0.85rem;
  color: #334155;
}

.part-range {
  font-size: 0.75rem;
  color: #64748b;
  padding: 0.125rem 0.375rem;
  background: #e2e8f0;
  border-radius: 3px;
}

.btn-recompress {
  padding: 0.25rem 0.5rem;
  background: white;
  color: #667eea;
  border: 1px solid #667eea;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-recompress:hover {
  background: #f0f4ff;
}

.part-group .version-item {
  border: none;
  border-radius: 0;
  border-bottom: 1px solid #f0f0f0;
}

.part-group .version-item:last-child {
  border-bottom: none;
}

.compression-level {
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 500;
}

.compression-level.level-1 {
  background: #dcfce7;
  color: #166534;
}

.compression-level.level-2 {
  background: #fef3c7;
  color: #92400e;
}

.compression-level.level-3 {
  background: #fee2e2;
  color: #991b1b;
}

.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.version-item:hover {
  border-color: #667eea;
  background-color: #fafbff;
}

.version-info {
  flex: 1;
  min-width: 0;
}

.version-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}

.version-id {
  font-family: monospace;
  font-size: 0.85rem;
  font-weight: 600;
  color: #333;
}

.version-date {
  font-size: 0.75rem;
  color: #999;
}

.version-details {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.version-mode {
  font-size: 0.8rem;
  color: #666;
  padding: 0.125rem 0.375rem;
  background: #f0f0f0;
  border-radius: 3px;
}

.version-tokens {
  font-size: 0.8rem;
  color: #667eea;
  font-weight: 500;
}

.version-ratio {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
}

.version-ratio.ratio-high {
  background: #dcfce7;
  color: #166534;
}

.version-ratio.ratio-medium {
  background: #fef3c7;
  color: #92400e;
}

.version-ratio.ratio-low {
  background: #fee2e2;
  color: #991b1b;
}

.version-description {
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: #666;
  font-style: italic;
}

.version-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #f5f5f5;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  color: #666;
  transition: all 0.2s ease;
}

.btn-action:hover:not(:disabled) {
  background: #e0e0e0;
  color: #333;
}

.btn-action.btn-danger:hover:not(:disabled) {
  background: #ffebee;
  border-color: #d32f2f;
  color: #d32f2f;
}

.btn-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.no-versions {
  text-align: center;
  padding: 1.5rem;
  background: #f9f9f9;
  border: 1px dashed #ddd;
  border-radius: 6px;
}

.no-versions span {
  font-size: 0.9rem;
  color: #666;
}

.no-versions .hint {
  margin: 0.5rem 0 0 0;
  font-size: 0.8rem;
  color: #999;
}
</style>
