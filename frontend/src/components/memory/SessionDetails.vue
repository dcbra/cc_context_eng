<template>
  <div class="session-details">
    <div class="details-header">
      <button @click="$emit('back')" class="btn-back" title="Back to sessions">
        &#8592; Back
      </button>
      <h3>{{ formatSessionId(session.sessionId) }}</h3>
      <div class="header-actions">
        <button @click="$emit('refresh')" class="btn-icon" title="Refresh">
          <RefreshIcon />
        </button>
      </div>
    </div>

    <!-- Metadata Section -->
    <div class="metadata-section">
      <div class="meta-row">
        <span class="label">Original:</span>
        <span class="value">
          <span class="highlight">{{ formatTokens(session.originalTokens) }}</span> tokens
          <span class="separator">|</span>
          <span class="highlight">{{ session.originalMessages || 0 }}</span> messages
        </span>
      </div>
      <div class="meta-row">
        <span class="label">First Activity:</span>
        <span class="value">{{ formatDate(session.firstTimestamp) }}</span>
      </div>
      <div class="meta-row">
        <span class="label">Last Activity:</span>
        <span class="value">{{ formatDate(session.lastTimestamp) }}</span>
      </div>
      <div class="meta-row">
        <span class="label">Registered:</span>
        <span class="value">{{ formatDate(session.registeredAt) }}</span>
      </div>
      <div v-if="session.tags && session.tags.length > 0" class="meta-row">
        <span class="label">Tags:</span>
        <div class="tags-list">
          <span v-for="tag in session.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>
    </div>

    <!-- Compressions Section -->
    <div class="compressions-section">
      <div class="section-header">
        <h4>Compressions ({{ versions.length }})</h4>
        <div class="section-actions">
          <button
            v-if="versions.length > 1"
            @click="$emit('compare-versions')"
            class="btn-secondary-small"
          >
            Compare
          </button>
          <button @click="$emit('create-version')" class="btn-primary-small">
            + Create
          </button>
        </div>
      </div>

      <div v-if="loading.versions" class="loading-inline">
        <span class="spinner-small"></span>
        Loading versions...
      </div>

      <VersionList
        v-else
        :versions="versions"
        @view="handleViewVersion"
        @delete="handleDeleteVersion"
      />
    </div>

    <!-- Keepit Markers Section -->
    <div class="keepits-section">
      <div class="section-header">
        <h4>Keepit Markers ({{ keepits.length }})</h4>
      </div>

      <div v-if="loading.keepits" class="loading-inline">
        <span class="spinner-small"></span>
        Loading keepits...
      </div>

      <KeepitListInline
        v-else-if="keepits.length > 0"
        :keepits="keepits"
      />

      <div v-else class="empty-keepits">
        <span>No keepit markers in this session</span>
        <p class="keepit-hint">
          Keepit markers are created during conversations to preserve important content
        </p>
      </div>
    </div>

    <!-- Actions Section -->
    <div class="actions-section">
      <button @click="$emit('view-original')" class="btn-secondary">
        View Original Session
      </button>
      <button @click="showUnregisterDialog = true" class="btn-danger">
        Unregister Session
      </button>
    </div>

    <!-- Unregister Confirmation Dialog -->
    <div v-if="showUnregisterDialog" class="modal-overlay" @click.self="showUnregisterDialog = false">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Unregister Session?</h3>
          <button @click="showUnregisterDialog = false" class="btn-close">&times;</button>
        </div>
        <div class="modal-body">
          <p>This will remove the session from memory storage:</p>
          <ul class="warning-list">
            <li>Session will no longer appear in the memory browser</li>
            <li>All compression versions will be removed</li>
            <li>The original session file in <code>~/.claude/</code> will <strong>NOT</strong> be deleted</li>
          </ul>
          <p class="warning-note">You can re-register this session later if needed.</p>
        </div>
        <div class="modal-footer">
          <button @click="showUnregisterDialog = false" class="btn-secondary">
            Cancel
          </button>
          <button @click="handleUnregister" class="btn-danger" :disabled="unregistering">
            {{ unregistering ? 'Unregistering...' : 'Unregister' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import VersionList from './VersionList.vue';
import KeepitListInline from './KeepitListInline.vue';
import RefreshIcon from './icons/RefreshIcon.vue';

const props = defineProps({
  session: {
    type: Object,
    required: true
  },
  versions: {
    type: Array,
    default: () => []
  },
  keepits: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits([
  'create-version',
  'view-version',
  'delete-version',
  'compare-versions',
  'view-original',
  'refresh',
  'back',
  'unregister'
]);

const showUnregisterDialog = ref(false);
const unregistering = ref(false);

function formatSessionId(sessionId) {
  if (!sessionId) return '';
  if (sessionId.length <= 16) return sessionId;
  return sessionId.substring(0, 8) + '...' + sessionId.substring(sessionId.length - 4);
}

function formatTokens(tokens) {
  if (!tokens) return '0';
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  }
  if (tokens >= 1000) {
    return Math.round(tokens / 1000) + 'K';
  }
  return tokens.toLocaleString();
}

function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function handleViewVersion(version) {
  emit('view-version', version);
}

function handleDeleteVersion(version) {
  emit('delete-version', version);
}

async function handleUnregister() {
  unregistering.value = true;
  try {
    await emit('unregister', props.session.sessionId);
    showUnregisterDialog.value = false;
  } catch (error) {
    console.error('Failed to unregister session:', error);
    alert('Failed to unregister session: ' + error.message);
  } finally {
    unregistering.value = false;
  }
}
</script>

<style scoped>
.session-details {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 1.5rem;
}

.details-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e0e0e0;
}

.details-header h3 {
  margin: 0;
  font-size: 1.25rem;
  color: #333;
  font-family: monospace;
  flex: 1;
}

.btn-back {
  padding: 0.375rem 0.75rem;
  background: #f0f0f0;
  color: #333;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s ease;
}

.btn-back:hover {
  background: #e0e0e0;
  border-color: #667eea;
  color: #667eea;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-icon:hover {
  background: #e0e0e0;
  border-color: #667eea;
}

.metadata-section {
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.meta-row {
  display: flex;
  padding: 0.5rem 0;
  border-bottom: 1px solid #eee;
}

.meta-row:last-child {
  border-bottom: none;
}

.meta-row .label {
  min-width: 120px;
  font-size: 0.85rem;
  color: #666;
  font-weight: 500;
}

.meta-row .value {
  flex: 1;
  font-size: 0.9rem;
  color: #333;
}

.meta-row .highlight {
  font-weight: 600;
  color: #667eea;
}

.meta-row .separator {
  margin: 0 0.5rem;
  color: #ccc;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tag {
  padding: 0.25rem 0.5rem;
  background: #e8eaf6;
  color: #667eea;
  border-radius: 3px;
  font-size: 0.8rem;
  font-weight: 500;
}

.compressions-section,
.keepits-section {
  margin-bottom: 1.5rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.section-header h4 {
  margin: 0;
  font-size: 1rem;
  color: #333;
}

.section-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-primary-small {
  padding: 0.375rem 0.75rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-primary-small:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
}

.btn-secondary-small {
  padding: 0.375rem 0.75rem;
  background: white;
  color: #667eea;
  border: 1px solid #667eea;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-secondary-small:hover {
  background: #f0f4ff;
}

.loading-inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  color: #666;
  font-size: 0.85rem;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid #f0f0f0;
  border-top: 2px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-keepits {
  text-align: center;
  padding: 1.5rem;
  background: #f9f9f9;
  border: 1px dashed #ddd;
  border-radius: 6px;
  color: #999;
}

.empty-keepits span {
  font-size: 0.9rem;
}

.keepit-hint {
  margin: 0.5rem 0 0 0;
  font-size: 0.8rem;
  color: #bbb;
}

.actions-section {
  margin-top: auto;
  padding-top: 1rem;
  border-top: 1px solid #e0e0e0;
}

.btn-secondary {
  width: 100%;
  padding: 0.75rem 1rem;
  background: white;
  color: #667eea;
  border: 1px solid #667eea;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: #f0f4ff;
}

.btn-danger {
  width: 100%;
  padding: 0.75rem 1rem;
  background: white;
  color: #dc2626;
  border: 1px solid #dc2626;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
  margin-top: 0.5rem;
}

.btn-danger:hover:not(:disabled) {
  background: #fef2f2;
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Modal styles */
.modal-overlay {
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

.modal-dialog {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  animation: slideIn 0.2s ease;
}

@keyframes slideIn {
  from {
    transform: translateY(-20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e0e0e0;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.125rem;
  color: #333;
}

.btn-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: #999;
  cursor: pointer;
  padding: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.btn-close:hover {
  background: #f0f0f0;
  color: #333;
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
}

.modal-body p {
  margin: 0 0 1rem 0;
  color: #333;
  font-size: 0.95rem;
  line-height: 1.5;
}

.warning-list {
  margin: 0 0 1rem 0;
  padding-left: 1.5rem;
  color: #555;
  font-size: 0.9rem;
}

.warning-list li {
  margin-bottom: 0.5rem;
}

.warning-list code {
  background: #f5f5f5;
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.85em;
}

.warning-note {
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 4px;
  padding: 0.75rem;
  color: #92400e;
  font-size: 0.85rem;
  margin: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e0e0e0;
}

.modal-footer .btn-secondary {
  width: auto;
  padding: 0.5rem 1rem;
  margin: 0;
}

.modal-footer .btn-danger {
  width: auto;
  padding: 0.5rem 1rem;
  background: #dc2626;
  color: white;
  border: none;
  margin: 0;
}

.modal-footer .btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}
</style>
