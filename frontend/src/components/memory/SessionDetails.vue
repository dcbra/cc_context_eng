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
    </div>
  </div>
</template>

<script setup>
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
  'back'
]);

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
</style>
