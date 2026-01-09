<template>
  <div class="token-calculator">
    <div class="calc-header">
      <h3>Token Analysis</h3>
      <button @click="exportReport" class="btn-export">Export Report</button>
    </div>

    <div v-if="!tokens" class="loading">Loading token data...</div>

    <div v-else class="token-content">
      <!-- Main Breakdown -->
      <div class="breakdown-card">
        <h4>Session Token Breakdown</h4>
        <div class="breakdown-grid">
          <div class="metric">
            <span class="metric-label">Input Tokens</span>
            <span class="metric-value">{{ tokens.breakdown.main.breakdown.input }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Output Tokens</span>
            <span class="metric-value">{{ tokens.breakdown.main.breakdown.output }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Cache Read</span>
            <span class="metric-value">{{ tokens.breakdown.main.breakdown.cacheRead }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Cache Creation</span>
            <span class="metric-value">{{ tokens.breakdown.main.breakdown.cacheCreation }}</span>
          </div>
        </div>

        <div class="total-row">
          <span class="label">Total Tokens (Main Agent):</span>
          <span class="value">{{ tokens.breakdown.main.breakdown.total }}</span>
        </div>
      </div>

      <!-- Subagent Breakdown -->
      <div v-if="subagents.length > 0" class="subagent-card">
        <h4>Subagent Token Usage</h4>
        <div class="subagent-list">
          <div
            v-for="subagent in subagents"
            :key="subagent.agentId"
            class="subagent-item"
          >
            <div class="subagent-name">{{ subagent.agentId }}</div>
            <div class="subagent-metrics">
              <span class="metric">{{ subagent.tokens.total }} tokens</span>
              <span class="metric">{{ subagent.messageCount }} messages</span>
            </div>
          </div>
        </div>

        <div class="combined-totals">
          <div class="total-row">
            <span class="label">Main Agent:</span>
            <span class="value">{{ tokens.breakdown.main.breakdown.total }}</span>
          </div>
          <div class="total-row">
            <span class="label">All Subagents:</span>
            <span class="value">{{ tokens.breakdown.combined.subagents }}</span>
          </div>
          <div class="total-row combined">
            <span class="label">Combined Total:</span>
            <span class="value">{{ tokens.breakdown.combined.total }}</span>
          </div>
        </div>
      </div>

      <!-- Selection Stats -->
      <div class="selection-card">
        <h4>Selection Impact</h4>
        <div class="selection-stats">
          <div class="stat">
            <span class="label">Selected Messages:</span>
            <span class="value">{{ selectedCount }}</span>
          </div>
          <div class="stat">
            <span class="label">Tokens in Selection:</span>
            <span class="value">{{ selectionTokens }}</span>
          </div>
          <div class="stat">
            <span class="label">Tokens Freed (%):</span>
            <span class="value">{{ freedTokensPercent }}</span>
          </div>
        </div>
      </div>

      <!-- Context Usage -->
      <div class="context-card">
        <h4>Context Window Usage</h4>
        <div class="context-bar">
          <div class="usage-fill" :style="{ width: usagePercent + '%' }">
            {{ usagePercent.toFixed(1) }}%
          </div>
        </div>
        <div class="context-stats">
          <div class="stat">
            <span class="label">Used:</span>
            <span class="value">{{ tokens.breakdown.combined.total }} / 200,000</span>
          </div>
          <div class="stat">
            <span class="label">Available:</span>
            <span class="value available">{{ availableTokens }}</span>
          </div>
        </div>
      </div>

      <!-- Message Cost -->
      <div class="cost-card">
        <h4>Message Metrics</h4>
        <div class="metrics-grid">
          <div class="metric-box">
            <span class="label">Total Messages:</span>
            <span class="value">{{ messageCount }}</span>
          </div>
          <div class="metric-box">
            <span class="label">Avg. Tokens/Message:</span>
            <span class="value">{{ avgTokensPerMessage }}</span>
          </div>
          <div class="metric-box">
            <span class="label">Messages/1K Tokens:</span>
            <span class="value">{{ messagesPerK }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useSelectionStore } from '../stores/selection.js';

const props = defineProps({
  tokens: Object,
  subagents: {
    type: Array,
    default: () => []
  },
  sessionData: Object
});

const selectionStore = useSelectionStore();

const tokens = ref(props.tokens);
const messageCount = computed(() => props.sessionData?.totalMessages || 0);

const usagePercent = computed(() => {
  if (!tokens.value) return 0;
  return (tokens.value.breakdown.combined.total / 200000) * 100;
});

const availableTokens = computed(() => {
  if (!tokens.value) return 200000;
  return 200000 - tokens.value.breakdown.combined.total;
});

const selectedCount = computed(() => selectionStore.selectedMessageCount);

const selectionTokens = computed(() => {
  if (!props.sessionData || selectedCount.value === 0) return 0;

  let total = 0;
  for (const uuid of selectionStore.selectedMessages) {
    const msg = props.sessionData.messages.find(m => m.uuid === uuid);
    if (msg) {
      total += msg.tokens.total;
    }
  }
  return total;
});

const freedTokensPercent = computed(() => {
  if (!tokens.value || selectedCount.value === 0) return '0.0%';
  const percent = (selectionTokens.value / tokens.value.breakdown.combined.total) * 100;
  return percent.toFixed(1) + '%';
});

const avgTokensPerMessage = computed(() => {
  if (!tokens.value || messageCount.value === 0) return 0;
  return Math.round(tokens.value.breakdown.combined.total / messageCount.value);
});

const messagesPerK = computed(() => {
  if (!tokens.value || tokens.value.breakdown.combined.total === 0) return 0;
  return Math.round((messageCount.value / tokens.value.breakdown.combined.total) * 1000);
});

function exportReport() {
  const report = {
    timestamp: new Date().toISOString(),
    tokenBreakdown: tokens.value,
    subagents: props.subagents,
    metrics: {
      messageCount: messageCount.value,
      avgTokensPerMessage: avgTokensPerMessage.value,
      messagesPerKTokens: messagesPerK.value,
      contextUsagePercent: usagePercent.value
    }
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json'
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `token-report-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.token-calculator {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.calc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e0e0e0;
}

.calc-header h3 {
  margin: 0;
  color: #333;
}

.btn-export {
  padding: 0.5rem 1rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-export:hover {
  background: #388e3c;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: #999;
}

.token-content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 1.5rem;
}

.breakdown-card,
.subagent-card,
.selection-card,
.context-card,
.cost-card {
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 1.25rem;
}

.breakdown-card h4,
.subagent-card h4,
.selection-card h4,
.context-card h4,
.cost-card h4 {
  margin: 0 0 1rem 0;
  color: #333;
  font-size: 0.95rem;
}

.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1rem;
}

.metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.75rem;
  background: white;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
}

.metric-label {
  font-size: 0.85rem;
  color: #999;
  margin-bottom: 0.5rem;
}

.metric-value {
  font-size: 1.5rem;
  font-weight: 600;
  color: #333;
}

.total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: white;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
  font-weight: 600;
}

.total-row .label {
  color: #666;
}

.total-row .value {
  color: #333;
  font-size: 1.2rem;
}

.total-row.combined {
  background-color: #e8f5e9;
  border-color: #4caf50;
}

.total-row.combined .value {
  color: #2e7d32;
}

.subagent-list {
  margin-bottom: 1rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
}

.subagent-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  border-bottom: 1px solid #e0e0e0;
  background: white;
}

.subagent-item:last-child {
  border-bottom: none;
}

.subagent-name {
  font-family: monospace;
  font-weight: 600;
  color: #333;
}

.subagent-metrics {
  display: flex;
  gap: 1.5rem;
  font-size: 0.9rem;
  color: #999;
}

.combined-totals {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.selection-stats,
.context-stats,
.metrics-grid {
  display: grid;
  gap: 0.75rem;
}

.stat,
.metric-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: white;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
}

.stat .label,
.metric-box .label {
  color: #666;
  font-size: 0.9rem;
}

.stat .value,
.metric-box .value {
  font-weight: 600;
  color: #333;
}

.stat .value.available {
  color: #4caf50;
}

.context-bar {
  position: relative;
  height: 40px;
  background-color: #f0f0f0;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 1rem;
  border: 1px solid #e0e0e0;
}

.usage-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  transition: width 0.3s ease;
}

.context-stats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
