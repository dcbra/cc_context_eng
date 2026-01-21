<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="memory-settings">
      <div class="settings-header">
        <h3>Memory System Settings</h3>
        <button class="btn-close" @click="$emit('close')">&times;</button>
      </div>

      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <span>Loading settings...</span>
      </div>

      <div v-else-if="error" class="error-state">
        <p>{{ error }}</p>
        <button @click="loadSettings" class="btn-secondary">Retry</button>
      </div>

      <form v-else @submit.prevent="saveSettings" class="settings-form">
        <!-- Storage Section -->
        <div class="settings-section">
          <h4>Storage</h4>
          <div class="setting-row">
            <label>
              <input type="checkbox" v-model="settings.storage.useSymlinks" />
              <span class="setting-label">Use Symlinks</span>
            </label>
            <span class="setting-hint">Faster access, but may not work on all systems</span>
          </div>
          <div class="setting-row">
            <label class="setting-label">Max Cache Size</label>
            <select v-model="settings.storage.maxCacheSize" class="setting-select">
              <option value="256MB">256 MB</option>
              <option value="512MB">512 MB</option>
              <option value="1GB">1 GB</option>
              <option value="2GB">2 GB</option>
            </select>
          </div>
        </div>

        <!-- Defaults Section -->
        <div class="settings-section">
          <h4>Defaults</h4>
          <div class="setting-row">
            <label class="setting-label">Default Compression Preset</label>
            <select v-model="settings.defaults.compressionPreset" class="setting-select">
              <option value="gentle">Gentle</option>
              <option value="standard">Standard</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
          <div class="setting-row">
            <label>
              <input type="checkbox" v-model="settings.defaults.keepitDecayEnabled" />
              <span class="setting-label">Enable Keepit Decay</span>
            </label>
            <span class="setting-hint">Apply weight decay based on session distance</span>
          </div>
          <div class="setting-row">
            <label>
              <input type="checkbox" v-model="settings.defaults.autoRegisterSessions" />
              <span class="setting-label">Auto-register Sessions</span>
            </label>
            <span class="setting-hint">Automatically add new sessions to memory</span>
          </div>
          <div class="setting-row">
            <label class="setting-label">Default Model</label>
            <select v-model="settings.defaults.model" class="setting-select">
              <option value="opus">Opus (Best quality)</option>
              <option value="sonnet">Sonnet (Faster)</option>
              <option value="haiku">Haiku (Fastest)</option>
            </select>
          </div>
        </div>

        <!-- Keepit Decay Section -->
        <div class="settings-section">
          <h4>Keepit Decay Settings</h4>
          <div class="setting-row">
            <label class="setting-label">Max Session Distance</label>
            <input
              type="number"
              v-model.number="settings.keepitDecay.maxSessionDistance"
              min="1"
              max="20"
              class="setting-input-number"
            />
            <span class="setting-hint">Sessions beyond this distance use max decay</span>
          </div>
          <div class="setting-row">
            <label class="setting-label">Light Compression Base</label>
            <input
              type="number"
              v-model.number="settings.keepitDecay.compressionBase.light"
              min="0"
              max="1"
              step="0.1"
              class="setting-input-number"
            />
          </div>
          <div class="setting-row">
            <label class="setting-label">Moderate Compression Base</label>
            <input
              type="number"
              v-model.number="settings.keepitDecay.compressionBase.moderate"
              min="0"
              max="1"
              step="0.1"
              class="setting-input-number"
            />
          </div>
          <div class="setting-row">
            <label class="setting-label">Aggressive Compression Base</label>
            <input
              type="number"
              v-model.number="settings.keepitDecay.compressionBase.aggressive"
              min="0"
              max="1"
              step="0.1"
              class="setting-input-number"
            />
          </div>
        </div>

        <!-- UI Preferences Section -->
        <div class="settings-section">
          <h4>UI Preferences</h4>
          <div class="setting-row">
            <label class="setting-label">Default View</label>
            <select v-model="settings.ui.defaultView" class="setting-select">
              <option value="timeline">Timeline</option>
              <option value="list">List</option>
            </select>
          </div>
          <div class="setting-row">
            <label>
              <input type="checkbox" v-model="settings.ui.showTokenEstimates" />
              <span class="setting-label">Show Token Estimates</span>
            </label>
          </div>
          <div class="setting-row">
            <label>
              <input type="checkbox" v-model="settings.ui.confirmDestructiveActions" />
              <span class="setting-label">Confirm Destructive Actions</span>
            </label>
          </div>
        </div>

        <!-- Actions -->
        <div class="dialog-actions">
          <button type="button" @click="resetToDefaults" class="btn-secondary">
            Reset to Defaults
          </button>
          <div class="action-spacer"></div>
          <button type="button" @click="$emit('close')" class="btn-secondary">
            Cancel
          </button>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive } from 'vue';
import { useMemoryStore } from '../../stores/memory.js';
import * as memoryApi from '../../utils/memory-api.js';

const emit = defineEmits(['close', 'saved']);

const memoryStore = useMemoryStore();

const loading = ref(true);
const saving = ref(false);
const error = ref(null);

// Settings with defaults
const settings = reactive({
  storage: {
    useSymlinks: true,
    maxCacheSize: '512MB'
  },
  defaults: {
    compressionPreset: 'standard',
    keepitDecayEnabled: true,
    autoRegisterSessions: false,
    model: 'sonnet'
  },
  keepitDecay: {
    maxSessionDistance: 10,
    compressionBase: {
      light: 0.9,
      moderate: 0.75,
      aggressive: 0.5
    }
  },
  ui: {
    defaultView: 'list',
    showTokenEstimates: true,
    confirmDestructiveActions: true
  }
});

const defaultSettings = {
  storage: {
    useSymlinks: true,
    maxCacheSize: '512MB'
  },
  defaults: {
    compressionPreset: 'standard',
    keepitDecayEnabled: true,
    autoRegisterSessions: false,
    model: 'sonnet'
  },
  keepitDecay: {
    maxSessionDistance: 10,
    compressionBase: {
      light: 0.9,
      moderate: 0.75,
      aggressive: 0.5
    }
  },
  ui: {
    defaultView: 'list',
    showTokenEstimates: true,
    confirmDestructiveActions: true
  }
};

onMounted(() => {
  loadSettings();
});

async function loadSettings() {
  loading.value = true;
  error.value = null;

  try {
    const config = await memoryApi.getMemoryConfig();

    // Merge loaded config with defaults
    if (config) {
      if (config.storage) {
        Object.assign(settings.storage, config.storage);
      }
      if (config.defaults) {
        Object.assign(settings.defaults, config.defaults);
      }
      if (config.keepitDecay) {
        settings.keepitDecay.maxSessionDistance = config.keepitDecay.maxSessionDistance || 10;
        if (config.keepitDecay.compressionBase) {
          Object.assign(settings.keepitDecay.compressionBase, config.keepitDecay.compressionBase);
        }
      }
      if (config.ui) {
        Object.assign(settings.ui, config.ui);
      }
    }
  } catch (err) {
    error.value = err.message || 'Failed to load settings';
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  error.value = null;

  try {
    await memoryApi.updateMemoryConfig(settings);
    emit('saved');
    emit('close');
  } catch (err) {
    error.value = err.message || 'Failed to save settings';
  } finally {
    saving.value = false;
  }
}

function resetToDefaults() {
  if (!confirm('Reset all settings to defaults?')) return;

  Object.assign(settings.storage, defaultSettings.storage);
  Object.assign(settings.defaults, defaultSettings.defaults);
  settings.keepitDecay.maxSessionDistance = defaultSettings.keepitDecay.maxSessionDistance;
  Object.assign(settings.keepitDecay.compressionBase, defaultSettings.keepitDecay.compressionBase);
  Object.assign(settings.ui, defaultSettings.ui);
}
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

.memory-settings {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.settings-header h3 {
  margin: 0;
  font-size: 1.25rem;
}

.btn-close {
  background: none;
  border: none;
  font-size: 1.75rem;
  cursor: pointer;
  color: white;
  opacity: 0.8;
  padding: 0;
  line-height: 1;
}

.btn-close:hover {
  opacity: 1;
}

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  gap: 1rem;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #f0f0f0;
  border-top: 3px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  color: #c53030;
}

.settings-form {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.5rem;
}

.settings-section {
  margin-bottom: 1.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid #e2e8f0;
}

.settings-section:last-of-type {
  border-bottom: none;
  margin-bottom: 0;
}

.settings-section h4 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  color: #333;
  font-weight: 600;
}

.setting-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding: 0.5rem;
  background: #f8fafc;
  border-radius: 4px;
}

.setting-row label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.setting-row input[type="checkbox"] {
  cursor: pointer;
  width: 16px;
  height: 16px;
}

.setting-label {
  font-weight: 500;
  color: #333;
  min-width: 180px;
}

.setting-hint {
  font-size: 0.8rem;
  color: #a0aec0;
  flex: 1;
  text-align: right;
}

.setting-select {
  padding: 0.375rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  font-size: 0.9rem;
  background: white;
  cursor: pointer;
  min-width: 150px;
}

.setting-select:focus {
  outline: none;
  border-color: #667eea;
}

.setting-input-number {
  padding: 0.375rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  font-size: 0.9rem;
  width: 80px;
  text-align: center;
}

.setting-input-number:focus {
  outline: none;
  border-color: #667eea;
}

.dialog-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

.action-spacer {
  flex: 1;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: #f1f5f9;
  border-color: #667eea;
}

.btn-primary {
  padding: 0.5rem 1.25rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
