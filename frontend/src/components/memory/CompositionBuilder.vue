<template>
  <div class="composition-builder">
    <div class="builder-header">
      <h3>Compose Context</h3>
      <p class="header-description">
        Combine compressed sessions into a single context for AI conversations
      </p>
    </div>

    <div class="builder-form">
      <!-- Composition Name -->
      <div class="form-section">
        <label class="form-label">
          Composition Name
          <span class="required">*</span>
        </label>
        <input
          v-model="compositionName"
          type="text"
          placeholder="e.g., Project context for feature X..."
          class="form-input"
          :class="{ error: !compositionName && showValidation }"
        />
        <span v-if="!compositionName && showValidation" class="validation-error">
          Name is required
        </span>
      </div>

      <!-- Token Budget -->
      <div class="form-section">
        <label class="form-label">Total Token Budget</label>
        <div class="budget-input-group">
          <input
            v-model.number="totalBudget"
            type="number"
            min="1000"
            max="2000000"
            step="1000"
            class="form-input budget-input"
          />
          <span class="budget-suffix">tokens</span>
          <div class="budget-presets">
            <button
              v-for="preset in budgetPresets"
              :key="preset.value"
              @click="totalBudget = preset.value"
              class="preset-btn"
              :class="{ active: totalBudget === preset.value }"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Token Budget Bar -->
      <div class="form-section">
        <TokenBudgetBar
          :components="components"
          :total-budget="totalBudget"
          :show-legend="components.length > 0"
        />
      </div>

      <!-- Allocation Strategy -->
      <div class="form-section" v-if="components.length > 0">
        <AllocationStrategySelector
          v-model="allocationStrategy"
          :components="components"
          :total-budget="totalBudget"
          @apply-allocations="applyAllocations"
        />
      </div>

      <!-- Components Section -->
      <div class="components-section">
        <div class="section-header">
          <h4>Components ({{ components.length }})</h4>
          <button @click="openSessionPicker" class="btn-add-session">
            + Add Session
          </button>
        </div>

        <div v-if="components.length === 0" class="empty-components">
          <span class="empty-icon">&#x1F4DA;</span>
          <span class="empty-text">No sessions added yet</span>
          <button @click="openSessionPicker" class="btn-add-first">
            Add your first session
          </button>
        </div>

        <div v-else class="components-list">
          <CompositionComponent
            v-for="(component, idx) in components"
            :key="component.sessionId"
            :component="component"
            :session="getSessionData(component.sessionId)"
            :available-versions="getVersionsForSession(component.sessionId)"
            :order-index="idx + 1"
            :total-budget="totalBudget"
            :dragging="dragIndex === idx"
            @update="(updated) => updateComponent(idx, updated)"
            @remove="removeComponent(idx)"
            @drag-start="(e) => startDrag(e, idx)"
            @recompress="handleRecompress"
          />
        </div>
      </div>

      <!-- Output Format -->
      <div class="form-section output-section">
        <label class="form-label">Output Format</label>
        <div class="format-options">
          <label class="format-option">
            <input type="checkbox" v-model="outputMarkdown" />
            <span class="format-icon">&#x1F4DD;</span>
            <span>Markdown (.md)</span>
          </label>
          <label class="format-option">
            <input type="checkbox" v-model="outputJsonl" />
            <span class="format-icon">&#x1F4C4;</span>
            <span>JSONL (.jsonl)</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="builder-actions">
      <div class="action-info">
        <span v-if="isOverBudget" class="over-budget-warning">
          Over budget by {{ formatTokens(totalUsed - totalBudget) }} tokens
        </span>
      </div>
      <div class="action-buttons">
        <button @click="handlePreview" class="btn-preview" :disabled="!canPreview">
          Preview
        </button>
        <button
          @click="handleCompose"
          class="btn-compose"
          :disabled="!canCreate || isCreating"
        >
          {{ isCreating ? 'Creating...' : 'Compose' }}
        </button>
      </div>
    </div>

    <!-- Session Picker Dialog -->
    <SessionPickerDialog
      v-if="showSessionPicker"
      :sessions="availableSessions"
      :existing-session-ids="existingSessionIds"
      :loading="loadingSessions"
      @close="showSessionPicker = false"
      @add="addSessions"
    />

    <!-- Preview Dialog -->
    <CompositionPreview
      v-if="showPreview"
      :composition-name="compositionName"
      :components="components"
      :budget="totalBudget"
      :allocation-strategy="allocationStrategy"
      :creating="isCreating"
      @close="showPreview = false"
      @confirm="confirmComposition"
      @load-preview="loadContentPreview"
    />

    <!-- Error Display -->
    <div v-if="error" class="error-banner">
      <span class="error-icon">&#x26A0;</span>
      <span class="error-message">{{ error }}</span>
      <button @click="error = null" class="error-dismiss">&times;</button>
    </div>

    <!-- Success Display -->
    <div v-if="successMessage" class="success-banner">
      <span class="success-icon">&#x2713;</span>
      <span class="success-message">{{ successMessage }}</span>
      <button @click="successMessage = null" class="success-dismiss">&times;</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useMemoryStore } from '../../stores/memory.js';
import TokenBudgetBar from './TokenBudgetBar.vue';
import AllocationStrategySelector from './AllocationStrategySelector.vue';
import CompositionComponent from './CompositionComponent.vue';
import SessionPickerDialog from './SessionPickerDialog.vue';
import CompositionPreview from './CompositionPreview.vue';

const props = defineProps({
  projectId: {
    type: String,
    required: true
  }
});

const emit = defineEmits(['composition-created']);

const memoryStore = useMemoryStore();

// Form state
const compositionName = ref('');
const totalBudget = ref(100000);
const allocationStrategy = ref('equal');
const components = ref([]);
const outputMarkdown = ref(true);
const outputJsonl = ref(false);
const showValidation = ref(false);

// UI state
const showSessionPicker = ref(false);
const showPreview = ref(false);
const loadingSessions = ref(false);
const isCreating = ref(false);
const error = ref(null);
const successMessage = ref(null);

// Drag and drop state
const dragIndex = ref(null);
const dragOverIndex = ref(null);

// Session/version data cache
const sessionDataCache = ref({});
const versionDataCache = ref({});

const budgetPresets = [
  { label: '50K', value: 50000 },
  { label: '100K', value: 100000 },
  { label: '200K', value: 200000 },
  { label: '500K', value: 500000 }
];

const availableSessions = computed(() => {
  return memoryStore.sessions || [];
});

const existingSessionIds = computed(() => {
  return components.value.map(c => c.sessionId);
});

const totalUsed = computed(() => {
  return components.value.reduce((sum, c) => sum + (c.tokenAllocation || 0), 0);
});

const isOverBudget = computed(() => totalUsed.value > totalBudget.value);

const canPreview = computed(() => {
  return compositionName.value.trim() !== '' && components.value.length > 0;
});

const canCreate = computed(() => {
  return canPreview.value && (outputMarkdown.value || outputJsonl.value);
});

// Load sessions on mount
onMounted(async () => {
  if (props.projectId) {
    await loadSessions();
  }
});

// Watch for project changes
watch(() => props.projectId, async (newProjectId) => {
  if (newProjectId) {
    components.value = [];
    sessionDataCache.value = {};
    versionDataCache.value = {};
    await loadSessions();
  }
});

async function loadSessions() {
  loadingSessions.value = true;
  try {
    await memoryStore.loadSessions(props.projectId);
  } catch (err) {
    error.value = 'Failed to load sessions: ' + err.message;
  } finally {
    loadingSessions.value = false;
  }
}

function openSessionPicker() {
  showSessionPicker.value = true;
}

function addSessions(sessions) {
  for (const session of sessions) {
    // Check for duplicate
    if (existingSessionIds.value.includes(session.sessionId)) continue;

    components.value.push({
      sessionId: session.sessionId,
      versionId: null, // Auto-select
      tokenAllocation: 0,
      originalTokens: session.originalTokens || 0,
      timestamp: session.firstTimestamp || session.registeredAt
    });

    // Cache session data
    sessionDataCache.value[session.sessionId] = session;

    // Load versions for this session
    loadVersionsForSession(session.sessionId);
  }

  // Apply allocation strategy after adding
  if (allocationStrategy.value !== 'manual') {
    autoAllocate();
  }

  showSessionPicker.value = false;
}

async function loadVersionsForSession(sessionId) {
  try {
    const versions = await memoryStore.loadVersions(props.projectId, sessionId);
    versionDataCache.value[sessionId] = versions || [];
  } catch (err) {
    console.warn('Failed to load versions for session:', sessionId, err);
    versionDataCache.value[sessionId] = [];
  }
}

function getSessionData(sessionId) {
  return sessionDataCache.value[sessionId] || null;
}

function getVersionsForSession(sessionId) {
  return versionDataCache.value[sessionId] || [];
}

function updateComponent(idx, updated) {
  components.value[idx] = { ...components.value[idx], ...updated };
}

function removeComponent(idx) {
  components.value.splice(idx, 1);
  if (allocationStrategy.value !== 'manual') {
    autoAllocate();
  }
}

function applyAllocations(allocations) {
  allocations.forEach((allocation, idx) => {
    if (components.value[idx]) {
      components.value[idx].tokenAllocation = allocation;
    }
  });
}

function autoAllocate() {
  const count = components.value.length;
  if (count === 0) return;

  let allocations = [];

  switch (allocationStrategy.value) {
    case 'equal': {
      const perSession = Math.floor(totalBudget.value / count);
      const remainder = totalBudget.value - (perSession * count);
      allocations = components.value.map((_, idx) =>
        perSession + (idx < remainder ? 1 : 0)
      );
      break;
    }

    case 'proportional': {
      const totalOriginal = components.value.reduce(
        (sum, c) => sum + (c.originalTokens || 1000), 0
      );
      let allocated = 0;
      allocations = components.value.map((comp, idx) => {
        const ratio = (comp.originalTokens || 1000) / totalOriginal;
        let alloc;
        if (idx === count - 1) {
          alloc = totalBudget.value - allocated;
        } else {
          alloc = Math.floor(totalBudget.value * ratio);
          allocated += alloc;
        }
        return alloc;
      });
      break;
    }

    case 'recency': {
      const totalWeight = (count * (count + 1)) / 2;
      const sortedIndices = [...Array(count).keys()].sort((a, b) => {
        const timeA = new Date(components.value[a].timestamp || 0).getTime();
        const timeB = new Date(components.value[b].timestamp || 0).getTime();
        return timeB - timeA;
      });

      const weights = new Array(count).fill(0);
      sortedIndices.forEach((originalIdx, sortedPos) => {
        weights[originalIdx] = count - sortedPos;
      });

      let allocated = 0;
      allocations = components.value.map((_, idx) => {
        const ratio = weights[idx] / totalWeight;
        let alloc;
        if (idx === count - 1) {
          alloc = totalBudget.value - allocated;
        } else {
          alloc = Math.floor(totalBudget.value * ratio);
          allocated += alloc;
        }
        return alloc;
      });
      break;
    }

    default:
      return;
  }

  applyAllocations(allocations);
}

// Watch allocation strategy changes
watch(allocationStrategy, (newStrategy) => {
  if (newStrategy !== 'manual' && components.value.length > 0) {
    autoAllocate();
  }
});

// Watch budget changes
watch(totalBudget, () => {
  if (allocationStrategy.value !== 'manual' && components.value.length > 0) {
    autoAllocate();
  }
});

// Drag and drop handlers
function startDrag(event, idx) {
  dragIndex.value = idx;

  const handleMouseMove = (e) => {
    // Could implement drag preview here
  };

  const handleMouseUp = (e) => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    if (dragOverIndex.value !== null && dragIndex.value !== dragOverIndex.value) {
      const item = components.value.splice(dragIndex.value, 1)[0];
      components.value.splice(dragOverIndex.value, 0, item);
    }

    dragIndex.value = null;
    dragOverIndex.value = null;
  };

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

async function handleRecompress({ sessionId, targetTokens, callback }) {
  try {
    // Call the compression API
    await memoryStore.createCompressionVersion(props.projectId, sessionId, {
      mode: 'uniform',
      targetTokens,
      model: 'sonnet'
    });

    // Reload versions for this session
    await loadVersionsForSession(sessionId);

    callback?.();
  } catch (err) {
    error.value = 'Recompression failed: ' + err.message;
    callback?.();
  }
}

function handlePreview() {
  showValidation.value = true;
  if (!canPreview.value) return;
  showPreview.value = true;
}

async function loadContentPreview({ format, callback }) {
  try {
    const request = buildCompositionRequest();
    const preview = await memoryStore.previewComposition(props.projectId, {
      ...request,
      format
    });
    callback({ content: preview.content || preview.preview });
  } catch (err) {
    callback({ error: err.message });
  }
}

async function handleCompose() {
  showValidation.value = true;
  if (!canCreate.value) return;

  await createComposition({
    outputMarkdown: outputMarkdown.value,
    outputJsonl: outputJsonl.value
  });
}

async function confirmComposition(options) {
  await createComposition(options);
}

async function createComposition(options) {
  isCreating.value = true;
  error.value = null;

  try {
    const request = buildCompositionRequest();
    request.outputFormats = [];
    if (options.outputMarkdown) request.outputFormats.push('md');
    if (options.outputJsonl) request.outputFormats.push('jsonl');

    const composition = await memoryStore.createComposition(props.projectId, request);

    successMessage.value = `Composition "${compositionName.value}" created successfully!`;
    showPreview.value = false;

    // Reset form
    compositionName.value = '';
    components.value = [];
    showValidation.value = false;

    emit('composition-created', composition);

    // Auto-dismiss success after 5 seconds
    setTimeout(() => {
      successMessage.value = null;
    }, 5000);

  } catch (err) {
    error.value = 'Failed to create composition: ' + err.message;
  } finally {
    isCreating.value = false;
  }
}

function buildCompositionRequest() {
  return {
    name: compositionName.value,
    totalTokenBudget: totalBudget.value,
    allocationStrategy: allocationStrategy.value,
    components: components.value.map((c, idx) => ({
      sessionId: c.sessionId,
      versionId: c.versionId,
      tokenAllocation: c.tokenAllocation,
      order: idx
    }))
  };
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
.composition-builder {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.builder-header {
  padding: 1.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.builder-header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.header-description {
  margin: 0.5rem 0 0 0;
  font-size: 0.9rem;
  opacity: 0.9;
}

.builder-form {
  padding: 1.5rem;
}

.form-section {
  margin-bottom: 1.5rem;
}

.form-label {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.required {
  color: #dc2626;
  margin-left: 0.125rem;
}

.form-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.95rem;
  transition: all 0.2s ease;
}

.form-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.form-input.error {
  border-color: #dc2626;
}

.validation-error {
  display: block;
  margin-top: 0.375rem;
  font-size: 0.8rem;
  color: #dc2626;
}

.budget-input-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.budget-input {
  width: 150px;
}

.budget-suffix {
  font-size: 0.9rem;
  color: #64748b;
}

.budget-presets {
  display: flex;
  gap: 0.375rem;
}

.preset-btn {
  padding: 0.375rem 0.75rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.8rem;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
}

.preset-btn:hover {
  background: #e2e8f0;
  border-color: #cbd5e1;
}

.preset-btn.active {
  background: #667eea;
  border-color: #667eea;
  color: white;
}

.components-section {
  padding: 1rem;
  background: #f8fafc;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.section-header h4 {
  margin: 0;
  font-size: 0.95rem;
  color: #334155;
}

.btn-add-session {
  padding: 0.5rem 1rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-add-session:hover {
  background: #5a67d8;
  transform: translateY(-1px);
}

.empty-components {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 2rem;
  color: #94a3b8;
  text-align: center;
}

.empty-icon {
  font-size: 2.5rem;
  margin-bottom: 0.75rem;
  opacity: 0.5;
}

.empty-text {
  font-size: 0.95rem;
  margin-bottom: 1rem;
}

.btn-add-first {
  padding: 0.625rem 1.25rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-add-first:hover {
  background: #5a67d8;
}

.components-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.output-section {
  padding-top: 1rem;
  border-top: 1px solid #e2e8f0;
}

.format-options {
  display: flex;
  gap: 1.5rem;
}

.format-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  color: #475569;
}

.format-option input {
  cursor: pointer;
}

.format-icon {
  font-size: 1.1rem;
}

.builder-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}

.action-info {
  flex: 1;
}

.over-budget-warning {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: #fee2e2;
  color: #dc2626;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
}

.action-buttons {
  display: flex;
  gap: 0.75rem;
}

.btn-preview {
  padding: 0.75rem 1.5rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 500;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-preview:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.btn-preview:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-compose {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-compose:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-compose:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.error-banner,
.success-banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1rem 1.5rem;
  padding: 1rem;
  border-radius: 8px;
}

.error-banner {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
}

.success-banner {
  background: #f0fdf4;
  border: 1px solid #86efac;
  color: #166534;
}

.error-icon,
.success-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.error-message,
.success-message {
  flex: 1;
  font-size: 0.9rem;
}

.error-dismiss,
.success-dismiss {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  font-size: 1.25rem;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.error-dismiss {
  color: #dc2626;
}

.error-dismiss:hover {
  background: #fee2e2;
}

.success-dismiss {
  color: #166534;
}

.success-dismiss:hover {
  background: #dcfce7;
}
</style>
