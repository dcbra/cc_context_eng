<template>
  <div class="keepit-list-inline">
    <div v-for="keepit in keepits" :key="keepit.id" class="keepit-item">
      <div class="keepit-weight" :class="getWeightClass(keepit.weight)">
        {{ formatWeight(keepit.weight) }}
      </div>
      <div class="keepit-content">
        <div class="keepit-text">{{ truncateContent(keepit.content) }}</div>
        <div class="keepit-meta">
          <span class="keepit-type">{{ keepit.type || 'manual' }}</span>
          <span class="keepit-date">{{ formatDate(keepit.createdAt) }}</span>
          <span v-if="keepit.decayedWeight !== undefined && keepit.decayedWeight !== keepit.weight" class="keepit-decayed">
            Decayed: {{ formatWeight(keepit.decayedWeight) }}
          </span>
        </div>
      </div>
      <div class="keepit-status" :class="{ surviving: keepit.surviving !== false }">
        {{ keepit.surviving !== false ? 'Preserved' : 'Will decay' }}
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  keepits: {
    type: Array,
    default: () => []
  }
});

function truncateContent(content) {
  if (!content) return '';
  if (content.length <= 100) return content;
  return content.substring(0, 100) + '...';
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatWeight(weight) {
  if (weight === undefined || weight === null) return '?';
  if (typeof weight === 'number') {
    return weight.toFixed(2);
  }
  return String(weight);
}

function getWeightClass(weight) {
  if (!weight && weight !== 0) return 'weight-low';
  if (weight >= 0.80) return 'weight-high';
  if (weight >= 0.50) return 'weight-medium';
  return 'weight-low';
}
</script>

<style scoped>
.keepit-list-inline {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.keepit-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.keepit-item:hover {
  background-color: #fafbff;
}

.keepit-weight {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 40px;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 600;
  font-family: monospace;
}

.keepit-weight.weight-high {
  background: #dcfce7;
  color: #166534;
}

.keepit-weight.weight-medium {
  background: #fef3c7;
  color: #92400e;
}

.keepit-weight.weight-low {
  background: #f3f4f6;
  color: #6b7280;
}

.keepit-content {
  flex: 1;
  min-width: 0;
}

.keepit-text {
  font-size: 0.85rem;
  color: #333;
  line-height: 1.4;
  word-break: break-word;
}

.keepit-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.375rem;
}

.keepit-type {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 0.125rem 0.375rem;
  background: #e8eaf6;
  color: #667eea;
  border-radius: 3px;
}

.keepit-date {
  font-size: 0.75rem;
  color: #999;
}

.keepit-decayed {
  font-size: 0.75rem;
  color: #f59e0b;
}

.keepit-status {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  background: #fee2e2;
  color: #991b1b;
  white-space: nowrap;
}

.keepit-status.surviving {
  background: #dcfce7;
  color: #166534;
}
</style>
