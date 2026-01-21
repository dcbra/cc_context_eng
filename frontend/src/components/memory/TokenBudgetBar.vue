<template>
  <div class="token-budget-bar">
    <div class="bar-header">
      <div class="budget-info">
        <span class="budget-label">Token Budget:</span>
        <span class="budget-values" :class="{ 'over-budget': isOverBudget }">
          {{ formatTokens(usedTokens) }} / {{ formatTokens(totalBudget) }}
        </span>
        <span v-if="isOverBudget" class="overflow-warning">
          (+{{ formatTokens(usedTokens - totalBudget) }} over)
        </span>
      </div>
      <div class="budget-percentage" :class="percentageClass">
        {{ usedPercentage.toFixed(0) }}%
      </div>
    </div>

    <div class="bar-container">
      <div class="bar-track">
        <div
          v-for="(segment, idx) in segments"
          :key="idx"
          class="bar-segment"
          :style="{
            width: segment.width + '%',
            backgroundColor: segment.color
          }"
          :title="`${segment.label}: ${formatTokens(segment.tokens)} tokens`"
        >
          <span v-if="segment.width > 8" class="segment-label">
            {{ segment.shortLabel }}
          </span>
        </div>
        <div
          v-if="remainingWidth > 0"
          class="bar-remaining"
          :style="{ width: remainingWidth + '%' }"
          title="Remaining budget"
        ></div>
        <div
          v-if="isOverBudget"
          class="bar-overflow"
          :style="{ width: Math.min(overflowWidth, 100) + '%' }"
          title="Over budget"
        ></div>
      </div>
      <div class="budget-marker" :style="{ left: budgetMarkerPosition + '%' }"></div>
    </div>

    <div v-if="showLegend && segments.length > 0" class="bar-legend">
      <div
        v-for="(segment, idx) in segments"
        :key="idx"
        class="legend-item"
        :class="{ 'legend-overflow': segment.isOverflow }"
      >
        <span
          class="legend-color"
          :style="{ backgroundColor: segment.color }"
        ></span>
        <span class="legend-label">{{ segment.label }}</span>
        <span class="legend-tokens">{{ formatTokens(segment.tokens) }}</span>
      </div>
      <div v-if="remainingTokens > 0" class="legend-item legend-remaining">
        <span class="legend-color" style="backgroundColor: #e5e7eb"></span>
        <span class="legend-label">Remaining</span>
        <span class="legend-tokens">{{ formatTokens(remainingTokens) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  components: {
    type: Array,
    default: () => []
  },
  totalBudget: {
    type: Number,
    default: 100000
  },
  showLegend: {
    type: Boolean,
    default: true
  }
});

// Color palette for session segments
const SESSION_COLORS = [
  '#667eea', // purple-blue
  '#48bb78', // green
  '#ed8936', // orange
  '#4299e1', // blue
  '#9f7aea', // purple
  '#38b2ac', // teal
  '#f56565', // red
  '#ecc94b', // yellow
  '#68d391', // light green
  '#fc8181'  // light red
];

const usedTokens = computed(() => {
  return props.components.reduce((sum, c) => sum + (c.tokenAllocation || 0), 0);
});

const isOverBudget = computed(() => usedTokens.value > props.totalBudget);

const usedPercentage = computed(() => {
  if (props.totalBudget <= 0) return 0;
  return (usedTokens.value / props.totalBudget) * 100;
});

const remainingTokens = computed(() => {
  return Math.max(0, props.totalBudget - usedTokens.value);
});

const remainingWidth = computed(() => {
  if (props.totalBudget <= 0) return 0;
  const remaining = props.totalBudget - usedTokens.value;
  if (remaining <= 0) return 0;
  return (remaining / props.totalBudget) * 100;
});

const overflowWidth = computed(() => {
  if (!isOverBudget.value) return 0;
  const overflow = usedTokens.value - props.totalBudget;
  // Show overflow as percentage of budget, capped at 20% visual width
  return Math.min((overflow / props.totalBudget) * 100, 20);
});

const budgetMarkerPosition = computed(() => {
  if (isOverBudget.value) {
    // When over budget, position marker at 100 - overflow
    return Math.max(80, 100 - overflowWidth.value);
  }
  return 100;
});

const percentageClass = computed(() => {
  if (usedPercentage.value > 100) return 'over';
  if (usedPercentage.value > 90) return 'warning';
  if (usedPercentage.value > 70) return 'moderate';
  return 'good';
});

const segments = computed(() => {
  if (props.totalBudget <= 0) return [];

  const maxWidth = isOverBudget.value ? usedTokens.value : props.totalBudget;

  return props.components.map((component, idx) => {
    const tokens = component.tokenAllocation || 0;
    const width = maxWidth > 0 ? (tokens / maxWidth) * 100 : 0;
    const sessionId = component.sessionId || `Session ${idx + 1}`;
    const shortId = sessionId.substring(0, 8);

    return {
      tokens,
      width,
      color: SESSION_COLORS[idx % SESSION_COLORS.length],
      label: shortId + (sessionId.length > 8 ? '...' : ''),
      shortLabel: shortId.substring(0, 4),
      isOverflow: false
    };
  });
});

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
.token-budget-bar {
  width: 100%;
}

.bar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.budget-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.budget-label {
  font-size: 0.85rem;
  color: #64748b;
  font-weight: 500;
}

.budget-values {
  font-size: 0.95rem;
  font-weight: 600;
  color: #334155;
}

.budget-values.over-budget {
  color: #dc2626;
}

.overflow-warning {
  font-size: 0.8rem;
  color: #dc2626;
  font-weight: 600;
  background: #fee2e2;
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
}

.budget-percentage {
  font-size: 0.9rem;
  font-weight: 700;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.budget-percentage.good {
  color: #059669;
  background: #d1fae5;
}

.budget-percentage.moderate {
  color: #d97706;
  background: #fef3c7;
}

.budget-percentage.warning {
  color: #dc2626;
  background: #fee2e2;
}

.budget-percentage.over {
  color: #ffffff;
  background: #dc2626;
}

.bar-container {
  position: relative;
  margin-bottom: 0.75rem;
}

.bar-track {
  display: flex;
  height: 28px;
  background: #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
}

.bar-segment {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 2px;
  transition: width 0.3s ease;
  position: relative;
}

.segment-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 0.25rem;
}

.bar-remaining {
  background: #e5e7eb;
  transition: width 0.3s ease;
}

.bar-overflow {
  background: repeating-linear-gradient(
    45deg,
    #dc2626,
    #dc2626 10px,
    #ef4444 10px,
    #ef4444 20px
  );
  transition: width 0.3s ease;
}

.budget-marker {
  position: absolute;
  top: -4px;
  width: 2px;
  height: 36px;
  background: #1f2937;
  transform: translateX(-50%);
  transition: left 0.3s ease;
}

.budget-marker::before {
  content: '';
  position: absolute;
  top: -4px;
  left: -4px;
  width: 10px;
  height: 10px;
  background: #1f2937;
  border-radius: 50%;
}

.bar-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-top: 0.5rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8rem;
}

.legend-item.legend-overflow {
  color: #dc2626;
}

.legend-item.legend-remaining {
  color: #64748b;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.legend-label {
  color: #475569;
  font-weight: 500;
}

.legend-tokens {
  color: #64748b;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.75rem;
}
</style>
