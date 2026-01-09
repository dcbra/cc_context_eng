<template>
  <div class="session-editor">
    <div class="editor-header">
      <button class="back-btn" @click="$emit('close')">← Back to Projects</button>
      <div class="session-info">
        <h2>{{ session.fileName }}</h2>
        <div class="meta">{{ formatSize(session.size) }} • {{ sessionData?.totalMessages || 0 }} messages</div>
      </div>
      <div class="header-actions">
        <button @click="activeTab = 'messages'" :class="{ active: activeTab === 'messages' }" class="tab-btn">
          Messages
        </button>
        <button @click="activeTab = 'files'" :class="{ active: activeTab === 'files' }" class="tab-btn">
          Files
        </button>
        <button @click="activeTab = 'sanitize'" :class="{ active: activeTab === 'sanitize' }" class="tab-btn">
          Sanitize
        </button>
        <button @click="activeTab = 'tokens'" :class="{ active: activeTab === 'tokens' }" class="tab-btn">
          Tokens
        </button>
        <button @click="activeTab = 'backups'" :class="{ active: activeTab === 'backups' }" class="tab-btn">
          Backups
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading session data...</p>
    </div>

    <div v-else-if="error" class="error-container">
      <p>{{ error }}</p>
      <button @click="retry">Retry</button>
    </div>

    <div v-else class="editor-content">
      <!-- Messages Tab -->
      <div v-if="activeTab === 'messages'" class="tab-content">
        <div class="messages-section">
          <div class="section-header">
            <h3>Messages ({{ sessionData.totalMessages }})</h3>
            <div class="controls">
              <button @click="selectAllMessages" class="btn-small">Select All</button>
              <button @click="clearAllMessages" class="btn-small">Clear</button>
              <span class="selected-count">{{ selectedCount }} selected</span>
            </div>
          </div>

          <div class="messages-container">
            <div
              v-for="message in sessionData.messages"
              :key="message.uuid"
              class="message-card"
              :class="{ selected: selectionStore.selectedMessages.has(message.uuid), expanded: expandedMessageId === message.uuid }"
            >
              <div class="message-checkbox">
                <input
                  type="checkbox"
                  :checked="selectionStore.selectedMessages.has(message.uuid)"
                  @change="selectionStore.toggleMessage(message.uuid)"
                  @click.stop
                />
              </div>

              <div class="message-body" @click="expandedMessageId = expandedMessageId === message.uuid ? null : message.uuid">
                <div class="message-header">
                  <span class="message-type" :class="message.type">{{ message.type }}</span>
                  <span class="message-time">{{ formatTime(message.timestamp) }}</span>
                  <span class="message-tokens">{{ message.tokens.total }} tokens</span>
                  <span v-if="message.toolUses.length > 0" class="message-tools">
                    {{ message.toolUses.length }} tools
                  </span>
                  <span class="expand-icon">{{ expandedMessageId === message.uuid ? '▼' : '▶' }}</span>
                </div>

                <div class="message-preview">
                  {{ getPreview(message) }}
                </div>

                <!-- Expanded Content -->
                <div v-if="expandedMessageId === message.uuid" class="message-expanded">
                  <div v-for="(block, idx) in message.content" :key="idx" class="content-block">
                    <div v-if="block.type === 'text'" class="text-block">
                      <div class="text-content">{{ formatTextContent(block.text) }}</div>
                    </div>
                    <div v-else-if="block.type === 'tool_use'" class="tool-use-block">
                      <div class="tool-header">🔧 Tool: {{ block.name }}</div>
                      <div v-if="block.input" class="tool-input">{{ JSON.stringify(block.input, null, 2) }}</div>
                    </div>
                    <div v-else-if="block.type === 'tool_result'" class="tool-result-block">
                      <div class="tool-header">📋 Result</div>
                      <div class="tool-result">{{ formatTextContent(typeof block.content === 'string' ? block.content.substring(0, 1000) : JSON.stringify(block.content, null, 2)) }}</div>
                    </div>
                    <div v-else class="unknown-block">
                      <div class="unknown-content">{{ JSON.stringify(block, null, 2) }}</div>
                    </div>
                  </div>

                  <div v-if="message.filesReferenced.length > 0" class="files-referenced">
                    <div class="files-header">📁 Files Referenced:</div>
                    <div class="files-list">
                      <span v-for="file in message.filesReferenced" :key="file" class="file-tag">{{ file }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Files Tab -->
      <div v-if="activeTab === 'files'" class="tab-content">
        <FileTracker :files="sessionData.files" />
      </div>

      <!-- Sanitize Tab -->
      <div v-if="activeTab === 'sanitize'" class="tab-content">
        <SanitizationPanel
          :sessionId="session.sessionId"
          :projectId="session.projectId"
          :sessionData="sessionData"
          @sanitized="handleSanitized"
        />
      </div>

      <!-- Tokens Tab -->
      <div v-if="activeTab === 'tokens'" class="tab-content">
        <TokenCalculator
          :tokens="sessionData.tokens"
          :subagents="sessionData.subagents"
          :sessionData="sessionData"
        />
      </div>

      <!-- Backups Tab -->
      <div v-if="activeTab === 'backups'" class="tab-content">
        <BackupManager
          :sessionId="session.sessionId"
          :projectId="session.projectId"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useSelectionStore } from '../stores/selection.js';
import { getSession } from '../utils/api.js';
import FileTracker from './FileTracker.vue';
import SanitizationPanel from './SanitizationPanel.vue';
import TokenCalculator from './TokenCalculator.vue';
import BackupManager from './BackupManager.vue';

const props = defineProps({
  session: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['close']);

const selectionStore = useSelectionStore();
const activeTab = ref('messages');
const sessionData = ref(null);
const loading = ref(true);
const error = ref(null);
const expandedMessageId = ref(null);

const selectedCount = computed(() => selectionStore.selectedMessageCount);

onMounted(async () => {
  await loadSession();
});

async function loadSession() {
  loading.value = true;
  error.value = null;

  try {
    sessionData.value = await getSession(props.session.sessionId, props.session.projectId);
    selectionStore.setAllMessages(sessionData.value.messages);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function retry() {
  loadSession();
}

function selectAllMessages() {
  selectionStore.selectAllMessages();
}

function clearAllMessages() {
  selectionStore.clearMessages();
}

function getPreview(message) {
  try {
    // Ensure content is an array
    const content = Array.isArray(message.content) ? message.content : [];

    if (content.length === 0 && (!message.toolUses || message.toolUses.length === 0)) {
      return 'Empty message';
    }

    // Find text content
    const textContent = content.find(c => c && c.type === 'text');
    if (textContent && textContent.text) {
      const text = String(textContent.text).substring(0, 150);
      return text + (textContent.text.length > 150 ? '...' : '');
    }

    // Fall back to tool use
    if (message.toolUses && message.toolUses.length > 0) {
      const toolName = message.toolUses[0].name || 'unknown';
      return `Called ${toolName} tool`;
    }

    // Fallback
    return 'No preview available';
  } catch (error) {
    console.error('Error generating preview:', error);
    return 'Error generating preview';
  }
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTextContent(text) {
  if (!text) return '';

  // Convert escape sequences to actual formatting
  let formatted = String(text)
    .replace(/\\n/g, '\n')           // Convert \n to newlines
    .replace(/\\t/g, '\t')           // Convert \t to tabs
    .replace(/\\r/g, '\r')           // Convert \r to carriage returns
    .replace(/\\\\/g, '\\');         // Convert \\ to single \

  return formatted;
}

function handleSanitized(result) {
  // Show success message and maybe reload
  console.log('Sanitization applied:', result);
  // Could trigger reload or update UI
}
</script>

<style scoped>
.session-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.editor-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
  border-bottom: 1px solid #e0e0e0;
  background-color: #f9f9f9;
  flex-wrap: wrap;
}

.back-btn {
  padding: 0.5rem 1rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  white-space: nowrap;
}

.back-btn:hover {
  background: #764ba2;
}

.session-info {
  flex: 1;
  min-width: 200px;
}

.session-info h2 {
  margin: 0;
  font-size: 1.25rem;
  color: #333;
  word-break: break-all;
}

.meta {
  font-size: 0.85rem;
  color: #999;
  margin-top: 0.25rem;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.tab-btn {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  border-color: #667eea;
  color: #667eea;
}

.tab-btn.active {
  background: #667eea;
  color: white;
  border-color: #667eea;
}

.loading-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f0f0f0;
  border-top: 4px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-container p {
  color: #d32f2f;
  text-align: center;
}

.error-container button {
  padding: 0.5rem 1rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.editor-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.tab-content {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.messages-section {
  max-width: 1000px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e0e0e0;
}

.section-header h3 {
  margin: 0;
  color: #333;
}

.controls {
  display: flex;
  align-items: center;
  gap: 1rem;
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

.selected-count {
  font-size: 0.9rem;
  color: #666;
}

.messages-container {
  display: grid;
  gap: 0.75rem;
}

.message-card {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.message-card:hover {
  border-color: #667eea;
  background-color: #f0f4ff;
}

.message-card.selected {
  border-color: #667eea;
  background-color: #e8eaf6;
}

.message-checkbox {
  display: flex;
  align-items: flex-start;
  padding-top: 0.25rem;
}

.message-checkbox input {
  cursor: pointer;
  margin-top: 0.2rem;
}

.message-body {
  flex: 1;
}

.message-header {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.5rem;
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

.message-tools {
  background-color: #fff3e0;
  color: #e65100;
  padding: 0.2rem 0.4rem;
  border-radius: 2px;
  font-size: 0.75rem;
}

.message-preview {
  font-size: 0.9rem;
  color: #666;
  line-height: 1.4;
  word-break: break-word;
  cursor: pointer;
}

.expand-icon {
  margin-left: auto;
  font-size: 0.8rem;
  color: #999;
  user-select: none;
}

.message-card.expanded {
  border-color: #667eea;
  background-color: white;
}

.message-expanded {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #e0e0e0;
  display: grid;
  gap: 0.75rem;
}

.content-block {
  padding: 0.75rem;
  background-color: #f5f5f5;
  border-left: 3px solid #ddd;
  border-radius: 3px;
  font-size: 0.85rem;
}

.text-block {
  border-left-color: #667eea;
  color: #333;
  line-height: 1.6;
}

.text-content {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
  line-height: 1.6;
  font-size: 0.9rem;
}

.tool-use-block {
  border-left-color: #ff9800;
  background-color: #fffbe6;
}

.tool-result-block {
  border-left-color: #4caf50;
  background-color: #f1f8e9;
}

.unknown-block {
  border-left-color: #999;
  background-color: #fafafa;
}

.tool-header {
  font-weight: 600;
  color: #333;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.tool-input,
.tool-result,
.unknown-content {
  margin: 0;
  padding: 0.5rem;
  background: white;
  border-radius: 3px;
  font-size: 0.8rem;
  line-height: 1.4;
  color: #333;
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.files-referenced {
  padding: 0.75rem;
  background-color: #f0f4ff;
  border-left: 3px solid #667eea;
  border-radius: 3px;
  margin-top: 0.5rem;
}

.files-header {
  font-weight: 600;
  color: #333;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.files-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.file-tag {
  background-color: #e8eaf6;
  color: #667eea;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.8rem;
  border: 1px solid #667eea;
}
</style>
