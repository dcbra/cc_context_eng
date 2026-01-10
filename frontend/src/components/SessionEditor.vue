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
              <div v-if="selectedCount > 0" class="action-menu">
                <button @click="deleteSelectedMessages" class="btn-danger-small">Delete Selected</button>
              </div>
            </div>
          </div>

          <div class="messages-container">
            <div
              v-for="(message, index) in sessionData.messages"
              :key="message.uuid"
              class="message-card"
              :class="{
                selected: selectionStore.selectedMessages.has(message.uuid),
                expanded: expandedMessageId === message.uuid,
                'is-user-input': getMessageSource(message) === 'user',
                'is-system': getMessageSource(message) === 'system' || getMessageSource(message) === 'agent',
                'is-duplicate': isDuplicate(message.uuid)
              }"
            >
              <div class="message-checkbox">
                <input
                  type="checkbox"
                  :checked="selectionStore.selectedMessages.has(message.uuid)"
                  @click="handleMessageSelection($event, message.uuid, index)"
                />
              </div>

              <div class="message-body">
                <div class="message-header" @click="expandedMessageId = expandedMessageId === message.uuid ? null : message.uuid">
                  <span class="message-type" :class="getMessageTypeClass(message)">{{ getMessageTypeLabel(message) }}</span>
                  <span class="message-time">{{ formatTime(message.timestamp) }}</span>
                  <span class="message-tokens">{{ message.tokens.total }} tokens</span>
                  <span v-if="message.toolUses.length > 0" class="message-tools">
                    {{ message.toolUses.length }} tools
                  </span>
                  <span class="expand-icon">{{ expandedMessageId === message.uuid ? '▼' : '▶' }}</span>
                </div>

                <div v-if="expandedMessageId !== message.uuid" class="message-preview">
                  {{ getPreview(message) }}
                </div>

                <!-- Expanded Content -->
                <div v-if="expandedMessageId === message.uuid" class="message-expanded">
                  <div v-for="(block, idx) in getDisplayableContentBlocks(message.content)" :key="idx" class="content-block">
                    <div v-if="block.type === 'text'" class="text-block">
                      <div class="text-content" v-text="formatTextContent(block.text)"></div>
                    </div>
                    <div v-else-if="block.type === 'thinking'" class="thinking-block">
                      <div class="thinking-content" v-text="formatTextContent(block.thinking)"></div>
                    </div>
                    <div v-else-if="block.type === 'tool_use'" class="tool-use-block">
                      <div class="tool-name">{{ block.name }}</div>
                      <div v-if="block.input" class="tool-input">{{ JSON.stringify(block.input, null, 2) }}</div>
                    </div>
                    <div v-else-if="block.type === 'tool_result'" class="tool-result-block">
                      <div class="tool-header">📋 Result</div>
                      <div class="tool-result" v-text="formatTextContent(typeof block.content === 'string' ? block.content.substring(0, 1000) : JSON.stringify(block.content, null, 2))"></div>
                    </div>
                    <div v-else-if="block.type === 'image'" class="image-block">
                      <img
                        :src="getImageSrc(block)"
                        class="image-preview"
                        @click="expandedImage = getImageSrc(block)"
                        title="Click to expand"
                      />
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
        <FileTracker
          :key="sessionData.files?.length || 0"
          :files="sessionData.files"
          :sessionId="session.sessionId"
          :projectId="session.projectId"
          @files-updated="handleFilesUpdated"
        />
      </div>

      <!-- Sanitize Tab -->
      <div v-if="activeTab === 'sanitize'" class="tab-content">
        <SanitizationPanel
          :sessionId="session.sessionId"
          :projectId="session.projectId"
          :sessionData="sessionData"
          @sanitized="handleSanitized"
          @duplicatesFound="handleDuplicatesFound"
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

    <!-- Image Modal -->
    <div v-if="expandedImage" class="image-modal" @click="expandedImage = null">
      <div class="image-modal-content" @click.stop>
        <button class="image-modal-close" @click="expandedImage = null">&times;</button>
        <img :src="expandedImage" class="image-full" />
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
const lastSelectedIndex = ref(null);
const expandedImage = ref(null);
const duplicateUuidsMap = ref({}); // Track duplicate message UUIDs for highlighting (object for reactivity)

// Check if a message is a duplicate
function isDuplicate(uuid) {
  return !!duplicateUuidsMap.value[uuid];
}

const selectedCount = computed(() => selectionStore.selectedMessageCount);

onMounted(async () => {
  await loadSession();
});

async function loadSession() {
  loading.value = true;
  error.value = null;

  try {
    const newSessionData = await getSession(props.session.sessionId, props.session.projectId);
    console.log('Loaded session data:', {
      messages: newSessionData.messages?.length,
      files: newSessionData.files?.length
    });
    sessionData.value = newSessionData;
    selectionStore.setAllMessages(newSessionData.messages);
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

function handleMessageSelection(event, uuid, currentIndex) {
  event.stopPropagation();

  if (event.shiftKey && lastSelectedIndex.value !== null) {
    // Shift+click: prevent default and select range
    event.preventDefault();

    const start = Math.min(lastSelectedIndex.value, currentIndex);
    const end = Math.max(lastSelectedIndex.value, currentIndex);

    const rangeUuids = [];
    for (let i = start; i <= end; i++) {
      rangeUuids.push(sessionData.value.messages[i].uuid);
    }
    selectionStore.selectMessageRange(rangeUuids);
  } else {
    // Regular click: toggle single message (checkbox handles its own state change)
    selectionStore.toggleMessage(uuid);
  }

  lastSelectedIndex.value = currentIndex;
}

async function deleteSelectedMessages() {
  if (selectedCount.value === 0) return;

  if (!confirm(`Delete ${selectedCount.value} selected message(s)?`)) {
    return;
  }

  try {
    loading.value = true;
    const response = await fetch(
      `/api/sanitize/${props.session.sessionId}?projectId=${props.session.projectId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          removeMessages: Array.from(selectionStore.selectedMessages),
          removeFiles: [],
          criteria: {}
        })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to delete messages');
    }

    await loadSession();
    selectionStore.clearMessages();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function getDisplayableContentBlocks(content) {
  if (!Array.isArray(content)) return [];

  // Filter out signature blocks, only show displayable block types
  const displayableTypes = ['text', 'thinking', 'tool_use', 'tool_result', 'image'];
  return content.filter(block => block && displayableTypes.includes(block.type));
}

function getImageSrc(block) {
  // Handle base64 encoded images
  if (block.source?.type === 'base64') {
    const mediaType = block.source.media_type || 'image/png';
    return `data:${mediaType};base64,${block.source.data}`;
  }
  // Handle URL images
  if (block.source?.type === 'url') {
    return block.source.url;
  }
  // Fallback
  return '';
}

function getMessageSource(message) {
  // Determine the actual source of the message
  // 'user' = actual user input
  // 'assistant' = Claude's response
  // 'system' = system/meta message (from hooks, commands, etc)
  // 'agent' = from spawned agent
  // 'tool-result' = tool execution result

  if (message.type === 'assistant') {
    return 'assistant';
  }

  if (message.type === 'user') {
    // Check if it's a tool result message first
    const content = Array.isArray(message.content) ? message.content : [];

    // 1. Standard Claude API format: tool_result content blocks
    if (content.some(c => c && c.type === 'tool_result')) {
      return 'tool-result';
    }

    // 2. Converted tool_result blocks (after tool_use deletion)
    if (content.some(c => c && c.type === 'text' && c.converted_from === 'tool_result')) {
      return 'tool-result';
    }

    // 3. Claude Code format: toolUseResult field at message level
    if (message.raw?.toolUseResult != null) {
      return 'tool-result';
    }

    // Check if it's from an agent
    if (message.agentId) {
      return 'agent';
    }

    // Check for isMeta flag - these are system/framework messages
    if (message.raw?.isMeta === true) {
      return 'system';
    }

    // Array content = real user message (includes text, images, files, etc.)
    const originalContent = message.raw?.message?.content;
    if (Array.isArray(originalContent)) {
      // Images and other media are always user messages
      if (originalContent.some(c => c && (c.type === 'image' || c.type === 'file'))) {
        return 'user';
      }
      return 'user';
    }

    // Check string content for system patterns (commands, caveats, hooks)
    if (typeof originalContent === 'string') {
      // Check for known system message patterns
      if (
        originalContent.includes('<command-name>') ||
        originalContent.includes('<local-command-') ||
        originalContent.includes('<system-reminder>') ||
        originalContent.includes('<user-prompt-submit-hook>') ||
        originalContent.startsWith('Caveat:')
      ) {
        return 'system';
      }
      // String content without system patterns = real user message
      return 'user';
    }

    // Default to user if we can't determine
    return 'user';
  }

  return message.type;
}

function getMessageTypeLabel(message) {
  const source = getMessageSource(message);

  // Tool result has its own label
  if (source === 'tool-result') {
    return 'tool result';
  }

  // For user input or assistant, check for special content types
  if (source === 'user' || source === 'assistant') {
    const content = Array.isArray(message.content) ? message.content : [];
    if (content.some(c => c && c.type === 'thinking')) {
      return 'thinking';
    }
    if (message.toolUses && message.toolUses.length > 0) {
      return 'tool';
    }
    // Check for converted tool_use blocks
    if (content.some(c => c && c.type === 'text' && c.converted_from === 'tool_use')) {
      return 'tool';
    }
  }

  // Return source-based label
  if (source === 'user') return 'you';
  if (source === 'system') return 'system';
  if (source === 'agent') return 'agent';
  if (source === 'assistant') return 'assistant';

  return message.type;
}

function getMessageTypeClass(message) {
  const source = getMessageSource(message);

  // Tool result has its own class
  if (source === 'tool-result') {
    return 'tool-result';
  }

  // Check for special content types first (thinking and tool blocks take priority)
  if (source === 'user' || source === 'assistant') {
    const content = Array.isArray(message.content) ? message.content : [];
    if (content.some(c => c && c.type === 'thinking')) {
      return 'thinking';
    }
    if (message.toolUses && message.toolUses.length > 0) {
      return 'tool';
    }
    // Check for converted tool_use blocks
    if (content.some(c => c && c.type === 'text' && c.converted_from === 'tool_use')) {
      return 'tool';
    }
  }

  // Return source-based class
  if (source === 'user') return 'you';
  if (source === 'system') return 'system';
  if (source === 'agent') return 'agent';
  if (source === 'assistant') return 'assistant';

  return message.type;
}

function getPreview(message) {
  try {
    // Ensure content is an array
    const content = Array.isArray(message.content) ? message.content : [];

    if (content.length === 0 && (!message.toolUses || message.toolUses.length === 0)) {
      return 'Empty message';
    }

    // Check for thinking block first
    const thinkingBlock = content.find(c => c && c.type === 'thinking');
    if (thinkingBlock && thinkingBlock.thinking) {
      const text = String(thinkingBlock.thinking).substring(0, 150);
      return text + (thinkingBlock.thinking.length > 150 ? '...' : '');
    }

    // Check for tool_use blocks
    const toolUseBlock = content.find(c => c && c.type === 'tool_use');
    if (toolUseBlock && toolUseBlock.name) {
      return `Calling: ${toolUseBlock.name}`;
    }

    // Find text content
    const textContent = content.find(c => c && c.type === 'text');
    if (textContent && textContent.text) {
      const text = String(textContent.text).substring(0, 150);
      return text + (textContent.text.length > 150 ? '...' : '');
    }

    // Fall back to message.toolUses
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

  // Convert to string
  let str = String(text);

  // Replace escape sequences in the correct order
  // First handle double backslashes to avoid re-processing
  // Then handle escape sequences
  let formatted = str
    // Handle escaped backslashes FIRST (before handling other escapes)
    .replace(/\\\\/g, '\x00')        // Temporarily replace \\\\ with placeholder
    // Now handle other escape sequences
    .replace(/\\n/g, '\n')            // Convert \n to newline
    .replace(/\\t/g, '\t')            // Convert \t to tab
    .replace(/\\r/g, '\r')            // Convert \r to carriage return
    .replace(/\\"/g, '"')             // Convert \" to "
    .replace(/\\'/g, "'")             // Convert \' to '
    .replace(/\\b/g, '\b')            // Convert \b to backspace
    .replace(/\\f/g, '\f')            // Convert \f to form feed
    .replace(/\\v/g, '\v')            // Convert \v to vertical tab
    // Finally restore the escaped backslashes
    .replace(/\x00/g, '\\');          // Restore \\\\ as \\

  return formatted;
}

function handleSanitized(result) {
  // Show success message and reload
  console.log('Sanitization applied:', result);
  // Clear duplicate highlighting when session is modified
  duplicateUuidsMap.value = {};
  loadSession();
}

function handleDuplicatesFound(uuids) {
  // Store duplicate UUIDs for highlighting (convert array to object for reactivity)
  console.log('Duplicates found:', uuids.length, uuids);
  const map = {};
  for (const uuid of uuids) {
    map[uuid] = true;
  }
  duplicateUuidsMap.value = map;
}

async function handleFilesUpdated() {
  // Reload session data after file operations
  console.log('Files updated, reloading session...');
  await loadSession();
  console.log('Session reloaded after file update');
}
</script>

<style scoped>
.session-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
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
  width: 100%;
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
  width: 100%;
  max-width: 100%;
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

.action-menu {
  display: flex;
  gap: 0.5rem;
}

.btn-danger-small {
  padding: 0.4rem 0.8rem;
  background: #d32f2f;
  color: white;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.8rem;
}

.btn-danger-small:hover {
  background: #b71c1c;
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
  position: relative;
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  transition: all 0.2s ease;
  cursor: pointer;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
}

.message-card:hover {
  border-color: #667eea;
  background-color: #f0f4ff;
}

.message-card.selected {
  border-color: #667eea;
  background-color: #e8eaf6;
}

.message-card.is-duplicate {
  border-color: #ed8936;
  background-color: #fffaf0;
  box-shadow: 0 0 0 2px rgba(237, 137, 54, 0.3);
}

.message-card.is-duplicate::before {
  content: 'DUPLICATE';
  position: absolute;
  top: 0;
  right: 0;
  background: #ed8936;
  color: white;
  font-size: 0.65rem;
  font-weight: 600;
  padding: 0.125rem 0.5rem;
  border-radius: 0 4px 0 4px;
}

/* Duplicate + user-input combined - keep duplicate highlight with green left border */
.message-card.is-duplicate.is-user-input {
  border-color: #ed8936;
  border-left: 4px solid #4caf50;
  background-color: #fff3e0;
  box-shadow: 0 0 0 2px rgba(237, 137, 54, 0.3);
}

.message-card.is-user-input {
  border-left: 4px solid #4caf50;
  background-color: #f1f8e9;
}

.message-card.is-user-input:hover {
  background-color: #e8f5e9;
  border-left-color: #388e3c;
}

.message-card.is-user-input.selected {
  background-color: #dcedc8;
  border-left-color: #2e7d32;
}

.message-card.is-system {
  opacity: 0.85;
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
  min-width: 0;
  width: 100%;
}

.message-header {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.25rem 0;
  user-select: none;
  transition: background-color 0.2s ease;
}

.message-header:hover {
  background-color: rgba(102, 126, 234, 0.1);
  border-radius: 3px;
  padding: 0.25rem 0.5rem;
  margin-left: -0.5rem;
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

.message-type.thinking {
  background-color: #e1bee7;
  color: #6a1b9a;
}

.message-type.tool {
  background-color: #ffe0b2;
  color: #e65100;
}

.message-type.you {
  background-color: #c8e6c9;
  color: #1b5e20;
  font-weight: 700;
}

.message-type.system {
  background-color: #f3e5f5;
  color: #6a1b9a;
}

.message-type.agent {
  background-color: #e0e0e0;
  color: #424242;
}

.message-type.tool-result {
  background-color: #e65100;
  color: #ffe0b2;
  padding: 0.2rem 0.4rem;
  border-radius: 2px;
  font-size: 0.75rem;
  font-weight: 600;
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
  user-select: text;
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
  max-height: 800px;
  overflow-y: auto;
  padding-right: 0.5rem;
  min-height: 300px;
}

.message-expanded::-webkit-scrollbar {
  width: 8px;
}

.message-expanded::-webkit-scrollbar-track {
  background: #f0f0f0;
  border-radius: 4px;
}

.message-expanded::-webkit-scrollbar-thumb {
  background: #999;
  border-radius: 4px;
}

.message-expanded::-webkit-scrollbar-thumb:hover {
  background: #666;
}

.content-block {
  padding: 0.75rem;
  background-color: #f5f5f5;
  border-left: 3px solid #ddd;
  border-radius: 3px;
  font-size: 0.85rem;
  min-width: 0;
  width: 100%;
  user-select: text;
}

.text-block {
  border-left-color: #667eea;
  color: #333;
  line-height: 1.6;
}

.text-content {
  margin: 0;
  padding: 0;
  /* Preserve whitespace and formatting */
  white-space: pre-wrap;           /* Preserve spaces, tabs, newlines */
  word-wrap: break-word;            /* Break long words */
  word-break: break-word;           /* Break words to prevent overflow */
  overflow-wrap: break-word;        /* Alternative for word-wrap */
  line-height: 1.6;
  font-size: 0.9rem;
  width: 100%;
  box-sizing: border-box;
  /* Ensure text is rendered */
  display: block;
  white-space: pre-wrap !important; /* Force preserve whitespace */
}

.thinking-block {
  border-left-color: #9c27b0;
  background-color: #f3e5f5;
}

.thinking-header {
  font-weight: 600;
  color: #6a1b9a;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.thinking-content {
  margin: 0;
  padding: 0.5rem;
  background: white;
  border-radius: 3px;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #333;
  white-space: pre-wrap !important;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
  width: 100%;
  box-sizing: border-box;
  display: block;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.tool-use-block {
  border-left-color: #ff9800;
  background-color: #fffbe6;
}

.tool-name {
  font-weight: 600;
  color: #e65100;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.tool-result-block {
  border-left-color: #4caf50;
  background-color: #f1f8e9;
}

.unknown-block {
  border-left-color: #999;
  background-color: #fafafa;
}

.image-block {
  padding: 0.5rem;
  background-color: #f5f5f5;
  border-radius: 4px;
}

.image-preview {
  max-width: 200px;
  max-height: 150px;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  border: 1px solid #ddd;
}

.image-preview:hover {
  transform: scale(1.02);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* Image Modal */
.image-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.image-modal-content {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
}

.image-modal-close {
  position: absolute;
  top: -40px;
  right: 0;
  background: none;
  border: none;
  color: white;
  font-size: 2rem;
  cursor: pointer;
  padding: 0.5rem;
  line-height: 1;
}

.image-modal-close:hover {
  color: #ff5555;
}

.image-full {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
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
  /* Preserve whitespace formatting */
  white-space: pre-wrap !important;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;  
  box-sizing: border-box;
  display: block;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
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
