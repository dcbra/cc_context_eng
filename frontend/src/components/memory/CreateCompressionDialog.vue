<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="compression-dialog">
      <div class="dialog-header">
        <h3>Create Compression</h3>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>

      <div class="original-info">
        <span class="info-label">Original:</span>
        <span class="info-value">{{ formatTokens(originalTokens) }} tokens</span>
        <span class="info-separator">|</span>
        <span class="info-value">{{ originalMessages }} messages</span>
      </div>

      <!-- Mode Toggle -->
      <div class="mode-toggle">
        <label :class="{ active: !useTiers }">
          <input type="radio" :value="false" v-model="useTiers" />
          <span>Uniform</span>
        </label>
        <label :class="{ active: useTiers }">
          <input type="radio" :value="true" v-model="useTiers" />
          <span>Variable (Tiered)</span>
        </label>
      </div>

      <!-- Uniform Settings -->
      <div v-if="!useTiers" class="settings-section">
        <div class="setting-row">
          <label class="setting-label">
            <span class="label-text">Compaction Ratio</span>
            <select v-model.number="settings.compactionRatio" class="setting-select">
              <option v-for="ratio in compactionRatios" :key="ratio" :value="ratio">
                {{ ratio }}:1{{ getRatioLabel(ratio) }}
              </option>
            </select>
          </label>
        </div>

        <div class="setting-row">
          <label class="setting-label">
            <span class="label-text">Aggressiveness</span>
            <select v-model="settings.aggressiveness" class="setting-select">
              <option value="minimal">Minimal - Preserve detail</option>
              <option value="moderate">Moderate - Balanced</option>
              <option value="aggressive">Aggressive - Max compression</option>
            </select>
          </label>
        </div>
      </div>

      <!-- Tiered Settings -->
      <div v-else class="settings-section">
        <div class="setting-row">
          <label class="setting-label">
            <span class="label-text">Preset</span>
            <select v-model="settings.tierPreset" class="setting-select">
              <option value="gentle">Gentle - Light compression</option>
              <option value="standard">Standard - Balanced</option>
              <option value="aggressive">Aggressive - Max compression</option>
              <option value="custom">Custom tiers</option>
            </select>
          </label>
        </div>

        <!-- Preset Description -->
        <div v-if="settings.tierPreset !== 'custom' && presets" class="preset-description">
          <span v-if="presets[settings.tierPreset]">
            {{ presets[settings.tierPreset].description }}
          </span>
        </div>

        <!-- Tier Visualization -->
        <div class="tier-visualization">
          <div
            v-for="(tier, idx) in activeTiers"
            :key="idx"
            class="tier-bar"
            :style="{ width: getTierWidth(idx) + '%' }"
            :class="'tier-' + tier.aggressiveness"
          >
            <span class="tier-label">{{ tier.compactionRatio }}:1</span>
          </div>
        </div>
        <div class="tier-legend">
          <span>0%</span>
          <span>Older messages</span>
          <span>Recent messages</span>
          <span>100%</span>
        </div>

        <!-- Custom Tier Editor -->
        <div v-if="settings.tierPreset === 'custom'" class="custom-tiers">
          <div class="custom-tiers-header">
            <span class="header-range">Range</span>
            <span class="header-ratio">Ratio</span>
            <span class="header-level">Level</span>
          </div>
          <div v-for="(tier, idx) in settings.customTiers" :key="idx" class="custom-tier-row">
            <span class="tier-range">
              {{ idx === 0 ? '0' : settings.customTiers[idx-1].endPercent }}-{{ tier.endPercent }}%
            </span>
            <select
              :value="tier.compactionRatio"
              @change="updateCustomTier(idx, 'compactionRatio', Number($event.target.value))"
              class="tier-select"
            >
              <option v-for="ratio in compactionRatios" :key="ratio" :value="ratio">{{ ratio }}:1</option>
            </select>
            <select
              :value="tier.aggressiveness"
              @change="updateCustomTier(idx, 'aggressiveness', $event.target.value)"
              class="tier-select"
            >
              <option value="minimal">Minimal</option>
              <option value="moderate">Moderate</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Model Selection -->
      <div class="settings-section">
        <div class="setting-row">
          <label class="setting-label">
            <span class="label-text">Model</span>
            <select v-model="settings.model" class="setting-select">
              <option value="opus">Opus (Best quality)</option>
              <option value="sonnet">Sonnet (Faster)</option>
              <option value="haiku">Haiku (Fastest)</option>
            </select>
          </label>
        </div>
      </div>

      <!-- Keepit Settings -->
      <div class="settings-section keepit-settings">
        <h4>Keepit Handling</h4>
        <div class="setting-row">
          <label class="setting-label">
            <span class="label-text">Session Distance</span>
            <input
              type="number"
              v-model.number="settings.sessionDistance"
              min="1"
              max="10"
              class="setting-input"
            />
            <span class="setting-hint">Higher = less decay (1-10)</span>
          </label>
        </div>

        <div v-if="decayPreview" class="decay-preview">
          <span class="decay-icon">i</span>
          <span class="decay-text">
            {{ decayPreview.total }} markers total |
            {{ decayPreview.surviving }} will survive
          </span>
        </div>
      </div>

      <!-- Description -->
      <div class="settings-section">
        <div class="setting-row">
          <label class="setting-label">
            <span class="label-text">Description (optional)</span>
            <input
              type="text"
              v-model="settings.description"
              placeholder="Add a note about this compression..."
              class="setting-input full"
            />
          </label>
        </div>
      </div>

      <!-- Preview -->
      <div v-if="preview" class="compression-preview">
        <div class="preview-row">
          <span class="preview-label">Estimated output:</span>
          <span class="preview-value">~{{ formatTokens(preview.estimatedTokens) }} tokens</span>
        </div>
        <div class="preview-row">
          <span class="preview-label">Compression ratio:</span>
          <span class="preview-value highlight">~{{ preview.estimatedRatio }}:1</span>
        </div>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>

      <div class="dialog-actions">
        <button @click="loadPreview" class="btn-secondary" :disabled="loadingPreview">
          {{ loadingPreview ? 'Loading...' : 'Preview' }}
        </button>
        <button @click="$emit('close')" class="btn-cancel">Cancel</button>
        <button @click="createCompression" class="btn-primary" :disabled="creating">
          {{ creating ? 'Creating...' : 'Create Compression' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useMemoryStore } from '../../stores/memory.js';

const props = defineProps({
  sessionId: {
    type: String,
    required: true
  },
  projectId: {
    type: String,
    required: true
  },
  originalTokens: {
    type: Number,
    default: 0
  },
  originalMessages: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['close', 'created']);

const memoryStore = useMemoryStore();

// Settings state
const useTiers = ref(false);
const settings = ref({
  compactionRatio: 10,
  aggressiveness: 'moderate',
  model: 'sonnet',
  tierPreset: 'standard',
  customTiers: [
    { endPercent: 25, compactionRatio: 35, aggressiveness: 'aggressive' },
    { endPercent: 50, compactionRatio: 20, aggressiveness: 'aggressive' },
    { endPercent: 75, compactionRatio: 10, aggressiveness: 'moderate' },
    { endPercent: 90, compactionRatio: 5, aggressiveness: 'moderate' },
    { endPercent: 100, compactionRatio: 3, aggressiveness: 'minimal' }
  ],
  sessionDistance: 3,
  description: ''
});

const compactionRatios = ref([2, 3, 4, 5, 10, 15, 20, 25, 35, 50]);
const presets = ref(null);
const preview = ref(null);
const decayPreview = ref(null);
const loadingPreview = ref(false);
const creating = ref(false);
const error = ref(null);

// Computed active tiers based on preset or custom
const activeTiers = computed(() => {
  if (settings.value.tierPreset === 'custom') {
    return settings.value.customTiers;
  }
  if (presets.value && presets.value[settings.value.tierPreset]) {
    return presets.value[settings.value.tierPreset].tiers;
  }
  return [];
});

onMounted(async () => {
  try {
    // Load compression presets
    await memoryStore.loadCompressionPresets();
    presets.value = memoryStore.compressionPresets;
  } catch (err) {
    console.warn('Failed to load presets:', err);
  }
});

// Watch for decay preview updates
watch(
  () => settings.value.sessionDistance,
  async () => {
    await loadDecayPreview();
  },
  { immediate: true }
);

async function loadDecayPreview() {
  try {
    decayPreview.value = await memoryStore.previewKeepitDecay(
      props.projectId,
      props.sessionId,
      { sessionDistance: settings.value.sessionDistance }
    );
  } catch (err) {
    console.warn('Failed to load decay preview:', err);
  }
}

async function loadPreview() {
  loadingPreview.value = true;
  error.value = null;

  try {
    const compressionSettings = buildSettings();
    const result = await memoryStore.validateCompressionSettings(
      props.projectId,
      props.sessionId,
      compressionSettings
    );
    preview.value = result;
  } catch (err) {
    error.value = err.message || 'Failed to load preview';
  } finally {
    loadingPreview.value = false;
  }
}

async function createCompression() {
  creating.value = true;
  error.value = null;

  try {
    const compressionSettings = buildSettings();
    const version = await memoryStore.createCompressionVersion(
      props.projectId,
      props.sessionId,
      compressionSettings
    );
    emit('created', version);
  } catch (err) {
    error.value = err.message || 'Failed to create compression';
  } finally {
    creating.value = false;
  }
}

function buildSettings() {
  const base = {
    model: settings.value.model,
    sessionDistance: settings.value.sessionDistance,
    description: settings.value.description || undefined
  };

  if (useTiers.value) {
    return {
      ...base,
      mode: 'tiered',
      tierPreset: settings.value.tierPreset !== 'custom' ? settings.value.tierPreset : undefined,
      tiers: settings.value.tierPreset === 'custom' ? settings.value.customTiers : undefined
    };
  }

  return {
    ...base,
    mode: 'uniform',
    compactionRatio: settings.value.compactionRatio,
    aggressiveness: settings.value.aggressiveness
  };
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

function getRatioLabel(ratio) {
  if (ratio <= 5) return ' (Light)';
  if (ratio <= 15) return ' (Moderate)';
  if (ratio <= 25) return ' (Strong)';
  return ' (Aggressive)';
}

function getTierWidth(index) {
  const tiers = activeTiers.value;
  if (!tiers || tiers.length === 0) return 0;
  const prevEnd = index > 0 ? tiers[index - 1].endPercent : 0;
  return tiers[index].endPercent - prevEnd;
}

function updateCustomTier(index, field, value) {
  settings.value.customTiers[index][field] = value;
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

.compression-dialog {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 550px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e0e0e0;
  background: #f9f9f9;
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

.original-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: #f0f4ff;
  border-bottom: 1px solid #e0e0e0;
}

.info-label {
  font-size: 0.85rem;
  color: #666;
}

.info-value {
  font-size: 0.9rem;
  font-weight: 600;
  color: #667eea;
}

.info-separator {
  color: #ccc;
}

.mode-toggle {
  display: flex;
  gap: 0;
  margin: 1rem 1.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
}

.mode-toggle label {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  color: #4a5568;
  transition: all 0.2s ease;
}

.mode-toggle label input {
  display: none;
}

.mode-toggle label:hover {
  background: #f7fafc;
}

.mode-toggle label.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.settings-section {
  padding: 0 1.5rem 1rem 1.5rem;
}

.settings-section h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.9rem;
  color: #333;
}

.setting-row {
  margin-bottom: 0.75rem;
}

.setting-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.label-text {
  min-width: 130px;
  font-size: 0.85rem;
  color: #4a5568;
  font-weight: 500;
}

.setting-select,
.setting-input {
  flex: 1;
  padding: 0.4rem 0.6rem;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  font-size: 0.85rem;
  background: white;
}

.setting-input.full {
  width: 100%;
}

.setting-select:focus,
.setting-input:focus {
  outline: none;
  border-color: #667eea;
}

.setting-hint {
  font-size: 0.75rem;
  color: #a0aec0;
  margin-left: 0.5rem;
}

.preset-description {
  padding: 0.5rem;
  background: #f7fafc;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #718096;
  font-style: italic;
  margin-bottom: 0.75rem;
}

.tier-visualization {
  display: flex;
  height: 32px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  margin-bottom: 0.25rem;
}

.tier-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 50px;
  transition: all 0.2s ease;
}

.tier-bar.tier-aggressive {
  background: linear-gradient(135deg, #fc8181 0%, #f56565 100%);
  color: white;
}

.tier-bar.tier-moderate {
  background: linear-gradient(135deg, #f6e05e 0%, #ecc94b 100%);
  color: #744210;
}

.tier-bar.tier-minimal {
  background: linear-gradient(135deg, #68d391 0%, #48bb78 100%);
  color: white;
}

.tier-label {
  font-size: 0.7rem;
  font-weight: 600;
}

.tier-legend {
  display: flex;
  justify-content: space-between;
  font-size: 0.65rem;
  color: #a0aec0;
  padding: 0.25rem 0;
  margin-bottom: 0.75rem;
}

.custom-tiers {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.75rem;
  background: #f7fafc;
  border-radius: 4px;
}

.custom-tiers-header {
  display: flex;
  gap: 0.5rem;
  padding-bottom: 0.375rem;
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.65rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
}

.header-range { min-width: 70px; }
.header-ratio { min-width: 70px; }
.header-level { flex: 1; }

.custom-tier-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tier-range {
  min-width: 70px;
  font-size: 0.8rem;
  font-weight: 500;
  color: #4a5568;
}

.tier-select {
  padding: 0.25rem 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  font-size: 0.8rem;
  background: white;
}

.tier-select:focus {
  outline: none;
  border-color: #667eea;
}

.keepit-settings {
  background: #fffbeb;
  margin: 0 1.5rem 1rem;
  padding: 1rem;
  border-radius: 6px;
  border: 1px solid #fcd34d;
}

.keepit-settings h4 {
  color: #92400e;
}

.decay-preview {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: white;
  border-radius: 4px;
  margin-top: 0.5rem;
}

.decay-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: #fcd34d;
  color: #92400e;
  border-radius: 50%;
  font-size: 0.7rem;
  font-weight: 600;
}

.decay-text {
  font-size: 0.8rem;
  color: #92400e;
}

.compression-preview {
  margin: 0 1.5rem 1rem;
  padding: 0.75rem;
  background: #dcfce7;
  border: 1px solid #86efac;
  border-radius: 6px;
}

.preview-row {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
}

.preview-label {
  font-size: 0.85rem;
  color: #166534;
}

.preview-value {
  font-size: 0.9rem;
  font-weight: 600;
  color: #15803d;
}

.preview-value.highlight {
  color: #059669;
}

.error-message {
  margin: 0 1.5rem 1rem;
  padding: 0.75rem;
  background: #fee2e2;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  color: #991b1b;
  font-size: 0.85rem;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e0e0e0;
  background: #f9f9f9;
}

.btn-primary {
  padding: 0.5rem 1.25rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
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

.btn-secondary:hover:not(:disabled) {
  background: #f7fafc;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-cancel {
  padding: 0.5rem 1rem;
  background: #f0f0f0;
  color: #666;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.btn-cancel:hover {
  background: #e0e0e0;
}
</style>
