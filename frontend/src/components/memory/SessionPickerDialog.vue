<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="session-picker">
      <div class="picker-header">
        <h3>Add Sessions to Composition</h3>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>

      <div class="search-bar">
        <input
          v-model="search"
          type="text"
          placeholder="Search sessions by ID or date..."
          class="search-input"
          ref="searchInput"
        />
        <button
          v-if="search"
          class="clear-search"
          @click="search = ''"
        >
          &times;
        </button>
      </div>

      <div class="filter-bar">
        <label class="filter-option">
          <input
            type="checkbox"
            v-model="filters.hideAlreadyAdded"
          />
          <span>Hide already added</span>
        </label>
        <label class="filter-option">
          <input
            type="checkbox"
            v-model="filters.onlyWithVersions"
          />
          <span>Only with compressed versions</span>
        </label>
        <span class="filter-count">
          {{ filteredSessions.length }} of {{ sessions.length }} sessions
        </span>
      </div>

      <div class="sessions-list" v-if="!loading">
        <div v-if="filteredSessions.length === 0" class="empty-state">
          <span class="empty-icon">&#x1F50D;</span>
          <span>No sessions match your criteria</span>
        </div>

        <div
          v-for="session in filteredSessions"
          :key="session.sessionId"
          class="session-option"
          :class="{
            selected: isSelected(session),
            disabled: isAlreadyAdded(session)
          }"
          @click="toggleSelection(session)"
        >
          <div class="session-checkbox">
            <input
              type="checkbox"
              :checked="isSelected(session)"
              :disabled="isAlreadyAdded(session)"
              @click.stop
              @change="toggleSelection(session)"
            />
          </div>

          <div class="session-info">
            <div class="session-main">
              <span class="session-id">{{ formatSessionId(session.sessionId) }}</span>
              <span v-if="isAlreadyAdded(session)" class="already-added-badge">
                Already added
              </span>
            </div>
            <div class="session-meta">
              <span class="session-date">
                {{ formatDate(session.firstTimestamp || session.registeredAt) }}
              </span>
              <span class="session-divider">|</span>
              <span class="session-tokens" :title="session.originalTokens + ' tokens'">
                {{ formatTokens(session.originalTokens) }} tokens
              </span>
            </div>
          </div>

          <div class="session-versions" v-if="session.compressionCount > 0">
            <span class="version-badge">
              {{ session.compressionCount }} version{{ session.compressionCount !== 1 ? 's' : '' }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="loading" class="loading-state">
        <span class="loading-spinner"></span>
        <span>Loading sessions...</span>
      </div>

      <div class="dialog-footer">
        <div class="selection-summary">
          <span v-if="selectedSessions.length > 0">
            {{ selectedSessions.length }} session{{ selectedSessions.length !== 1 ? 's' : '' }} selected
          </span>
          <span v-else class="no-selection">No sessions selected</span>
        </div>

        <div class="dialog-actions">
          <button class="btn-cancel" @click="$emit('close')">
            Cancel
          </button>
          <button
            class="btn-add"
            @click="addSelected"
            :disabled="selectedSessions.length === 0"
          >
            Add {{ selectedSessions.length }} Session{{ selectedSessions.length !== 1 ? 's' : '' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';

const props = defineProps({
  sessions: {
    type: Array,
    default: () => []
  },
  existingSessionIds: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['close', 'add']);

const search = ref('');
const searchInput = ref(null);
const selectedSessions = ref([]);
const filters = ref({
  hideAlreadyAdded: true,
  onlyWithVersions: false
});

const filteredSessions = computed(() => {
  let result = props.sessions;

  // Apply search filter
  if (search.value.trim()) {
    const query = search.value.toLowerCase();
    result = result.filter(session => {
      const id = (session.sessionId || '').toLowerCase();
      const date = formatDate(session.firstTimestamp || session.registeredAt).toLowerCase();
      return id.includes(query) || date.includes(query);
    });
  }

  // Hide already added
  if (filters.value.hideAlreadyAdded) {
    result = result.filter(session => !isAlreadyAdded(session));
  }

  // Only with versions
  if (filters.value.onlyWithVersions) {
    result = result.filter(session => (session.compressionCount || 0) > 0);
  }

  // Sort by date (most recent first)
  result = [...result].sort((a, b) => {
    const dateA = new Date(a.firstTimestamp || a.registeredAt || 0).getTime();
    const dateB = new Date(b.firstTimestamp || b.registeredAt || 0).getTime();
    return dateB - dateA;
  });

  return result;
});

function isSelected(session) {
  return selectedSessions.value.some(s => s.sessionId === session.sessionId);
}

function isAlreadyAdded(session) {
  return props.existingSessionIds.includes(session.sessionId);
}

function toggleSelection(session) {
  if (isAlreadyAdded(session)) return;

  const idx = selectedSessions.value.findIndex(s => s.sessionId === session.sessionId);
  if (idx === -1) {
    selectedSessions.value.push(session);
  } else {
    selectedSessions.value.splice(idx, 1);
  }
}

function addSelected() {
  if (selectedSessions.value.length === 0) return;
  emit('add', selectedSessions.value);
}

function formatSessionId(id) {
  if (!id) return 'Unknown';
  if (id.length > 12) {
    return id.substring(0, 8) + '...' + id.substring(id.length - 4);
  }
  return id;
}

function formatDate(dateStr) {
  if (!dateStr) return 'Unknown date';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'Unknown date';
  }
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

onMounted(async () => {
  await nextTick();
  searchInput.value?.focus();
});
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

.session-picker {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}

.picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e2e8f0;
}

.picker-header h3 {
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

.search-bar {
  position: relative;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e2e8f0;
}

.search-input {
  width: 100%;
  padding: 0.75rem 1rem;
  padding-right: 2.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.95rem;
  transition: all 0.2s ease;
}

.search-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.clear-search {
  position: absolute;
  right: 2rem;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #e2e8f0;
  border-radius: 50%;
  font-size: 1rem;
  color: #64748b;
  cursor: pointer;
}

.clear-search:hover {
  background: #cbd5e1;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-wrap: wrap;
}

.filter-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #475569;
  cursor: pointer;
}

.filter-option input {
  cursor: pointer;
}

.filter-count {
  margin-left: auto;
  font-size: 0.8rem;
  color: #94a3b8;
}

.sessions-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  min-height: 200px;
  max-height: 400px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: #94a3b8;
  gap: 0.5rem;
}

.empty-icon {
  font-size: 2rem;
  opacity: 0.5;
}

.session-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.session-option:hover:not(.disabled) {
  background: #f1f5f9;
}

.session-option.selected {
  background: #eff6ff;
  border-color: #667eea;
}

.session-option.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.session-checkbox input {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.session-checkbox input:disabled {
  cursor: not-allowed;
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-main {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.session-id {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.9rem;
  font-weight: 500;
  color: #334155;
}

.already-added-badge {
  font-size: 0.7rem;
  padding: 0.125rem 0.375rem;
  background: #f1f5f9;
  color: #64748b;
  border-radius: 4px;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: #64748b;
}

.session-divider {
  color: #cbd5e1;
}

.session-versions {
  flex-shrink: 0;
}

.version-badge {
  padding: 0.25rem 0.5rem;
  background: #dbeafe;
  color: #2563eb;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  gap: 1rem;
  color: #64748b;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e2e8f0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  border-radius: 0 0 12px 12px;
}

.selection-summary {
  font-size: 0.9rem;
  color: #475569;
  font-weight: 500;
}

.no-selection {
  color: #94a3b8;
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

.btn-add {
  padding: 0.625rem 1.25rem;
  background: #667eea;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-add:hover:not(:disabled) {
  background: #5a67d8;
}

.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
