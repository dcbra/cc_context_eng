<template>
  <div class="export-panel">
    <div class="panel-header">
      <h3>Export Session</h3>
    </div>

    <!-- Export Current Session -->
    <div class="export-section">
      <h4>Export Current Session</h4>
      <p class="section-description">Export the current session to a downloadable format.</p>

      <div class="format-selector">
        <label>Format:</label>
        <select v-model="selectedFormat">
          <option value="markdown">Markdown (.md)</option>
          <option value="plain">Plain Text (.txt)</option>
          <option value="report">Analysis Report (.md)</option>
        </select>
      </div>

      <div class="content-toggle">
        <label class="toggle-label">
          <input type="checkbox" v-model="exportFull" />
          <span class="toggle-text">Full content</span>
          <span class="toggle-hint">(includes complete tool results without truncation)</span>
        </label>
      </div>

      <button
        @click="exportCurrentSession"
        :disabled="exporting"
        class="btn-export"
      >
        {{ exporting ? 'Exporting...' : 'Export Session' }}
      </button>
    </div>

    <!-- Load and Convert External File -->
    <div class="export-section">
      <h4>Convert External JSONL File</h4>
      <p class="section-description">Load a JSONL file from your computer and convert it to markdown.</p>

      <div class="file-upload">
        <input
          type="file"
          ref="fileInput"
          @change="handleFileSelect"
          accept=".jsonl"
          class="file-input"
        />
        <button @click="triggerFileSelect" class="btn-select-file">
          Select JSONL File
        </button>
        <span v-if="selectedFile" class="selected-file">
          {{ selectedFile.name }} ({{ formatSize(selectedFile.size) }})
        </span>
      </div>

      <div v-if="selectedFile" class="format-selector">
        <label>Format:</label>
        <select v-model="convertFormat">
          <option value="markdown">Markdown (.md)</option>
          <option value="plain">Plain Text (.txt)</option>
          <option value="report">Analysis Report (.md)</option>
        </select>
      </div>

      <div v-if="selectedFile" class="content-toggle">
        <label class="toggle-label">
          <input type="checkbox" v-model="convertFull" />
          <span class="toggle-text">Full content</span>
          <span class="toggle-hint">(includes complete tool results without truncation)</span>
        </label>
      </div>

      <button
        v-if="selectedFile"
        @click="convertFile"
        :disabled="converting"
        class="btn-export"
      >
        {{ converting ? 'Converting...' : 'Convert and Download' }}
      </button>
    </div>

    <!-- Export Result -->
    <div v-if="lastExport" class="export-result">
      <div class="result-header">
        <span class="success-icon">OK</span>
        <span>Export Successful</span>
      </div>
      <div class="result-details">
        <div class="detail-row">
          <span class="label">Filename:</span>
          <span class="value">{{ lastExport.filename }}</span>
        </div>
        <div class="detail-row">
          <span class="label">Messages:</span>
          <span class="value">{{ lastExport.stats.messageCount }}</span>
        </div>
        <div v-if="lastExport.stats.tokenCount" class="detail-row">
          <span class="label">Tokens:</span>
          <span class="value">{{ lastExport.stats.tokenCount.toLocaleString() }}</span>
        </div>
      </div>
    </div>

    <!-- Error Display -->
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { exportSessionToMarkdown, convertJsonlToMarkdown } from '../utils/api.js';

const props = defineProps({
  sessionId: String,
  projectId: String
});

const selectedFormat = ref('markdown');
const convertFormat = ref('markdown');
const exportFull = ref(false);
const convertFull = ref(false);
const exporting = ref(false);
const converting = ref(false);
const error = ref(null);
const lastExport = ref(null);
const selectedFile = ref(null);
const fileInput = ref(null);

function triggerFileSelect() {
  fileInput.value?.click();
}

function handleFileSelect(event) {
  const file = event.target.files?.[0];
  if (file) {
    selectedFile.value = file;
    error.value = null;
  }
}

async function exportCurrentSession() {
  exporting.value = true;
  error.value = null;
  lastExport.value = null;

  try {
    const result = await exportSessionToMarkdown(props.sessionId, props.projectId, selectedFormat.value, exportFull.value);
    lastExport.value = result;
    downloadContent(result.content, result.filename);
  } catch (err) {
    error.value = err.message;
  } finally {
    exporting.value = false;
  }
}

async function convertFile() {
  if (!selectedFile.value) return;

  converting.value = true;
  error.value = null;
  lastExport.value = null;

  try {
    const result = await convertJsonlToMarkdown(selectedFile.value, convertFormat.value, convertFull.value);
    lastExport.value = result;
    downloadContent(result.content, result.filename);
  } catch (err) {
    error.value = err.message;
  } finally {
    converting.value = false;
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

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
</script>

<style scoped>
.export-panel {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.panel-header {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e0e0e0;
}

.panel-header h3 {
  margin: 0;
  color: #333;
}

.export-section {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: #f9f9f9;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
}

.export-section h4 {
  margin: 0 0 0.5rem 0;
  color: #333;
}

.section-description {
  margin: 0 0 1rem 0;
  color: #666;
  font-size: 0.9rem;
}

.format-selector {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.format-selector label {
  font-weight: 500;
  color: #333;
}

.format-selector select {
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  font-size: 0.9rem;
  cursor: pointer;
}

.format-selector select:hover {
  border-color: #667eea;
}

.content-toggle {
  margin-bottom: 1rem;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.toggle-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.toggle-text {
  font-weight: 500;
  color: #333;
}

.toggle-hint {
  font-size: 0.85rem;
  color: #666;
}

.btn-export {
  padding: 0.75rem 1.5rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-export:hover:not(:disabled) {
  background: #764ba2;
}

.btn-export:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.file-upload {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.file-input {
  display: none;
}

.btn-select-file {
  padding: 0.5rem 1rem;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.btn-select-file:hover {
  background: #e0e0e0;
  border-color: #667eea;
}

.selected-file {
  color: #666;
  font-size: 0.9rem;
  font-family: monospace;
}

.export-result {
  margin-top: 1.5rem;
  padding: 1rem;
  background: #e8f5e9;
  border: 1px solid #4caf50;
  border-radius: 6px;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-weight: 600;
  color: #2e7d32;
}

.success-icon {
  background: #4caf50;
  color: white;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-size: 0.75rem;
}

.result-details {
  display: grid;
  gap: 0.5rem;
}

.detail-row {
  display: flex;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.detail-row .label {
  color: #666;
  font-weight: 500;
}

.detail-row .value {
  color: #333;
  font-family: monospace;
}

.error-message {
  margin-top: 1rem;
  padding: 1rem;
  background: #ffebee;
  border: 1px solid #d32f2f;
  border-radius: 6px;
  color: #d32f2f;
}
</style>
