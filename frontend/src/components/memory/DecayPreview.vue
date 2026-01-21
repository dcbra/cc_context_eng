<template>
  <div class="decay-preview">
    <div class="preview-header">
      <h4>Decay Preview</h4>
      <span class="preview-hint">Shows whether this marker would survive compression</span>
    </div>

    <div class="preview-content">
      <!-- Simple Matrix View -->
      <table class="decay-table">
        <thead>
          <tr>
            <th>Distance</th>
            <th v-for="ratio in ratios" :key="ratio">{{ ratio }}:1</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="distance in distances" :key="distance">
            <td class="distance-cell">{{ distance }}</td>
            <td
              v-for="ratio in ratios"
              :key="`${distance}-${ratio}`"
              :class="getSurvivalClass(distance, ratio)"
            >
              {{ getSurvivalText(distance, ratio) }}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Legend -->
      <div class="decay-legend">
        <div class="legend-item">
          <span class="legend-indicator survives"></span>
          <span>SURVIVES - Content kept as-is</span>
        </div>
        <div class="legend-item">
          <span class="legend-indicator summarized"></span>
          <span>Summarized - Content may be compressed</span>
        </div>
      </div>

      <!-- Explanation -->
      <div class="decay-explanation">
        <div class="explanation-header">How decay works:</div>
        <div class="explanation-text">
          <p>
            <strong>Distance:</strong> How many sessions ago this content appeared.
            Distance 1 = current session, 5 = 5 sessions ago.
          </p>
          <p>
            <strong>Ratio:</strong> The compression ratio being applied.
            Higher ratios (e.g., 50:1) are more aggressive.
          </p>
          <p>
            <strong>Formula:</strong> Effective weight = base weight - (distance * decay_rate * ratio_factor)
          </p>
          <p>
            Content with effective weight above the threshold survives compression intact.
          </p>
        </div>
      </div>

      <!-- Current Weight Info -->
      <div class="weight-info">
        <span class="info-label">Current weight:</span>
        <span class="info-value" :class="getWeightClass(weight)">{{ weight.toFixed(2) }}</span>
        <span class="info-tier">{{ getWeightLabel(weight) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  weight: {
    type: Number,
    required: true
  },
  projectId: {
    type: String,
    default: null
  },
  sessionId: {
    type: String,
    default: null
  }
});

// Configuration
const distances = [1, 3, 5, 10];
const ratios = [10, 30, 50];

// Decay calculation parameters (matching backend defaults)
const DECAY_RATE = 0.02;
const SURVIVAL_THRESHOLD = 0.5;
const RATIO_DECAY_FACTOR = 0.005;

/**
 * Calculate effective weight after decay
 * Mirrors the backend decay calculation formula
 */
function calculateEffectiveWeight(baseWeight, distance, compressionRatio) {
  // Ratio factor: higher compression ratios cause more decay
  const ratioFactor = 1 + (compressionRatio - 10) * RATIO_DECAY_FACTOR;

  // Distance decay
  const decay = distance * DECAY_RATE * ratioFactor;

  // Calculate effective weight (minimum 0)
  const effectiveWeight = Math.max(0, baseWeight - decay);

  return effectiveWeight;
}

/**
 * Determine if content survives compression at given parameters
 */
function survives(distance, compressionRatio) {
  const effectiveWeight = calculateEffectiveWeight(props.weight, distance, compressionRatio);
  return effectiveWeight >= SURVIVAL_THRESHOLD;
}

function getSurvivalClass(distance, ratio) {
  return survives(distance, ratio) ? 'survives' : 'summarized';
}

function getSurvivalText(distance, ratio) {
  return survives(distance, ratio) ? 'SURVIVES' : 'Summarized';
}

function getWeightClass(weight) {
  if (weight >= 0.95) return 'weight-pinned';
  if (weight >= 0.80) return 'weight-critical';
  if (weight >= 0.65) return 'weight-important';
  if (weight >= 0.45) return 'weight-notable';
  return 'weight-minor';
}

function getWeightLabel(weight) {
  if (weight >= 0.95) return 'Pinned';
  if (weight >= 0.80) return 'Critical';
  if (weight >= 0.65) return 'Important';
  if (weight >= 0.45) return 'Notable';
  return 'Minor';
}
</script>

<style scoped>
.decay-preview {
  background: #f9f9f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 1rem;
}

.preview-header {
  display: flex;
  flex-direction: column;
  margin-bottom: 1rem;
}

.preview-header h4 {
  margin: 0;
  color: #4a5568;
  font-size: 0.95rem;
}

.preview-hint {
  font-size: 0.75rem;
  color: #a0aec0;
  margin-top: 0.25rem;
}

.preview-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Decay Table */
.decay-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.decay-table th,
.decay-table td {
  padding: 0.5rem;
  text-align: center;
  border: 1px solid #e2e8f0;
}

.decay-table th {
  background: #edf2f7;
  color: #4a5568;
  font-weight: 600;
  font-size: 0.75rem;
}

.distance-cell {
  background: #edf2f7;
  color: #4a5568;
  font-weight: 500;
}

.decay-table td.survives {
  background: #c6f6d5;
  color: #276749;
  font-weight: 600;
}

.decay-table td.summarized {
  background: #feebc8;
  color: #c05621;
  font-weight: 500;
}

/* Legend */
.decay-legend {
  display: flex;
  gap: 1.5rem;
  padding: 0.5rem 0;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #4a5568;
}

.legend-indicator {
  width: 16px;
  height: 16px;
  border-radius: 3px;
}

.legend-indicator.survives {
  background: #c6f6d5;
  border: 1px solid #276749;
}

.legend-indicator.summarized {
  background: #feebc8;
  border: 1px solid #c05621;
}

/* Explanation */
.decay-explanation {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 0.75rem;
}

.explanation-header {
  font-weight: 600;
  color: #4a5568;
  margin-bottom: 0.5rem;
  font-size: 0.8rem;
}

.explanation-text {
  font-size: 0.75rem;
  color: #718096;
  line-height: 1.5;
}

.explanation-text p {
  margin: 0 0 0.5rem 0;
}

.explanation-text p:last-child {
  margin-bottom: 0;
}

.explanation-text strong {
  color: #4a5568;
}

/* Weight Info */
.weight-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: white;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}

.info-label {
  font-size: 0.8rem;
  color: #718096;
}

.info-value {
  font-family: monospace;
  font-weight: 700;
  font-size: 0.9rem;
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
}

.info-value.weight-pinned {
  background: #fed7d7;
  color: #c53030;
}

.info-value.weight-critical {
  background: #feebc8;
  color: #c05621;
}

.info-value.weight-important {
  background: #fefcbf;
  color: #975a16;
}

.info-value.weight-notable {
  background: #c6f6d5;
  color: #276749;
}

.info-value.weight-minor {
  background: #e2e8f0;
  color: #4a5568;
}

.info-tier {
  font-size: 0.8rem;
  color: #718096;
  font-style: italic;
}
</style>
