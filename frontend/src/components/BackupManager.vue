<template>
  <div class="backup-manager">
    <div class="manager-header">
      <h3>Backup Management</h3>
      <button @click="loadBackups" class="btn-refresh">Refresh</button>
    </div>

    <div v-if="loading" class="loading">Loading backups...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="backups.length === 0" class="empty">
      No backups yet. Backups are created when you apply sanitization.
    </div>

    <div v-else class="backups-list">
      <div class="backup-actions">
        <button @click="createManualBackup" class="btn-save">💾 Create Manual Backup</button>
      </div>

      <div class="backups-grid">
        <div
          v-for="backup in backups"
          :key="backup.version"
          class="backup-card"
        >
          <div class="backup-header">
            <span class="version">v{{ backup.version }}</span>
            <span class="timestamp">{{ formatDate(backup.timestamp) }}</span>
          </div>

          <div class="backup-details">
            <div class="detail-row">
              <span class="label">Messages:</span>
              <span class="value">{{ backup.messageCount }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Size:</span>
              <span class="value">{{ formatSize(backup.size) }}</span>
            </div>
            <div v-if="backup.description" class="detail-row">
              <span class="label">Description:</span>
              <span class="value">{{ backup.description }}</span>
            </div>
          </div>

          <div class="backup-actions">
            <button @click="restoreBackup(backup.version)" class="btn-action btn-restore">
              Restore
            </button>
            <button @click="exportBackup(backup.version)" class="btn-action btn-export">
              Export
            </button>
            <button @click="verifyBackup(backup.version)" class="btn-action btn-verify">
              Verify
            </button>
            <button @click="deleteBackup(backup.version)" class="btn-action btn-delete">
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Verification Result Modal -->
    <div v-if="verificationResult" class="modal-overlay" @click="verificationResult = null">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h4>Backup Verification</h4>
          <button @click="verificationResult = null" class="close-btn">×</button>
        </div>

        <div class="modal-body">
          <div :class="{ 'valid': verificationResult.valid, 'invalid': !verificationResult.valid }">
            {{ verificationResult.valid ? '✓ Valid' : '✗ Invalid' }}
          </div>
          <p>Messages: {{ verificationResult.messageCount }}</p>

          <div v-if="verificationResult.errors.length > 0">
            <h5>Errors:</h5>
            <ul>
              <li v-for="(error, idx) in verificationResult.errors" :key="idx">
                {{ error }}
              </li>
            </ul>
          </div>

          <div v-if="verificationResult.warnings.length > 0">
            <h5>Warnings:</h5>
            <ul>
              <li v-for="(warning, idx) in verificationResult.warnings" :key="idx">
                {{ warning }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { exportBackupToMarkdown } from '../utils/api.js';

const props = defineProps({
  sessionId: String,
  projectId: String
});

const backups = ref([]);
const loading = ref(true);
const error = ref(null);
const verificationResult = ref(null);

onMounted(() => {
  loadBackups();
});

async function loadBackups() {
  loading.value = true;
  error.value = null;

  try {
    const response = await fetch(
      `/api/backup/${props.sessionId}/versions?projectId=${props.projectId}`
    );
    if (!response.ok) throw new Error('Failed to load backups');
    const data = await response.json();
    backups.value = data.versions || [];
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function createManualBackup() {
  try {
    const description = prompt('Backup description (optional):');
    // TODO: Implement manual backup creation
    alert('Manual backup creation not yet implemented');
  } catch (err) {
    error.value = err.message;
  }
}

async function restoreBackup(version) {
  if (!confirm(`Restore backup v${version}? This will overwrite the current session.`)) {
    return;
  }

  try {
    const response = await fetch(
      `/api/backup/${props.sessionId}/restore/${version}?projectId=${props.projectId}`,
      { method: 'POST' }
    );
    if (!response.ok) throw new Error('Failed to restore backup');
    alert('Backup restored successfully');
    await loadBackups();
  } catch (err) {
    error.value = err.message;
  }
}

async function verifyBackup(version) {
  try {
    const response = await fetch(
      `/api/backup/${props.sessionId}/verify/${version}?projectId=${props.projectId}`
    );
    if (!response.ok) throw new Error('Failed to verify backup');
    verificationResult.value = await response.json();
  } catch (err) {
    error.value = err.message;
  }
}

async function deleteBackup(version) {
  if (!confirm(`Delete backup v${version}?`)) {
    return;
  }

  try {
    const response = await fetch(
      `/api/backup/${props.sessionId}/versions/${version}?projectId=${props.projectId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) throw new Error('Failed to delete backup');
    await loadBackups();
  } catch (err) {
    error.value = err.message;
  }
}

async function exportBackup(version) {
  try {
    const result = await exportBackupToMarkdown(props.sessionId, props.projectId, version);
    downloadContent(result.content, result.filename);
  } catch (err) {
    error.value = err.message;
  }
}

function downloadContent(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
</script>

<style scoped>
.backup-manager {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.manager-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e0e0e0;
}

.manager-header h3 {
  margin: 0;
  color: #333;
}

.btn-refresh {
  padding: 0.5rem 1rem;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-refresh:hover {
  background: #e0e0e0;
}

.loading,
.error,
.empty {
  text-align: center;
  padding: 2rem;
  color: #999;
}

.error {
  color: #d32f2f;
  background-color: #ffebee;
  border-radius: 4px;
}

.backup-actions {
  margin-bottom: 1rem;
}

.btn-save {
  padding: 0.75rem 1.5rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-save:hover {
  background: #388e3c;
}

.backups-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.backup-card {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 1rem;
  background-color: #f9f9f9;
  transition: all 0.2s ease;
}

.backup-card:hover {
  border-color: #667eea;
  background-color: #f0f4ff;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.backup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #e0e0e0;
}

.version {
  font-weight: 600;
  color: #333;
}

.timestamp {
  font-size: 0.85rem;
  color: #999;
}

.backup-details {
  margin-bottom: 1rem;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  padding: 0.5rem 0;
}

.detail-row .label {
  color: #666;
  font-weight: 500;
}

.detail-row .value {
  color: #333;
  font-family: monospace;
}

.btn-action {
  padding: 0.5rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.85rem;
  margin-right: 0.5rem;
  margin-bottom: 0.5rem;
  background: white;
  transition: all 0.2s ease;
}

.btn-restore {
  color: #4caf50;
  border-color: #4caf50;
}

.btn-restore:hover {
  background: #e8f5e9;
}

.btn-verify {
  color: #2196f3;
  border-color: #2196f3;
}

.btn-verify:hover {
  background: #e3f2fd;
}

.btn-export {
  color: #667eea;
  border-color: #667eea;
}

.btn-export:hover {
  background: #f0f4ff;
}

.btn-delete {
  color: #d32f2f;
  border-color: #d32f2f;
}

.btn-delete:hover {
  background: #ffebee;
}

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
}

.modal-content {
  background: white;
  border-radius: 8px;
  max-width: 500px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid #e0e0e0;
}

.modal-header h4 {
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #999;
}

.modal-body {
  padding: 1.5rem;
}

.valid {
  color: #2e7d32;
  font-weight: 600;
  margin-bottom: 1rem;
}

.invalid {
  color: #d32f2f;
  font-weight: 600;
  margin-bottom: 1rem;
}

.modal-body ul {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.modal-body li {
  margin: 0.25rem 0;
  font-size: 0.9rem;
}
</style>
