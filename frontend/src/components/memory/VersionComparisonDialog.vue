<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="version-comparison">
      <div class="dialog-header">
        <h3>Compare Versions</h3>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>

      <div class="comparison-header">
        <div class="version-select left">
          <label>Version A:</label>
          <select v-model="versionA" @change="loadVersionContent('A')">
            <option value="original">
              Original ({{ formatTokens(session.originalTokens) }})
            </option>
            <option v-for="v in versions" :key="v.versionId" :value="v.versionId">
              {{ v.versionId }} - {{ formatTokens(v.outputTokens) }}
            </option>
          </select>
        </div>

        <div class="swap-button" @click="swapVersions" title="Swap versions">
          <SwapIcon />
        </div>

        <div class="version-select right">
          <label>Version B:</label>
          <select v-model="versionB" @change="loadVersionContent('B')">
            <option value="original">
              Original ({{ formatTokens(session.originalTokens) }})
            </option>
            <option v-for="v in versions" :key="v.versionId" :value="v.versionId">
              {{ v.versionId }} - {{ formatTokens(v.outputTokens) }}
            </option>
          </select>
        </div>
      </div>

      <div class="comparison-stats">
        <div class="stat">
          <span class="label">Token difference:</span>
          <span :class="tokenDiffClass">{{ tokenDiff }}</span>
        </div>
        <div class="stat">
          <span class="label">Compression A:</span>
          <span class="value">{{ compressionRatioA }}</span>
        </div>
        <div class="stat">
          <span class="label">Compression B:</span>
          <span class="value">{{ compressionRatioB }}</span>
        </div>
      </div>

      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <span>Loading version content...</span>
      </div>

      <div v-else class="comparison-content">
        <div class="content-panel left">
          <div class="panel-header">
            <span class="panel-title">{{ versionA === 'original' ? 'Original' : versionA }}</span>
            <span class="panel-tokens">{{ formatTokens(tokensA) }} tokens</span>
          </div>
          <div class="content-text">
            <pre>{{ contentA || 'No content loaded' }}</pre>
          </div>
        </div>

        <div class="content-panel right">
          <div class="panel-header">
            <span class="panel-title">{{ versionB === 'original' ? 'Original' : versionB }}</span>
            <span class="panel-tokens">{{ formatTokens(tokensB) }} tokens</span>
          </div>
          <div class="content-text">
            <pre>{{ contentB || 'No content loaded' }}</pre>
          </div>
        </div>
      </div>

      <div class="dialog-actions">
        <button @click="$emit('close')" class="btn-secondary">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useMemoryStore } from '../../stores/memory.js';
import SwapIcon from './icons/SwapIcon.vue';

const props = defineProps({
  session: {
    type: Object,
    required: true
  },
  versions: {
    type: Array,
    default: () => []
  },
  projectId: {
    type: String,
    required: true
  }
});

defineEmits(['close']);

const memoryStore = useMemoryStore();

// Selection state
const versionA = ref('original');
const versionB = ref(props.versions.length > 0 ? props.versions[0].versionId : 'original');

// Content state
const contentA = ref('');
const contentB = ref('');
const tokensA = ref(0);
const tokensB = ref(0);
const loading = ref(false);

// Computed stats
const tokenDiff = computed(() => {
  const diff = tokensB.value - tokensA.value;
  if (diff === 0) return 'No difference';
  const prefix = diff > 0 ? '+' : '';
  return prefix + formatTokens(diff);
});

const tokenDiffClass = computed(() => {
  const diff = tokensB.value - tokensA.value;
  if (diff > 0) return 'value-negative';
  if (diff < 0) return 'value-positive';
  return 'value';
});

const compressionRatioA = computed(() => {
  if (versionA.value === 'original') return '1:1';
  const version = props.versions.find(v => v.versionId === versionA.value);
  return version?.compressionRatio ? version.compressionRatio.toFixed(1) + ':1' : 'N/A';
});

const compressionRatioB = computed(() => {
  if (versionB.value === 'original') return '1:1';
  const version = props.versions.find(v => v.versionId === versionB.value);
  return version?.compressionRatio ? version.compressionRatio.toFixed(1) + ':1' : 'N/A';
});

onMounted(async () => {
  await loadBothVersions();
});

watch([versionA, versionB], () => {
  loadBothVersions();
});

async function loadBothVersions() {
  loading.value = true;
  try {
    await Promise.all([
      loadVersionContent('A'),
      loadVersionContent('B')
    ]);
  } catch (err) {
    console.error('Failed to load versions:', err);
  } finally {
    loading.value = false;
  }
}

async function loadVersionContent(side) {
  const version = side === 'A' ? versionA.value : versionB.value;

  try {
    if (version === 'original') {
      // Load original session content
      const content = await fetchOriginalContent();
      if (side === 'A') {
        contentA.value = content;
        tokensA.value = props.session.originalTokens || 0;
      } else {
        contentB.value = content;
        tokensB.value = props.session.originalTokens || 0;
      }
    } else {
      // Load compression version content
      const result = await memoryStore.getVersionContent(
        props.projectId,
        props.session.sessionId,
        version,
        'md'
      );

      const versionInfo = props.versions.find(v => v.versionId === version);

      if (side === 'A') {
        contentA.value = result.content || result;
        tokensA.value = versionInfo?.outputTokens || 0;
      } else {
        contentB.value = result.content || result;
        tokensB.value = versionInfo?.outputTokens || 0;
      }
    }
  } catch (err) {
    console.error(`Failed to load ${side} content:`, err);
    if (side === 'A') {
      contentA.value = 'Failed to load content';
    } else {
      contentB.value = 'Failed to load content';
    }
  }
}

async function fetchOriginalContent() {
  // Fetch original session content using the 'original' pseudo-version
  const result = await memoryStore.getVersionContent(
    props.projectId,
    props.session.sessionId,
    'original',
    'md'
  );
  // Result may be a string or an object with a content property
  return typeof result === 'string' ? result : (result.content || result);
}

function swapVersions() {
  const temp = versionA.value;
  versionA.value = versionB.value;
  versionB.value = temp;

  const tempContent = contentA.value;
  contentA.value = contentB.value;
  contentB.value = tempContent;

  const tempTokens = tokensA.value;
  tokensA.value = tokensB.value;
  tokensB.value = tempTokens;
}

function formatTokens(tokens) {
  if (!tokens) return '0';
  const absTokens = Math.abs(tokens);
  if (absTokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  }
  if (absTokens >= 1000) {
    return Math.round(tokens / 1000) + 'K';
  }
  return tokens.toLocaleString();
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

.version-comparison {
  background: white;
  border-radius: 8px;
  width: 95%;
  max-width: 1200px;
  max-height: 90vh;
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

.comparison-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: #f0f4ff;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.version-select {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.version-select label {
  font-size: 0.8rem;
  color: #666;
  font-weight: 500;
}

.version-select select {
  padding: 0.5rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
  background: white;
  min-width: 200px;
}

.version-select select:focus {
  outline: none;
  border-color: #667eea;
}

.swap-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 50%;
  cursor: pointer;
  color: #667eea;
  transition: all 0.2s ease;
}

.swap-button:hover {
  background: #667eea;
  color: white;
  border-color: #667eea;
}

.comparison-stats {
  display: flex;
  justify-content: center;
  gap: 2rem;
  padding: 0.75rem 1.5rem;
  background: #fafafa;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.stat {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.stat .label {
  font-size: 0.8rem;
  color: #666;
}

.stat .value {
  font-size: 0.85rem;
  font-weight: 600;
  color: #333;
}

.stat .value-positive {
  font-size: 0.85rem;
  font-weight: 600;
  color: #059669;
}

.stat .value-negative {
  font-size: 0.85rem;
  font-weight: 600;
  color: #dc2626;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  gap: 1rem;
  flex: 1;
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

.comparison-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.content-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-panel.left {
  border-right: 1px solid #e0e0e0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.panel-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #333;
  font-family: monospace;
}

.panel-tokens {
  font-size: 0.8rem;
  color: #667eea;
  font-weight: 500;
}

.content-text {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  background: #fafafa;
}

.content-text pre {
  margin: 0;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  color: #333;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e0e0e0;
  background: #f9f9f9;
  flex-shrink: 0;
}

.btn-secondary {
  padding: 0.5rem 1.25rem;
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
</style>
