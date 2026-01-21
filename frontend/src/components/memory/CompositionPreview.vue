<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="composition-preview">
      <div class="preview-header">
        <h3>Composition Preview</h3>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>

      <div class="preview-body">
        <div class="preview-summary">
          <div class="summary-row">
            <span class="label">Name:</span>
            <span class="value">{{ compositionName || 'Unnamed composition' }}</span>
          </div>
          <div class="summary-row">
            <span class="label">Components:</span>
            <span class="value">{{ components.length }} session{{ components.length !== 1 ? 's' : '' }}</span>
          </div>
          <div class="summary-row">
            <span class="label">Total Tokens:</span>
            <span class="value" :class="{ 'over-budget': isOverBudget }">
              {{ formatTokens(totalTokens) }} / {{ formatTokens(budget) }}
              <span v-if="isOverBudget" class="overflow-badge">
                +{{ formatTokens(totalTokens - budget) }} over
              </span>
            </span>
          </div>
          <div class="summary-row">
            <span class="label">Strategy:</span>
            <span class="value strategy-badge">{{ strategyLabel }}</span>
          </div>
        </div>

        <div v-if="warnings.length > 0" class="warnings-section">
          <h4>
            <span class="warning-icon">&#x26A0;</span>
            Warnings ({{ warnings.length }})
          </h4>
          <ul class="warnings-list">
            <li v-for="(warning, idx) in warnings" :key="idx" class="warning-item">
              <span class="warning-type" :class="warning.severity">{{ warning.severity }}</span>
              {{ warning.message }}
            </li>
          </ul>
        </div>

        <div v-if="errors.length > 0" class="errors-section">
          <h4>
            <span class="error-icon">&#x2717;</span>
            Errors ({{ errors.length }})
          </h4>
          <ul class="errors-list">
            <li v-for="(error, idx) in errors" :key="idx" class="error-item">
              {{ error }}
            </li>
          </ul>
        </div>

        <div class="component-breakdown">
          <h4>Component Breakdown</h4>
          <div class="breakdown-table-wrapper">
            <table class="breakdown-table">
              <thead>
                <tr>
                  <th class="col-order">#</th>
                  <th class="col-session">Session</th>
                  <th class="col-version">Version</th>
                  <th class="col-tokens">Tokens</th>
                  <th class="col-percent">%</th>
                  <th class="col-keepits">Keepits</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(comp, idx) in previewComponents"
                  :key="idx"
                  :class="{ 'over-allocation': comp.isOverAllocation }"
                >
                  <td class="col-order">{{ idx + 1 }}</td>
                  <td class="col-session">
                    <span class="session-id">{{ formatSessionId(comp.sessionId) }}</span>
                  </td>
                  <td class="col-version">
                    <span class="version-badge" :class="comp.versionType">
                      {{ comp.versionLabel }}
                    </span>
                  </td>
                  <td class="col-tokens">
                    {{ formatTokens(comp.tokenContribution) }}
                  </td>
                  <td class="col-percent">
                    {{ comp.percentOfBudget.toFixed(1) }}%
                  </td>
                  <td class="col-keepits">
                    <span v-if="comp.keepitStats">
                      {{ comp.keepitStats.preserved || 0 }} kept
                    </span>
                    <span v-else class="no-data">-</span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="totals-row">
                  <td colspan="3" class="totals-label">Total</td>
                  <td class="col-tokens">{{ formatTokens(totalTokens) }}</td>
                  <td class="col-percent">{{ totalPercentage.toFixed(1) }}%</td>
                  <td class="col-keepits">{{ totalKeepits }} kept</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="content-preview-section">
          <div class="content-preview-header">
            <label class="content-preview-toggle">
              <input type="checkbox" v-model="showContentPreview" />
              <span>Show content preview</span>
            </label>
            <select
              v-if="showContentPreview"
              v-model="previewFormat"
              class="format-select"
            >
              <option value="md">Markdown</option>
              <option value="jsonl">JSONL</option>
            </select>
          </div>

          <div v-if="showContentPreview && !loadingContent" class="content-preview-box">
            <div v-if="contentPreviewError" class="preview-error">
              {{ contentPreviewError }}
            </div>
            <pre v-else class="preview-content">{{ contentPreview || 'Loading preview...' }}</pre>
          </div>

          <div v-if="showContentPreview && loadingContent" class="loading-content">
            <span class="loading-spinner"></span>
            <span>Loading preview...</span>
          </div>
        </div>
      </div>

      <div class="preview-footer">
        <div class="output-format">
          <span class="format-label">Output formats:</span>
          <label class="format-option">
            <input type="checkbox" v-model="outputFormats.markdown" />
            <span>Markdown</span>
          </label>
          <label class="format-option">
            <input type="checkbox" v-model="outputFormats.jsonl" />
            <span>JSONL</span>
          </label>
        </div>

        <div class="dialog-actions">
          <button class="btn-cancel" @click="$emit('close')">
            Cancel
          </button>
          <button
            class="btn-create"
            @click="handleConfirm"
            :disabled="hasErrors || creating"
          >
            {{ creating ? 'Creating...' : 'Create Composition' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  compositionName: {
    type: String,
    default: ''
  },
  components: {
    type: Array,
    default: () => []
  },
  budget: {
    type: Number,
    default: 100000
  },
  allocationStrategy: {
    type: String,
    default: 'equal'
  },
  previewData: {
    type: Object,
    default: null
  },
  creating: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['close', 'confirm', 'load-preview']);

const showContentPreview = ref(false);
const previewFormat = ref('md');
const contentPreview = ref('');
const contentPreviewError = ref(null);
const loadingContent = ref(false);
const outputFormats = ref({
  markdown: true,
  jsonl: false
});

const STRATEGY_LABELS = {
  equal: 'Equal Distribution',
  proportional: 'Proportional',
  recency: 'Recency-Weighted',
  manual: 'Manual'
};

const totalTokens = computed(() => {
  return props.components.reduce((sum, c) => sum + (c.tokenAllocation || 0), 0);
});

const isOverBudget = computed(() => totalTokens.value > props.budget);

const totalPercentage = computed(() => {
  if (props.budget <= 0) return 0;
  return (totalTokens.value / props.budget) * 100;
});

const totalKeepits = computed(() => {
  return props.components.reduce((sum, c) => {
    return sum + (c.keepitStats?.preserved || 0);
  }, 0);
});

const strategyLabel = computed(() => {
  return STRATEGY_LABELS[props.allocationStrategy] || props.allocationStrategy;
});

const previewComponents = computed(() => {
  return props.components.map(comp => {
    const versionId = comp.versionId || 'original';
    let versionLabel = 'Original';
    let versionType = 'original';

    if (versionId === 'auto') {
      versionLabel = 'Auto';
      versionType = 'auto';
    } else if (versionId !== 'original') {
      versionLabel = versionId.substring(0, 8) + '...';
      versionType = 'compressed';
    }

    const tokenContribution = comp.tokenAllocation || 0;
    const percentOfBudget = props.budget > 0 ? (tokenContribution / props.budget) * 100 : 0;

    return {
      sessionId: comp.sessionId,
      versionId,
      versionLabel,
      versionType,
      tokenContribution,
      percentOfBudget,
      keepitStats: comp.keepitStats || null,
      isOverAllocation: tokenContribution > (comp.originalTokens || Infinity)
    };
  });
});

const warnings = computed(() => {
  const result = [];

  if (isOverBudget.value) {
    result.push({
      severity: 'warning',
      message: `Total allocation (${formatTokens(totalTokens.value)}) exceeds budget (${formatTokens(props.budget)})`
    });
  }

  props.components.forEach((comp, idx) => {
    if (!comp.versionId || comp.versionId === 'auto') {
      result.push({
        severity: 'info',
        message: `Component ${idx + 1} will use auto-selected version`
      });
    }

    if (comp.tokenAllocation > (comp.originalTokens || 0)) {
      result.push({
        severity: 'warning',
        message: `Component ${idx + 1} allocation exceeds original size`
      });
    }
  });

  return result;
});

const errors = computed(() => {
  const result = [];

  if (!props.compositionName?.trim()) {
    result.push('Composition name is required');
  }

  if (props.components.length === 0) {
    result.push('At least one component is required');
  }

  if (props.budget <= 0) {
    result.push('Token budget must be greater than 0');
  }

  return result;
});

const hasErrors = computed(() => errors.value.length > 0);

watch(showContentPreview, (show) => {
  if (show && !contentPreview.value) {
    loadContentPreview();
  }
});

watch(previewFormat, () => {
  if (showContentPreview.value) {
    loadContentPreview();
  }
});

function loadContentPreview() {
  loadingContent.value = true;
  contentPreviewError.value = null;
  emit('load-preview', {
    format: previewFormat.value,
    callback: (result) => {
      loadingContent.value = false;
      if (result.error) {
        contentPreviewError.value = result.error;
      } else {
        // Show first 2000 characters
        const content = result.content || '';
        contentPreview.value = content.length > 2000
          ? content.substring(0, 2000) + '\n\n... [truncated]'
          : content;
      }
    }
  });
}

function handleConfirm() {
  emit('confirm', {
    outputMarkdown: outputFormats.value.markdown,
    outputJsonl: outputFormats.value.jsonl
  });
}

function formatSessionId(id) {
  if (!id) return 'Unknown';
  if (id.length > 12) {
    return id.substring(0, 8) + '...';
  }
  return id;
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
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.composition-preview {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 700px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e2e8f0;
}

.preview-header h3 {
  margin: 0;
  font-size: 1.1rem;
  color: #1e293b;
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #f1f5f9;
  border-radius: 6px;
  font-size: 1.25rem;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: #e2e8f0;
  color: #475569;
}

.preview-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.preview-summary {
  padding: 1rem;
  background: #f8fafc;
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #e2e8f0;
}

.summary-row:last-child {
  border-bottom: none;
}

.summary-row .label {
  color: #64748b;
  font-weight: 500;
}

.summary-row .value {
  color: #334155;
  font-weight: 600;
}

.summary-row .value.over-budget {
  color: #dc2626;
}

.overflow-badge {
  margin-left: 0.5rem;
  padding: 0.125rem 0.375rem;
  background: #fee2e2;
  color: #dc2626;
  border-radius: 4px;
  font-size: 0.75rem;
}

.strategy-badge {
  padding: 0.25rem 0.5rem;
  background: #dbeafe;
  color: #2563eb;
  border-radius: 4px;
  font-size: 0.85rem;
}

.warnings-section,
.errors-section {
  margin-bottom: 1.5rem;
  padding: 1rem;
  border-radius: 8px;
}

.warnings-section {
  background: #fffbeb;
  border: 1px solid #fcd34d;
}

.errors-section {
  background: #fef2f2;
  border: 1px solid #fca5a5;
}

.warnings-section h4,
.errors-section h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.warning-icon {
  color: #d97706;
}

.error-icon {
  color: #dc2626;
}

.warnings-list,
.errors-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.warning-item,
.error-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0;
  font-size: 0.85rem;
  color: #475569;
}

.warning-type {
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
}

.warning-type.warning {
  background: #fcd34d;
  color: #92400e;
}

.warning-type.info {
  background: #dbeafe;
  color: #1e40af;
}

.component-breakdown {
  margin-bottom: 1.5rem;
}

.component-breakdown h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.95rem;
  color: #334155;
}

.breakdown-table-wrapper {
  overflow-x: auto;
}

.breakdown-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.breakdown-table th {
  text-align: left;
  padding: 0.75rem 0.5rem;
  background: #f1f5f9;
  color: #475569;
  font-weight: 600;
  border-bottom: 2px solid #e2e8f0;
}

.breakdown-table td {
  padding: 0.625rem 0.5rem;
  border-bottom: 1px solid #e2e8f0;
  color: #334155;
}

.breakdown-table tr.over-allocation td {
  background: #fef2f2;
}

.col-order {
  width: 40px;
  text-align: center;
}

.col-session {
  min-width: 120px;
}

.col-version {
  min-width: 100px;
}

.col-tokens,
.col-percent {
  text-align: right;
  width: 80px;
}

.col-keepits {
  text-align: center;
  width: 80px;
}

.session-id {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.8rem;
}

.version-badge {
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.version-badge.original {
  background: #f1f5f9;
  color: #475569;
}

.version-badge.auto {
  background: #dbeafe;
  color: #2563eb;
}

.version-badge.compressed {
  background: #dcfce7;
  color: #166534;
}

.no-data {
  color: #94a3b8;
}

.totals-row {
  background: #f8fafc;
  font-weight: 600;
}

.totals-label {
  text-align: right;
  color: #475569;
}

.content-preview-section {
  margin-bottom: 1rem;
}

.content-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.content-preview-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  color: #475569;
}

.format-select {
  padding: 0.375rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  font-size: 0.85rem;
  background: white;
}

.content-preview-box {
  max-height: 200px;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.preview-content {
  margin: 0;
  padding: 1rem;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: #334155;
}

.preview-error {
  padding: 1rem;
  color: #dc2626;
}

.loading-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem;
  color: #64748b;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #e2e8f0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.preview-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  border-radius: 0 0 12px 12px;
}

.output-format {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.format-label {
  font-size: 0.85rem;
  color: #64748b;
}

.format-option {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.85rem;
  color: #475569;
  cursor: pointer;
}

.dialog-actions {
  display: flex;
  gap: 0.75rem;
}

.btn-cancel {
  padding: 0.625rem 1.25rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.btn-create {
  padding: 0.625rem 1.25rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-create:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-create:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
</style>
