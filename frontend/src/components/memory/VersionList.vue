<template>
  <div class="version-list">
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

    <div v-if="versions.length === 0" class="no-versions">
      <span>No compression versions yet</span>
      <p class="hint">Create a compression to reduce token count while preserving important context</p>
    </div>
  </div>
</template>

<script setup>
import ViewIcon from './icons/ViewIcon.vue';
import DeleteIcon from './icons/DeleteIcon.vue';

defineProps({
  versions: {
    type: Array,
    default: () => []
  }
});

defineEmits(['view', 'delete']);

function formatMode(settings) {
  if (!settings) return 'Unknown';

  const mode = settings.mode === 'tiered' ? 'Variable' : 'Uniform';
  const level = settings.tierPreset || settings.aggressiveness || '';

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
</script>

<style scoped>
.version-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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
