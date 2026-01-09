<template>
  <div class="file-tracker">
    <div class="tracker-header">
      <h3>Files Read ({{ files.length }})</h3>
      <div class="actions">
        <button @click="selectAllFiles" class="btn-small">Select All</button>
        <button @click="clearAllFiles" class="btn-small">Clear</button>
      </div>
    </div>

    <div class="files-grid">
      <div v-if="files.length === 0" class="empty">No files read in this session</div>

      <div v-for="file in files" :key="file.path" class="file-card">
        <div class="file-header">
          <input
            type="checkbox"
            :checked="selectionStore.selectedFiles.has(file.path)"
            @change="selectionStore.toggleFile(file.path)"
          />
          <div class="file-name">{{ file.path.split('/').pop() }}</div>
        </div>

        <div class="file-details">
          <div class="detail-row">
            <span class="label">Path:</span>
            <span class="value" :title="file.path">{{ file.path }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Read Count:</span>
            <span class="value">{{ file.readCount }} times</span>
          </div>
          <div class="detail-row">
            <span class="label">Content Size:</span>
            <span class="value">{{ formatSize(file.totalContentSize) }}</span>
          </div>
          <div class="detail-row">
            <span class="label">First Read:</span>
            <span class="value">{{ formatTime(file.firstReadTimestamp) }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Last Read:</span>
            <span class="value">{{ formatTime(file.lastReadTimestamp) }}</span>
          </div>
        </div>

        <div class="file-actions">
          <select @change="handleFileOption" class="option-select">
            <option value="">-- Action --</option>
            <option :value="file.path">Remove All Instances</option>
            <option :value="'keep-first-' + file.path">Keep First Read Only</option>
            <option :value="'keep-last-' + file.path">Keep Last Read Only</option>
            <option :value="'remove-duplicates-' + file.path">Remove Duplicates</option>
          </select>
        </div>

        <div class="file-instances">
          <div class="instances-header">Instances ({{ file.instances.length }})</div>
          <div class="instances-list">
            <div v-for="(instance, idx) in file.instances" :key="idx" class="instance">
              <span class="instance-tool">{{ instance.toolName }}</span>
              <span class="instance-time">{{ formatTime(instance.timestamp) }}</span>
              <span class="instance-size">{{ formatSize(instance.contentSize) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineProps } from 'vue';
import { useSelectionStore } from '../stores/selection.js';

const props = defineProps({
  files: {
    type: Array,
    default: () => []
  }
});

const selectionStore = useSelectionStore();

function selectAllFiles() {
  selectionStore.selectAllFiles(props.files);
}

function clearAllFiles() {
  selectionStore.clearFiles();
}

function handleFileOption(event) {
  const value = event.target.value;
  // TODO: Implement keep-first, keep-last, remove-duplicates logic
  event.target.value = '';
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
</script>

<style scoped>
.file-tracker {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.tracker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e0e0e0;
}

.tracker-header h3 {
  margin: 0;
  color: #333;
}

.actions {
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

.files-grid {
  display: grid;
  gap: 1rem;
}

.empty {
  text-align: center;
  padding: 2rem;
  color: #999;
}

.file-card {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 1rem;
  background-color: #fafafa;
  transition: all 0.2s ease;
}

.file-card:hover {
  border-color: #667eea;
  background-color: #f0f4ff;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.file-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
  font-weight: 600;
  color: #333;
}

.file-name {
  flex: 1;
  font-family: monospace;
  word-break: break-all;
}

.file-details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

.detail-row {
  display: flex;
  flex-direction: column;
}

.detail-row .label {
  color: #999;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
}

.detail-row .value {
  color: #333;
  font-family: monospace;
  word-break: break-all;
}

.file-actions {
  margin-bottom: 1rem;
}

.option-select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: pointer;
}

.option-select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.file-instances {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 0.75rem;
}

.instances-header {
  font-weight: 600;
  font-size: 0.9rem;
  color: #333;
  margin-bottom: 0.5rem;
}

.instances-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.instance {
  display: flex;
  gap: 1rem;
  font-size: 0.85rem;
  padding: 0.5rem;
  background-color: #f5f5f5;
  border-radius: 3px;
}

.instance-tool {
  font-weight: 600;
  color: #667eea;
  min-width: 60px;
}

.instance-time {
  color: #999;
  flex: 1;
}

.instance-size {
  color: #666;
  text-align: right;
}
</style>
