<template>
  <div class="allocation-strategy">
    <div class="strategy-header">
      <label class="strategy-label">Token Allocation Strategy:</label>
      <select
        v-model="selectedStrategy"
        @change="handleStrategyChange"
        class="strategy-select"
      >
        <option value="equal">Equal - Same tokens per session</option>
        <option value="proportional">Proportional - Based on original size</option>
        <option value="recency">Recency - More tokens to recent sessions</option>
        <option value="manual">Manual - Custom allocation</option>
      </select>
    </div>

    <div class="strategy-description">
      <div v-if="selectedStrategy === 'equal'" class="strategy-info">
        <span class="info-icon">&#x2261;</span>
        <div class="info-text">
          <span class="info-title">Equal Distribution</span>
          <p>Each session receives approximately <strong>{{ formatTokens(equalAllocation) }}</strong> tokens.</p>
          <p class="info-note">Best when all sessions are equally important.</p>
        </div>
      </div>

      <div v-else-if="selectedStrategy === 'proportional'" class="strategy-info">
        <span class="info-icon">&#x21D4;</span>
        <div class="info-text">
          <span class="info-title">Proportional Distribution</span>
          <p>Sessions receive tokens proportional to their original size.</p>
          <p class="info-note">Larger sessions get more tokens to preserve more detail.</p>
        </div>
      </div>

      <div v-else-if="selectedStrategy === 'recency'" class="strategy-info">
        <span class="info-icon">&#x23F0;</span>
        <div class="info-text">
          <span class="info-title">Recency-Weighted Distribution</span>
          <p>Recent sessions receive more tokens than older ones.</p>
          <p class="info-note">Newest session gets most detail; oldest gets least.</p>
        </div>
      </div>

      <div v-else-if="selectedStrategy === 'manual'" class="strategy-info manual">
        <span class="info-icon">&#x270E;</span>
        <div class="info-text">
          <span class="info-title">Manual Allocation</span>
          <p>Set each component's token allocation individually below.</p>
          <p class="info-note">Full control over how tokens are distributed.</p>
        </div>
      </div>
    </div>

    <div v-if="showAllocationPreview && selectedStrategy !== 'manual'" class="allocation-preview">
      <div class="preview-header">
        <span class="preview-title">Allocation Preview</span>
        <button
          @click="applyStrategy"
          class="btn-apply"
          :disabled="componentCount === 0"
        >
          Apply
        </button>
      </div>
      <div class="preview-list">
        <div
          v-for="(alloc, idx) in previewAllocations"
          :key="idx"
          class="preview-item"
        >
          <span class="preview-session">{{ alloc.label }}</span>
          <span class="preview-tokens">{{ formatTokens(alloc.tokens) }}</span>
          <span class="preview-percent">{{ alloc.percent.toFixed(1) }}%</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: 'equal'
  },
  components: {
    type: Array,
    default: () => []
  },
  totalBudget: {
    type: Number,
    default: 100000
  },
  showAllocationPreview: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['update:modelValue', 'apply-allocations']);

const selectedStrategy = ref(props.modelValue);

watch(() => props.modelValue, (newVal) => {
  selectedStrategy.value = newVal;
});

const componentCount = computed(() => props.components.length);

const equalAllocation = computed(() => {
  if (componentCount.value === 0) return 0;
  return Math.floor(props.totalBudget / componentCount.value);
});

const previewAllocations = computed(() => {
  if (componentCount.value === 0) return [];

  const allocations = calculateAllocations(selectedStrategy.value);

  return props.components.map((comp, idx) => {
    const tokens = allocations[idx] || 0;
    return {
      sessionId: comp.sessionId,
      label: comp.sessionId?.substring(0, 8) + '...',
      tokens,
      percent: props.totalBudget > 0 ? (tokens / props.totalBudget) * 100 : 0
    };
  });
});

function calculateAllocations(strategy) {
  const count = componentCount.value;
  if (count === 0) return [];

  const budget = props.totalBudget;

  switch (strategy) {
    case 'equal': {
      const perSession = Math.floor(budget / count);
      const remainder = budget - (perSession * count);
      return props.components.map((_, idx) =>
        perSession + (idx < remainder ? 1 : 0)
      );
    }

    case 'proportional': {
      const totalOriginal = props.components.reduce(
        (sum, c) => sum + (c.originalTokens || c.tokenAllocation || 1000),
        0
      );
      if (totalOriginal === 0) {
        return props.components.map(() => Math.floor(budget / count));
      }
      let allocated = 0;
      return props.components.map((comp, idx) => {
        const original = comp.originalTokens || comp.tokenAllocation || 1000;
        const ratio = original / totalOriginal;
        let alloc;
        if (idx === count - 1) {
          alloc = budget - allocated;
        } else {
          alloc = Math.floor(budget * ratio);
          allocated += alloc;
        }
        return alloc;
      });
    }

    case 'recency': {
      // Sort by timestamp (most recent first) and weight accordingly
      // Weight formula: most recent = count points, oldest = 1 point
      const totalWeight = (count * (count + 1)) / 2; // Sum of 1..count
      const sortedIndices = [...Array(count).keys()].sort((a, b) => {
        const timeA = new Date(props.components[a].timestamp || 0).getTime();
        const timeB = new Date(props.components[b].timestamp || 0).getTime();
        return timeB - timeA; // Most recent first
      });

      const weights = new Array(count).fill(0);
      sortedIndices.forEach((originalIdx, sortedPos) => {
        // Most recent (sortedPos 0) gets weight = count
        // Oldest (sortedPos count-1) gets weight = 1
        weights[originalIdx] = count - sortedPos;
      });

      let allocated = 0;
      return props.components.map((_, idx) => {
        const weight = weights[idx];
        const ratio = weight / totalWeight;
        let alloc;
        if (idx === count - 1) {
          alloc = budget - allocated;
        } else {
          alloc = Math.floor(budget * ratio);
          allocated += alloc;
        }
        return alloc;
      });
    }

    case 'manual':
    default:
      return props.components.map(c => c.tokenAllocation || 0);
  }
}

function handleStrategyChange() {
  emit('update:modelValue', selectedStrategy.value);
}

function applyStrategy() {
  const allocations = calculateAllocations(selectedStrategy.value);
  emit('apply-allocations', allocations);
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
.allocation-strategy {
  padding: 1rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.strategy-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.strategy-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: #475569;
}

.strategy-select {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
  cursor: pointer;
  max-width: 300px;
}

.strategy-select:hover {
  border-color: #667eea;
}

.strategy-select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
}

.strategy-description {
  margin-bottom: 0.75rem;
}

.strategy-info {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
  background: white;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.strategy-info.manual {
  background: #fffbeb;
  border-color: #fcd34d;
}

.info-icon {
  font-size: 1.5rem;
  color: #667eea;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f4ff;
  border-radius: 8px;
}

.strategy-info.manual .info-icon {
  color: #d97706;
  background: #fef3c7;
}

.info-text {
  flex: 1;
}

.info-title {
  font-weight: 600;
  color: #334155;
  display: block;
  margin-bottom: 0.25rem;
}

.info-text p {
  margin: 0;
  font-size: 0.85rem;
  color: #64748b;
  line-height: 1.4;
}

.info-text p strong {
  color: #667eea;
}

.info-note {
  font-style: italic;
  color: #94a3b8 !important;
  margin-top: 0.25rem !important;
}

.allocation-preview {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e2e8f0;
}

.preview-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #475569;
}

.btn-apply {
  padding: 0.375rem 0.75rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-apply:hover:not(:disabled) {
  background: #5a67d8;
}

.btn-apply:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.preview-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.375rem 0.5rem;
  background: #f8fafc;
  border-radius: 4px;
  font-size: 0.85rem;
}

.preview-session {
  flex: 1;
  color: #475569;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.8rem;
}

.preview-tokens {
  font-weight: 600;
  color: #334155;
  min-width: 60px;
  text-align: right;
}

.preview-percent {
  color: #64748b;
  min-width: 50px;
  text-align: right;
}
</style>
