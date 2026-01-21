<template>
  <div class="session-list">
    <!-- Registered Sessions by Month -->
    <div v-for="(group, month) in groupedSessions" :key="month" class="session-group">
      <h4 class="group-header">{{ month }}</h4>
      <div
        v-for="session in group"
        :key="session.sessionId"
        class="session-item"
        :class="{
          selected: session.sessionId === selectedSessionId,
          'has-versions': session.compressionCount > 0,
          'has-sync': getSyncInfo(session.sessionId)?.hasNewMessages
        }"
        @click="$emit('select', session)"
      >
        <span
          class="session-indicator"
          :class="{ active: session.compressionCount > 0 }"
          :title="session.compressionCount + ' compression versions'"
        >
          {{ session.compressionCount > 0 ? '[M]' : '[ ]' }}
        </span>
        <div class="session-info">
          <span class="session-id">{{ formatSessionId(session.sessionId) }}</span>
          <span class="session-meta">
            {{ formatTokens(session.originalTokens) }} tokens
            <span v-if="session.compressionCount > 0" class="version-badge">
              {{ session.compressionCount }} ver.
            </span>
            <!-- Sync indicator -->
            <span
              v-if="getSyncInfo(session.sessionId)?.hasNewMessages"
              class="sync-badge"
              :title="`${getSyncInfo(session.sessionId).newCount} new messages available`"
            >
              +{{ getSyncInfo(session.sessionId).newCount }} new
            </span>
          </span>
        </div>
        <div class="session-actions">
          <!-- Sync button -->
          <button
            v-if="getSyncInfo(session.sessionId)?.hasNewMessages"
            class="btn-sync"
            :class="{ syncing: syncingSessionId === session.sessionId }"
            :disabled="syncingSessionId === session.sessionId"
            @click.stop="handleSync(session.sessionId)"
            title="Sync new messages from original"
          >
            <span v-if="syncingSessionId === session.sessionId">...</span>
            <span v-else>S</span>
          </button>
          <span class="session-date">{{ formatShortDate(session.firstTimestamp) }}</span>
        </div>
      </div>
    </div>

    <!-- Unregistered Sessions Section -->
    <div v-if="unregisteredSessions.length > 0" class="unregistered-section">
      <div class="section-divider">
        <span>Unregistered Sessions</span>
      </div>

      <div
        v-for="session in unregisteredSessions"
        :key="session.sessionId"
        class="session-item unregistered"
      >
        <span class="session-indicator inactive">[ ]</span>
        <div class="session-info">
          <span class="session-id">{{ formatSessionId(session.sessionId) }}</span>
          <span class="session-meta">
            {{ formatTokens(session.tokens) }} tokens
            <span class="message-count">{{ session.messageCount }} msg</span>
          </span>
        </div>
        <button
          class="btn-register"
          @click.stop="$emit('register', session)"
          title="Register this session"
        >
          +
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="sessions.length === 0 && unregisteredSessions.length === 0" class="empty-list">
      <span>No sessions available</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  sessions: {
    type: Array,
    default: () => []
  },
  unregisteredSessions: {
    type: Array,
    default: () => []
  },
  selectedSessionId: {
    type: String,
    default: ''
  },
  syncStatus: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['select', 'register', 'sync']);

// Local state for tracking which session is syncing
const syncingSessionId = ref(null);

// Group sessions by month
const groupedSessions = computed(() => {
  const groups = {};
  const sortedSessions = [...props.sessions].sort((a, b) => {
    const dateA = new Date(a.firstTimestamp || a.registeredAt);
    const dateB = new Date(b.firstTimestamp || b.registeredAt);
    return dateB - dateA; // Most recent first
  });

  for (const session of sortedSessions) {
    const date = new Date(session.firstTimestamp || session.registeredAt);
    const monthKey = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

    if (!groups[monthKey]) {
      groups[monthKey] = [];
    }
    groups[monthKey].push(session);
  }

  return groups;
});

function getSyncInfo(sessionId) {
  return props.syncStatus[sessionId] || null;
}

async function handleSync(sessionId) {
  syncingSessionId.value = sessionId;
  try {
    emit('sync', sessionId);
  } finally {
    // The parent will handle resetting this when sync completes
    // We'll reset it after a delay in case parent doesn't handle it
    setTimeout(() => {
      if (syncingSessionId.value === sessionId) {
        syncingSessionId.value = null;
      }
    }, 5000);
  }
}

// Expose method to clear syncing state (called by parent after sync completes)
function clearSyncing() {
  syncingSessionId.value = null;
}

defineExpose({ clearSyncing });

function formatSessionId(sessionId) {
  if (!sessionId) return '';
  return sessionId.substring(0, 8) + '...';
}

function formatTokens(tokens) {
  if (!tokens) return '0';
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  }
  if (tokens >= 1000) {
    return (tokens / 1000).toFixed(1) + 'K';
  }
  return tokens.toString();
}

function formatShortDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
</script>

<style scoped>
.session-list {
  padding: 0.5rem;
}

.session-group {
  margin-bottom: 1rem;
}

.group-header {
  margin: 0;
  padding: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: #f5f5f5;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 0.25rem;
}

.session-item:hover {
  border-color: #667eea;
  background-color: #f8f9ff;
}

.session-item.selected {
  border-color: #667eea;
  background-color: #e8eaf6;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
}

.session-item.has-versions {
  border-left: 3px solid #667eea;
}

.session-item.has-sync {
  border-right: 3px solid #ff9800;
}

.session-item.unregistered {
  background-color: #fafafa;
  opacity: 0.8;
}

.session-item.unregistered:hover {
  opacity: 1;
}

.session-indicator {
  font-family: monospace;
  font-size: 0.8rem;
  font-weight: 600;
  color: #999;
  min-width: 28px;
}

.session-indicator.active {
  color: #667eea;
}

.session-indicator.inactive {
  color: #ccc;
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.session-id {
  font-family: monospace;
  font-size: 0.85rem;
  color: #333;
  font-weight: 500;
}

.session-meta {
  font-size: 0.75rem;
  color: #666;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.version-badge {
  padding: 0.125rem 0.375rem;
  background: #667eea;
  color: white;
  border-radius: 3px;
  font-size: 0.65rem;
  font-weight: 600;
}

.sync-badge {
  padding: 0.125rem 0.375rem;
  background: #ff9800;
  color: white;
  border-radius: 3px;
  font-size: 0.65rem;
  font-weight: 600;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.message-count {
  color: #999;
}

.session-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.session-date {
  font-size: 0.75rem;
  color: #999;
  white-space: nowrap;
}

.btn-sync {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: #ff9800;
  color: white;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

.btn-sync:hover:not(:disabled) {
  background: #f57c00;
  transform: scale(1.1);
}

.btn-sync:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-sync.syncing {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.unregistered-section {
  margin-top: 1.5rem;
}

.section-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.section-divider::before,
.section-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e0e0e0;
}

.section-divider span {
  font-size: 0.75rem;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.btn-register {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

.btn-register:hover {
  background: #388e3c;
  transform: scale(1.1);
}

.empty-list {
  text-align: center;
  padding: 2rem;
  color: #999;
  font-size: 0.9rem;
}
</style>
