<template>
  <div class="sanitization-panel">
    <div class="panel-header">
      <h3>Sanitization Options</h3>
    </div>

    <div v-if="hasManualSelections" class="info-banner">
      <span class="info-icon">ℹ️</span>
      <div class="info-text">
        <strong>Manual Selection Active:</strong>
        {{ selectedMessageCount }} messages selected.
        <span v-if="criteria.messageTypes && criteria.messageTypes.length > 0">
          Selected message types will be removed <em>within this range only</em>. Percentage slider is ignored.
        </span>
        <span v-else>
          These messages will be deleted directly. Use message type filters to remove specific types within this range instead.
        </span>
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
            <span v-if="criteria.percentageRange === 0 || criteria.percentageRange === 100" class="full-range-label">
              Full Range set — all messages will be filtered
            </span>
            <span v-else>
              Apply criteria to first {{ criteria.percentageRange }}% of messages
            </span>
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

    <!-- Sanitization Summary & Actions -->
    <div class="sanitization-actions-section">
      <div class="summary-inline">
        <span class="summary-stat">
          <strong>{{ selectedMessageCount }}</strong> messages
        </span>
        <span class="summary-stat">
          <strong>{{ selectedFileCount }}</strong> files
        </span>
        <span class="summary-stat">
          <strong>{{ appliedCriteria }}</strong> criteria
        </span>
      </div>
      <div v-if="showPreview && previewData" class="preview-inline">
        <span class="preview-stat">
          {{ previewData.original.messages }} → <strong class="success">{{ previewData.sanitized.messages }}</strong> messages
        </span>
        <span v-if="previewData.freed.messages > 0" class="preview-reduction">
          (-{{ previewData.freed.messages }} messages, {{ previewData.freed.percentage.toFixed(0) }}%)
        </span>
      </div>
      <div class="sanitization-buttons">
        <button @click="calculatePreview" class="btn-secondary-sm">
          {{ showPreview ? 'Refresh' : 'Preview' }}
        </button>
        <button @click="applySanitization" class="btn-danger-sm" :disabled="!canApply">
          Apply Sanitization
        </button>
      </div>
    </div>

    <!-- Duplicates Section -->
    <div class="duplicates-section">
      <h4>Duplicate Detection</h4>
      <div class="duplicates-content">
        <div class="duplicates-info">
          <span v-if="duplicatesData">
            Found <strong>{{ duplicatesData.totalDuplicates }}</strong> block duplicates
            <span v-if="duplicatesData.isolatedDuplicates > 0" class="isolated-info">
              ({{ duplicatesData.isolatedDuplicates }} isolated skipped)
            </span>
          </span>
          <span v-else class="text-muted">
            Click "Find Duplicates" to scan for duplicate messages
          </span>
        </div>
        <div class="duplicates-actions">
          <button @click="scanForDuplicates" class="btn-secondary" :disabled="loadingDuplicates">
            {{ loadingDuplicates ? 'Scanning...' : 'Find Duplicates' }}
          </button>
          <button
            @click="applyDeduplicate"
            class="btn-warning"
            :disabled="!duplicatesData || duplicatesData.totalDuplicates === 0 || loadingDuplicates"
          >
            Remove Duplicates
          </button>
        </div>
      </div>
      <div v-if="duplicatesData && duplicatesData.totalDuplicates > 0" class="duplicates-details">
        <details>
          <summary>View duplicate groups ({{ duplicatesData.duplicateGroups?.length || 0 }})</summary>
          <div class="duplicate-groups">
            <div v-for="(group, idx) in duplicatesData.duplicateGroups" :key="idx" class="duplicate-group">
              <span class="group-type">{{ group.messageType }}</span>
              <span class="group-count">{{ group.count }} copies</span>
              <span class="group-original">Original: {{ new Date(group.originalTimestamp).toLocaleString() }}</span>
            </div>
          </div>
        </details>
      </div>
    </div>

    <!-- AI Summarization Section -->
    <div class="summarization-section">
      <h4>AI Summarization</h4>

      <div v-if="!summarizationAvailable" class="summarization-unavailable">
        <span class="warning-icon">!</span>
        <div class="warning-text">
          <strong>Claude CLI not available</strong>
          <span>Install and authenticate Claude CLI to enable AI summarization.</span>
          <code>npm install -g @anthropic-ai/claude-code</code>
        </div>
      </div>

      <div v-else class="summarization-content">
        <div class="summarization-status">
          <span class="status-available">Claude CLI ready</span>
          <span class="status-version">{{ summarizationVersion }}</span>
        </div>

        <!-- Compaction Mode Toggle -->
        <div class="compaction-mode-toggle">
          <label class="toggle-option" :class="{ active: !summarizationOptions.useTiers }">
            <input type="radio" :value="false" v-model="summarizationOptions.useTiers" />
            <span>Uniform</span>
          </label>
          <label class="toggle-option" :class="{ active: summarizationOptions.useTiers }">
            <input type="radio" :value="true" v-model="summarizationOptions.useTiers" />
            <span>Variable (Tiered)</span>
          </label>
        </div>

        <!-- Uniform Compaction Options -->
        <div v-if="!summarizationOptions.useTiers" class="summarization-options">
          <div class="option-row">
            <label class="option-label">
              <span class="option-name">Compaction Ratio</span>
              <select v-model.number="summarizationOptions.compactionRatio" class="option-select">
                <option v-for="ratio in compactionRatios" :key="ratio" :value="ratio">
                  {{ ratio }}:1{{ ratio <= 5 ? ' (Light)' : ratio <= 15 ? ' (Moderate)' : ratio <= 25 ? ' (Strong)' : ' (Aggressive)' }}
                </option>
              </select>
              <span class="option-desc">Messages compressed per output</span>
            </label>
          </div>

          <div class="option-row">
            <label class="option-label">
              <span class="option-name">Aggressiveness</span>
              <select v-model="summarizationOptions.aggressiveness" class="option-select">
                <option value="minimal">Minimal - Preserve detail</option>
                <option value="moderate">Moderate - Balanced</option>
                <option value="aggressive">Aggressive - Max compression</option>
              </select>
              <span class="option-desc">How much detail to preserve</span>
            </label>
          </div>
        </div>

        <!-- Tiered Compaction Options -->
        <div v-else class="tiered-options">
          <div class="tier-preset-row">
            <label class="option-label">
              <span class="option-name">Preset</span>
              <select v-model="summarizationOptions.tierPreset" class="option-select">
                <option value="gentle">Gentle - Light compression</option>
                <option value="standard">Standard - Balanced</option>
                <option value="aggressive">Aggressive - Max compression</option>
                <option value="custom">Custom tiers</option>
              </select>
            </label>
          </div>

          <!-- Preset Description -->
          <div v-if="summarizationOptions.tierPreset !== 'custom' && summarizationPresets" class="preset-description">
            <span v-if="summarizationPresets[summarizationOptions.tierPreset]">
              {{ summarizationPresets[summarizationOptions.tierPreset].description }}
            </span>
          </div>

          <!-- Tier Visualization -->
          <div class="tier-visualization">
            <div
              v-for="(tier, idx) in (summarizationOptions.tierPreset === 'custom'
                ? summarizationOptions.customTiers
                : (summarizationPresets && summarizationPresets[summarizationOptions.tierPreset]?.tiers) || [])"
              :key="idx"
              class="tier-bar"
              :style="{ width: (tier.endPercent - (idx > 0 ? (summarizationOptions.tierPreset === 'custom' ? summarizationOptions.customTiers : summarizationPresets[summarizationOptions.tierPreset].tiers)[idx-1].endPercent : 0)) + '%' }"
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
          <div v-if="summarizationOptions.tierPreset === 'custom'" class="custom-tiers">
            <div class="custom-tiers-header">
              <span class="header-range">Range</span>
              <span class="header-ratio">Ratio</span>
              <span class="header-level">Level</span>
            </div>
            <div v-for="(tier, idx) in summarizationOptions.customTiers" :key="idx" class="custom-tier-row">
              <span class="tier-range">
                {{ idx === 0 ? '0' : summarizationOptions.customTiers[idx-1].endPercent }}-{{ tier.endPercent }}%
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

        <!-- Model Selection (common to both modes) -->
        <div class="summarization-options">
          <div class="option-row">
            <label class="option-label">
              <span class="option-name">Model</span>
              <select v-model="summarizationOptions.model" class="option-select">
                <option value="opus">Opus (Best quality)</option>
                <option value="sonnet">Sonnet (Faster)</option>
                <option value="haiku">Haiku (Fastest)</option>
              </select>
              <span class="option-desc">Claude model to use</span>
            </label>
          </div>
        </div>

        <!-- Output Mode Selection -->
        <div class="output-mode-section">
          <span class="output-mode-label">Output:</span>
          <div class="output-mode-options">
            <label class="output-option" :class="{ active: summarizationOptions.outputMode === 'modify' }">
              <input type="radio" value="modify" v-model="summarizationOptions.outputMode" />
              <span class="output-option-icon">✏️</span>
              <span class="output-option-text">Modify current</span>
            </label>
            <label class="output-option" :class="{ active: summarizationOptions.outputMode === 'export-jsonl' }">
              <input type="radio" value="export-jsonl" v-model="summarizationOptions.outputMode" />
              <span class="output-option-icon">📄</span>
              <span class="output-option-text">Export JSONL</span>
            </label>
            <label class="output-option" :class="{ active: summarizationOptions.outputMode === 'export-markdown' }">
              <input type="radio" value="export-markdown" v-model="summarizationOptions.outputMode" />
              <span class="output-option-icon">📝</span>
              <span class="output-option-text">Export Markdown</span>
            </label>
          </div>
        </div>

        <div class="summarization-hint">
          <span v-if="selectedMessageCount > 0">
            Will summarize <strong>{{ selectedMessageCount }}</strong> selected messages
          </span>
          <span v-else-if="criteria.percentageRange === 0 || criteria.percentageRange === 100">
            Will summarize <strong>all messages</strong> (full range)
          </span>
          <span v-else>
            Will summarize first <strong>{{ criteria.percentageRange }}%</strong> of messages
          </span>
        </div>

        <!-- Preview Results -->
        <div v-if="summarizationPreview" class="summarization-preview">
          <div class="preview-grid">
            <div class="preview-stat">
              <span class="stat-label">User/Assistant</span>
              <span class="stat-value">{{ summarizationPreview.inputMessages }}</span>
            </div>
            <div class="preview-stat">
              <span class="stat-label">Output Messages</span>
              <span class="stat-value highlight">{{ summarizationPreview.estimatedOutputMessages }}</span>
            </div>
            <div class="preview-stat">
              <span class="stat-label">Est. Token Savings</span>
              <span class="stat-value highlight">~{{ summarizationPreview.estimatedTokenReduction?.toLocaleString() }}</span>
            </div>
          </div>

          <!-- Non-conversation messages info -->
          <div v-if="summarizationPreview.nonConversationMessages > 0" class="non-conversation-info">
            <span class="cleanup-badge">Auto-cleanup</span>
            <span>{{ summarizationPreview.nonConversationMessages }} tool calls/results/thinking blocks will also be removed</span>
          </div>

          <!-- Tiered Preview Details -->
          <div v-if="summarizationPreview.tiered && summarizationPreview.tiers" class="tiered-preview-details">
            <div class="tier-preview-header">Compression by tier:</div>
            <div v-for="(tier, idx) in summarizationPreview.tiers" :key="idx" class="tier-preview-row">
              <span class="tier-preview-range">{{ tier.range }}</span>
              <span class="tier-preview-ratio">{{ tier.compactionRatio }}:1</span>
              <span class="tier-preview-count">{{ tier.inputMessages }} → {{ tier.estimatedOutputMessages }}</span>
            </div>
          </div>
        </div>

        <div v-if="summarizationError" class="summarization-error">
          <div class="error-title">{{ summarizationError.error || summarizationError }}</div>
          <div v-if="summarizationError.details" class="error-details">{{ summarizationError.details }}</div>
          <div v-if="summarizationError.hint" class="error-hint">{{ summarizationError.hint }}</div>
        </div>

        <div class="summarization-actions">
          <button
            @click="previewSummarizationAction"
            class="btn-secondary"
            :disabled="loadingSummarization"
          >
            {{ loadingSummarization ? 'Loading...' : 'Preview' }}
          </button>
          <button
            @click="applySummarizationAction"
            class="btn-ai"
            :disabled="loadingSummarization"
          >
            {{ loadingSummarization ? 'Summarizing...' : 'Apply AI Summarization' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading">Calculating...</div>
    <div v-if="error" class="error">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useSelectionStore } from '../stores/selection.js';
import { findDuplicates, removeDuplicates, checkSummarizationStatus, getSummarizationPresets, previewSummarization, applySummarization } from '../utils/api.js';

const props = defineProps({
  sessionId: String,
  projectId: String,
  sessionData: Object
});

const emit = defineEmits(['sanitized', 'duplicatesFound']);

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

// Duplicates state
const duplicatesData = ref(null);
const loadingDuplicates = ref(false);

// Summarization state
const summarizationAvailable = ref(false);
const summarizationVersion = ref('');
const summarizationPresets = ref(null);
const compactionRatios = ref([2, 3, 4, 5, 10, 15, 20, 25, 35, 50]);
const summarizationOptions = ref({
  compactionRatio: 10,
  aggressiveness: 'moderate',
  model: 'opus',
  // Tiered compaction options
  useTiers: false,
  tierPreset: 'standard',
  customTiers: [
    { endPercent: 25, compactionRatio: 35, aggressiveness: 'aggressive' },
    { endPercent: 50, compactionRatio: 20, aggressiveness: 'aggressive' },
    { endPercent: 75, compactionRatio: 10, aggressiveness: 'moderate' },
    { endPercent: 90, compactionRatio: 5, aggressiveness: 'moderate' },
    { endPercent: 100, compactionRatio: 3, aggressiveness: 'minimal' }
  ],
  // Output options
  outputMode: 'modify'  // 'modify' | 'export-jsonl' | 'export-markdown'
});
const summarizationPreview = ref(null);
const loadingSummarization = ref(false);
const summarizationError = ref(null);

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
    // Same logic as applySanitization - determine if selection is range or deletion
    const hasMessageTypeCriteria = criteria.value.messageTypes && criteria.value.messageTypes.length > 0;
    const hasSelection = selectionStore.selectedMessageCount > 0;

    const requestBody = {
      removeMessages: (hasSelection && !hasMessageTypeCriteria)
        ? Array.from(selectionStore.selectedMessages)
        : [],
      removeFiles: Array.from(selectionStore.selectedFiles),
      criteria: {
        ...criteria.value,
        manuallySelected: (hasSelection && hasMessageTypeCriteria)
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
    // Determine if we're using selection as a range filter (with message type criteria)
    // or as direct deletion (no message type criteria)
    const hasMessageTypeCriteria = criteria.value.messageTypes && criteria.value.messageTypes.length > 0;
    const hasSelection = selectionStore.selectedMessageCount > 0;

    const requestBody = {
      // Only send removeMessages for direct deletion (no message type filter)
      // When using message type filter with selection, the selection is the RANGE, not deletion targets
      removeMessages: (hasSelection && !hasMessageTypeCriteria)
        ? Array.from(selectionStore.selectedMessages)
        : [],
      removeFiles: Array.from(selectionStore.selectedFiles),
      criteria: {
        ...criteria.value,
        // Add manual selection as range filter when using message type criteria
        manuallySelected: (hasSelection && hasMessageTypeCriteria)
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

// Duplicate detection functions
async function scanForDuplicates() {
  loadingDuplicates.value = true;
  error.value = null;

  try {
    const result = await findDuplicates(props.sessionId, props.projectId);
    duplicatesData.value = result;

    // Emit the duplicate UUIDs for highlighting in the message list
    if (result.duplicateUuids && result.duplicateUuids.length > 0) {
      emit('duplicatesFound', result.duplicateUuids);
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    loadingDuplicates.value = false;
  }
}

async function applyDeduplicate() {
  if (!duplicatesData.value || duplicatesData.value.totalDuplicates === 0) return;

  loadingDuplicates.value = true;
  error.value = null;

  try {
    const result = await removeDuplicates(props.sessionId, props.projectId);
    console.log('Deduplication result:', result);

    // Clear duplicates data and emit sanitized event to reload
    duplicatesData.value = null;
    emit('sanitized', result);
  } catch (err) {
    error.value = err.message;
  } finally {
    loadingDuplicates.value = false;
  }
}

// Summarization functions
async function checkClaudeAvailability() {
  try {
    const status = await checkSummarizationStatus();
    summarizationAvailable.value = status.available;
    summarizationVersion.value = status.version || '';

    // Also fetch presets and ratios
    if (status.available) {
      const presetsData = await getSummarizationPresets();
      summarizationPresets.value = presetsData.presets;
      if (presetsData.compactionRatios) {
        compactionRatios.value = presetsData.compactionRatios;
      }
    }
  } catch (err) {
    summarizationAvailable.value = false;
    console.warn('Could not check Claude CLI status:', err);
  }
}

async function previewSummarizationAction() {
  loadingSummarization.value = true;
  summarizationError.value = null;
  summarizationPreview.value = null;

  try {
    const hasSelection = selectionStore.selectedMessageCount > 0;
    const opts = summarizationOptions.value;

    const options = {
      model: opts.model
    };

    // Add tiered or uniform options
    if (opts.useTiers) {
      options.useTiers = true;
      if (opts.tierPreset !== 'custom') {
        options.tierPreset = opts.tierPreset;
      } else {
        options.tiers = opts.customTiers;
      }
    } else {
      options.compactionRatio = opts.compactionRatio;
      options.aggressiveness = opts.aggressiveness;
    }

    if (hasSelection) {
      options.messageUuids = Array.from(selectionStore.selectedMessages);
    } else {
      // percentageRange: 0 means "full range" (100%), use it directly or default to 100
      options.percentageRange = criteria.value.percentageRange || 100;
    }

    const result = await previewSummarization(props.sessionId, props.projectId, options);
    summarizationPreview.value = result;
  } catch (err) {
    summarizationError.value = err.message;
  } finally {
    loadingSummarization.value = false;
  }
}

async function applySummarizationAction() {
  loadingSummarization.value = true;
  summarizationError.value = null;

  try {
    const hasSelection = selectionStore.selectedMessageCount > 0;
    const opts = summarizationOptions.value;

    const options = {
      model: opts.model,
      outputMode: opts.outputMode
    };

    // Add tiered or uniform options
    if (opts.useTiers) {
      options.useTiers = true;
      if (opts.tierPreset !== 'custom') {
        options.tierPreset = opts.tierPreset;
      } else {
        options.tiers = opts.customTiers;
      }
    } else {
      options.compactionRatio = opts.compactionRatio;
      options.aggressiveness = opts.aggressiveness;
    }

    if (hasSelection) {
      options.messageUuids = Array.from(selectionStore.selectedMessages);
    } else {
      // percentageRange: 0 means "full range" (100%), use it directly or default to 100
      options.percentageRange = criteria.value.percentageRange || 100;
    }

    const result = await applySummarization(props.sessionId, props.projectId, options);

    // Check for error in response
    if (result.error) {
      summarizationError.value = result;
      return;
    }

    // Handle export modes - trigger file download
    if (result.export) {
      downloadFile(result.export.content, result.export.filename, result.export.contentType);
    }

    // Clear state and emit (only reload if modifying original)
    summarizationPreview.value = null;
    selectionStore.clearAll();

    if (opts.outputMode === 'modify') {
      emit('sanitized', result);
    }
  } catch (err) {
    // Try to extract detailed error from response
    if (err.response) {
      summarizationError.value = err.response;
    } else {
      summarizationError.value = { error: 'Request failed', details: err.message };
    }
  } finally {
    loadingSummarization.value = false;
  }
}

// Helper to download file
function downloadFile(content, filename, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Update a custom tier
function updateCustomTier(index, field, value) {
  summarizationOptions.value.customTiers[index][field] = value;
}

// Check Claude availability on mount
onMounted(() => {
  checkClaudeAvailability();
});
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

.criteria-section {
  margin-bottom: 1.5rem;
}

.criteria-section h4 {
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

.full-range-label {
  font-weight: 600;
  color: #667eea;
}

/* Sanitization Actions Section */
.sanitization-actions-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: #f0f4ff;
  border: 1px solid #667eea;
  border-radius: 4px;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.summary-inline {
  display: flex;
  gap: 1rem;
  font-size: 0.85rem;
  color: #4a5568;
}

.summary-stat strong {
  color: #667eea;
}

.preview-inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #4a5568;
}

.preview-stat .success {
  color: #38a169;
}

.preview-reduction {
  color: #38a169;
  font-weight: 500;
}

.sanitization-buttons {
  display: flex;
  gap: 0.5rem;
}

.btn-secondary-sm {
  padding: 0.4rem 0.75rem;
  background: #e2e8f0;
  color: #4a5568;
  border: 1px solid #cbd5e0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-secondary-sm:hover {
  background: #cbd5e0;
}

.btn-danger-sm {
  padding: 0.4rem 0.75rem;
  background: #d32f2f;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-danger-sm:hover:not(:disabled) {
  background: #b71c1c;
}

.btn-danger-sm:disabled {
  background: #ccc;
  cursor: not-allowed;
  opacity: 0.6;
}

/* Duplicates Section */
.duplicates-section {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background-color: #fff8e6;
  border: 1px solid #f5c542;
  border-radius: 4px;
}

.duplicates-section h4 {
  margin: 0 0 0.75rem 0;
  color: #b7791f;
  font-size: 0.95rem;
}

.duplicates-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.duplicates-info {
  font-size: 0.9rem;
  color: #744210;
}

.duplicates-info strong {
  color: #d69e2e;
}

.text-muted {
  color: #999;
}

.isolated-info {
  color: #718096;
  font-size: 0.85em;
  font-style: italic;
}

.duplicates-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: #e2e8f0;
  color: #4a5568;
  border: 1px solid #cbd5e0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-secondary:hover:not(:disabled) {
  background: #cbd5e0;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-warning {
  padding: 0.5rem 1rem;
  background: #ed8936;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-warning:hover:not(:disabled) {
  background: #dd6b20;
}

.btn-warning:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.duplicates-details {
  margin-top: 0.75rem;
}

.duplicates-details summary {
  cursor: pointer;
  font-size: 0.85rem;
  color: #744210;
  user-select: none;
}

.duplicates-details summary:hover {
  text-decoration: underline;
}

.duplicate-groups {
  margin-top: 0.5rem;
  max-height: 200px;
  overflow-y: auto;
}

.duplicate-group {
  display: flex;
  gap: 0.75rem;
  padding: 0.5rem;
  background: white;
  border-radius: 3px;
  margin-bottom: 0.25rem;
  font-size: 0.8rem;
}

.group-type {
  padding: 0.125rem 0.5rem;
  background: #667eea;
  color: white;
  border-radius: 3px;
  font-weight: 500;
}

.group-count {
  color: #d69e2e;
  font-weight: 600;
}

.group-original {
  color: #718096;
}

/* AI Summarization Section */
.summarization-section {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
  border: 1px solid #667eea;
  border-radius: 4px;
}

.summarization-section h4 {
  margin: 0 0 0.75rem 0;
  color: #667eea;
  font-size: 0.95rem;
}

.summarization-unavailable {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
  background: #fff5f5;
  border: 1px solid #feb2b2;
  border-radius: 4px;
}

.warning-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: #fc8181;
  color: white;
  border-radius: 50%;
  font-weight: bold;
  font-size: 0.9rem;
}

.warning-text {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.warning-text strong {
  color: #c53030;
}

.warning-text span {
  color: #718096;
}

.warning-text code {
  margin-top: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: #edf2f7;
  border-radius: 3px;
  font-size: 0.8rem;
  color: #4a5568;
}

.summarization-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.summarization-status {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.85rem;
}

.status-available {
  padding: 0.25rem 0.5rem;
  background: #c6f6d5;
  color: #276749;
  border-radius: 3px;
  font-weight: 500;
}

.status-version {
  color: #718096;
  font-family: monospace;
  font-size: 0.8rem;
}

.summarization-options {
  display: grid;
  gap: 0.5rem;
}

.option-row {
  display: flex;
}

.option-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  padding: 0.5rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
}

.option-label:hover {
  border-color: #667eea;
}

.option-name {
  font-weight: 500;
  color: #4a5568;
  min-width: 120px;
  font-size: 0.85rem;
}

.option-select {
  padding: 0.25rem 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  font-size: 0.85rem;
  background: white;
  cursor: pointer;
}

.option-select:focus {
  outline: none;
  border-color: #667eea;
}

.option-desc {
  font-size: 0.75rem;
  color: #a0aec0;
  margin-left: auto;
}

.summarization-hint {
  padding: 0.5rem;
  background: white;
  border-radius: 4px;
  font-size: 0.85rem;
  color: #4a5568;
}

.summarization-hint strong {
  color: #667eea;
}

.summarization-preview {
  padding: 0.75rem;
  background: white;
  border: 1px solid #c6f6d5;
  border-radius: 4px;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.preview-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.5rem;
  background: #f7fafc;
  border-radius: 4px;
}

.stat-label {
  font-size: 0.75rem;
  color: #718096;
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 600;
  color: #4a5568;
}

.stat-value.highlight {
  color: #38a169;
}

.summarization-error {
  padding: 0.75rem;
  background: #fff5f5;
  border: 1px solid #feb2b2;
  border-radius: 4px;
  font-size: 0.85rem;
}

.summarization-error .error-title {
  color: #c53030;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.summarization-error .error-details {
  color: #742a2a;
  font-family: monospace;
  font-size: 0.8rem;
  padding: 0.5rem;
  background: #fed7d7;
  border-radius: 3px;
  margin-top: 0.5rem;
  word-break: break-word;
  white-space: pre-wrap;
}

.summarization-error .error-hint {
  color: #744210;
  font-size: 0.8rem;
  margin-top: 0.5rem;
  padding: 0.375rem 0.5rem;
  background: #fefcbf;
  border-radius: 3px;
  border-left: 3px solid #ecc94b;
}

.summarization-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-ai {
  flex: 1;
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-ai:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-ai:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* Compaction Mode Toggle */
.compaction-mode-toggle {
  display: flex;
  gap: 0;
  margin-bottom: 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
}

.toggle-option {
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

.toggle-option input {
  display: none;
}

.toggle-option:hover {
  background: #f7fafc;
}

.toggle-option.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

/* Tiered Options */
.tiered-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.tier-preset-row {
  display: flex;
}

.preset-description {
  padding: 0.5rem;
  background: #f7fafc;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #718096;
  font-style: italic;
}

/* Tier Visualization */
.tier-visualization {
  display: flex;
  height: 32px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}

.tier-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 60px;
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
  font-size: 0.75rem;
  font-weight: 600;
}

.tier-legend {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: #a0aec0;
  padding: 0.25rem 0;
}

/* Custom Tiers Editor */
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
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 0.375rem;
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.7rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
}

.header-range {
  min-width: 70px;
}

.header-ratio {
  min-width: 70px;
}

.header-level {
  flex: 1;
}

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
  cursor: pointer;
}

.tier-select:focus {
  outline: none;
  border-color: #667eea;
}

/* Tiered Preview Details */
.tiered-preview-details {
  margin-top: 0.75rem;
  padding: 0.5rem;
  background: #f7fafc;
  border-radius: 4px;
}

.tier-preview-header {
  font-size: 0.75rem;
  font-weight: 600;
  color: #4a5568;
  margin-bottom: 0.5rem;
}

.tier-preview-row {
  display: flex;
  gap: 1rem;
  padding: 0.25rem 0;
  font-size: 0.8rem;
  border-bottom: 1px solid #e2e8f0;
}

.tier-preview-row:last-child {
  border-bottom: none;
}

.tier-preview-range {
  min-width: 60px;
  color: #718096;
}

.tier-preview-ratio {
  min-width: 40px;
  font-weight: 500;
  color: #667eea;
}

.tier-preview-count {
  color: #38a169;
}

/* Non-conversation cleanup info */
.non-conversation-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #92400e;
}

.cleanup-badge {
  padding: 0.125rem 0.375rem;
  background: #f59e0b;
  color: white;
  border-radius: 3px;
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
}

/* Output Mode Selection */
.output-mode-section {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  background: #f7fafc;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.output-mode-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: #4a5568;
}

.output-mode-options {
  display: flex;
  gap: 0.5rem;
  flex: 1;
}

.output-option {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 0.2s ease;
}

.output-option input {
  display: none;
}

.output-option:hover {
  border-color: #667eea;
}

.output-option.active {
  background: #667eea;
  border-color: #667eea;
  color: white;
}

.output-option-icon {
  font-size: 0.9rem;
}

.output-option-text {
  font-weight: 500;
}
</style>
