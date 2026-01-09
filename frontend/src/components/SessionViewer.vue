<template>
  <div class="session-viewer">
    <div class="viewer-header">
      <button class="back-btn" @click="$emit('close')">← Back</button>
      <div class="session-title">{{ session.fileName }}</div>
      <div class="session-size">{{ formatSize(session.size) }}</div>
    </div>

    <div v-if="loading" class="loading">Loading session data...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="session-content">
      <div class="content-grid">
        <!-- Left: Messages -->
        <div class="messages-panel">
          <div class="panel-header">
            <h3>Messages ({{ sessionData.totalMessages }})</h3>
            <div class="message-controls">
              <button @click="toggleAllMessages" class="btn-small">
                {{ selectionStore.allSelected ? 'Deselect All' : 'Select All' }}
              </button>
            </div>
          </div>

          <div class="messages-list">
            <div
              v-for="message in sessionData.messages"
              :key="message.uuid"
              class="message-item"
              :class="{ selected: selectionStore.selectedMessages.has(message.uuid) }"
            >
              <input
                type="checkbox"
                :checked="selectionStore.selectedMessages.has(message.uuid)"
                @change="selectionStore.toggleMessage(message.uuid)"
              />
              <div class="message-content">
                <div class="message-type" :class="message.type">{{ message.type }}</div>
                <div class="message-time">{{ formatTime(message.timestamp) }}</div>
                <div class="message-tokens">{{ message.tokens.total }}tk</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Files & Tokens -->
        <div class="meta-panel">
          <div class="panel-header">
            <h3>Files Read ({{ sessionData.files.length }})</h3>
          </div>
          <div class="files-list">
            <div
              v-for="file in sessionData.files"
              :key="file.path"
              class="file-item"
              :class="{ selected: selectionStore.selectedFiles.has(file.path) }"
            >
              <input
                type="checkbox"
                :checked="selectionStore.selectedFiles.has(file.path)"
                @change="selectionStore.toggleFile(file.path)"
              />
              <div class="file-info">
                <div class="file-name">{{ file.path.split('/').pop() }}</div>
                <div class="file-meta">{{ file.readCount }}x • {{ formatSize(file.totalContentSize) }}</div>
              </div>
            </div>
          </div>

          <div class="panel-header" style="margin-top: 1rem">
            <h3>Token Breakdown</h3>
          </div>
          <div class="token-summary">
            <div class="token-row">
              <span>Input:</span>
              <span>{{ sessionData.tokens.breakdown.input }}</span>
            </div>
            <div class="token-row">
              <span>Output:</span>
              <span>{{ sessionData.tokens.breakdown.output }}</span>
            </div>
            <div class="token-row">
              <span>Cache Read:</span>
              <span>{{ sessionData.tokens.breakdown.cacheRead }}</span>
            </div>
            <div class="token-row">
              <span>Cache Create:</span>
              <span>{{ sessionData.tokens.breakdown.cacheCreation }}</span>
            </div>
            <div class="token-row total">
              <span>Total:</span>
              <span>{{ sessionData.tokens.breakdown.total }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useSessionStore } from '../stores/session.js';
import { useSelectionStore } from '../stores/selection.js';
import { getSession } from '../utils/api.js';

const props = defineProps({
  session: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['close']);

const sessionStore = useSessionStore();
const selectionStore = useSelectionStore();
const loading = ref(true);
const error = ref(null);
const sessionData = ref(null);

onMounted(async () => {
  try {
    console.log('Loading session:', props.session.sessionId, 'from project:', props.session.projectId);
    sessionData.value = await getSession(props.session.sessionId, props.session.projectId);
    if (!sessionData.value || !sessionData.value.messages) {
      throw new Error('Invalid session data received');
    }
    selectionStore.setAllMessages(sessionData.value.messages);
  } catch (err) {
    console.error('Error loading session:', err);
    error.value = err.message || 'Failed to load session data';
  } finally {
    loading.value = false;
  }
});

function toggleAllMessages() {
  selectionStore.toggleAllMessages();
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.session-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.viewer-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: white;
  border-bottom: 1px solid #e0e0e0;
  border-radius: 8px 8px 0 0;
  margin-bottom: 0;
}

.back-btn {
  padding: 0.5rem 1rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.back-btn:hover {
  background: #764ba2;
}

.session-title {
  flex: 1;
  font-family: monospace;
  font-weight: 500;
  color: #333;
}

.session-size {
  color: #999;
  font-size: 0.9rem;
}

.loading,
.error {
  text-align: center;
  padding: 2rem;
}

.error {
  color: #d32f2f;
  background-color: #ffebee;
  border-radius: 4px;
}

.session-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.content-grid {
  display: grid;
  grid-template-columns: 1fr 350px;
  gap: 1rem;
  flex: 1;
  min-height: 0;
  padding: 0;
}

.messages-panel,
.meta-panel {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 1rem;
  background-color: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #333;
}

.message-controls {
  display: flex;
  gap: 0.5rem;
}

.btn-small {
  padding: 0.4rem 0.8rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.8rem;
}

.btn-small:hover {
  background: #764ba2;
}

.messages-list,
.files-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.message-item,
.file-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.message-item:hover,
.file-item:hover {
  background-color: #f0f4ff;
  border-color: #667eea;
}

.message-item.selected,
.file-item.selected {
  background-color: #e8eaf6;
  border-color: #667eea;
}

.message-item input,
.file-item input {
  cursor: pointer;
}

.message-content,
.file-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.85rem;
}

.message-type {
  font-weight: 600;
  padding: 0.2rem 0.4rem;
  border-radius: 2px;
  font-size: 0.75rem;
}

.message-type.user {
  background-color: #c8e6c9;
  color: #1b5e20;
}

.message-type.assistant {
  background-color: #bbdefb;
  color: #0d47a1;
}

.message-time {
  color: #999;
  flex: 1;
}

.message-tokens {
  color: #667eea;
  font-weight: 600;
  font-size: 0.75rem;
}

.file-name {
  font-family: monospace;
  color: #333;
  font-weight: 500;
}

.file-meta {
  color: #999;
  font-size: 0.8rem;
  margin-left: 0.5rem;
}

.token-summary {
  padding: 1rem;
}

.token-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  font-size: 0.9rem;
  border-bottom: 1px solid #e0e0e0;
}

.token-row.total {
  font-weight: 600;
  border-bottom: none;
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  padding-bottom: 0;
}

@media (max-width: 1024px) {
  .content-grid {
    grid-template-columns: 1fr;
  }

  .meta-panel {
    max-height: 300px;
  }
}
</style>
