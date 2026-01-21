<template>
  <div class="app">
    <header class="app-header">
      <div class="header-content">
        <div class="header-title">
          <h1>Claude Code Context Manager</h1>
          <p class="subtitle">Sanitize and distill Claude Code context files</p>
        </div>
        <nav class="main-nav">
          <button
            @click="navigateTo('browser')"
            class="nav-btn"
            :class="{ active: activeView === 'browser' }"
          >
            Sessions
          </button>
          <button
            @click="navigateTo('memory')"
            class="nav-btn"
            :class="{ active: activeView === 'memory' }"
          >
            Memory
          </button>
        </nav>
      </div>
    </header>

    <div class="app-container">
      <!-- Memory Browser View -->
      <MemoryBrowser v-if="activeView === 'memory'" @navigate-to-session="handleMemorySessionNavigation" />

      <!-- Initial Project Browser (all projects) -->
      <ProjectBrowser v-else-if="showBrowser" @select="selectProject" />

      <!-- Project Browser (sessions in selected project) -->
      <div v-else-if="showProjectBrowser" class="view-with-nav">
        <button class="back-button" @click="goBack">← Back</button>
        <ProjectBrowser :project="currentProject" @select="selectSession" />
      </div>

      <!-- Session Editor -->
      <div v-else-if="showSessionEditor" class="view-with-nav">
        <button class="back-button" @click="goBack">← Back</button>
        <SessionEditor :session="currentSession" @close="goBack" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useNavigationStore } from './stores/navigation.js';
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts.js';
import ProjectBrowser from './components/ProjectBrowser.vue';
import SessionEditor from './components/SessionEditor.vue';
import MemoryBrowser from './components/memory/MemoryBrowser.vue';

const navigationStore = useNavigationStore();
const currentSession = ref(null);
const currentProject = ref(null);
const activeView = ref('browser'); // 'browser' or 'memory'

const showBrowser = computed(() => activeView.value === 'browser' && !currentSession.value && !currentProject.value);
const showProjectBrowser = computed(() => activeView.value === 'browser' && currentProject.value && !currentSession.value);
const showSessionEditor = computed(() => activeView.value === 'browser' && currentSession.value);

onMounted(() => {
  // Restore navigation state from localStorage
  navigationStore.restoreState();

  // Check if there's a saved active view
  const savedView = localStorage.getItem('activeView');
  if (savedView && ['browser', 'memory'].includes(savedView)) {
    activeView.value = savedView;
  }

  // If we have a saved state and we're in browser mode, restore it
  if (navigationStore.currentView && activeView.value === 'browser') {
    const view = navigationStore.currentView;
    if (view.type === 'session') {
      currentSession.value = view.data;
      currentProject.value = null;
    } else if (view.type === 'project') {
      currentProject.value = view.data;
      currentSession.value = null;
    }
  }
});

function navigateTo(view) {
  activeView.value = view;
  localStorage.setItem('activeView', view);
}

function handleMemorySessionNavigation(sessionData) {
  // Navigate from memory browser to session editor
  activeView.value = 'browser';
  localStorage.setItem('activeView', 'browser');
  currentSession.value = sessionData;
  currentProject.value = null;
}

// Register keyboard shortcuts
useKeyboardShortcuts([
  {
    key: 'm',
    ctrl: true,
    shift: true,
    handler: () => navigateTo(activeView.value === 'memory' ? 'browser' : 'memory'),
    description: 'Toggle Memory Browser'
  },
  {
    key: 'Escape',
    handler: () => {
      if (currentSession.value) {
        goBack();
      } else if (currentProject.value) {
        goBack();
      } else if (activeView.value === 'memory') {
        navigateTo('browser');
      }
    },
    description: 'Go back / Close'
  }
]);

function selectProject(project) {
  navigationStore.push({
    type: 'project',
    data: project
  });
  currentProject.value = project;
}

function selectSession({ session, project }) {
  navigationStore.push({
    type: 'session',
    data: {
      sessionId: session.id,
      projectId: project.id,
      fileName: session.fileName,
      size: session.size
    }
  });
  currentSession.value = {
    sessionId: session.id,
    projectId: project.id,
    fileName: session.fileName,
    size: session.size
  };
}

function goBack() {
  navigationStore.goBack();
  const view = navigationStore.currentView;

  if (view) {
    if (view.type === 'session') {
      currentSession.value = view.data;
      currentProject.value = null;
    } else if (view.type === 'project') {
      currentProject.value = view.data;
      currentSession.value = null;
    }
  } else {
    currentSession.value = null;
    currentProject.value = null;
  }
}
</script>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 1.5rem 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}

.header-title h1 {
  font-size: 1.75rem;
  margin: 0 0 0.25rem 0;
}

.subtitle {
  font-size: 0.9rem;
  opacity: 0.9;
  margin: 0;
}

.main-nav {
  display: flex;
  gap: 0.5rem;
}

.nav-btn {
  padding: 0.625rem 1.25rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  color: white;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.5);
}

.nav-btn.active {
  background: white;
  color: #667eea;
  border-color: white;
}

.app-container {
  flex: 1;
  width: 100%;
  margin: 0;
  padding: 2rem;
  display: flex;
}

.view-with-nav {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
}

.back-button {
  align-self: flex-start;
  padding: 0.5rem 1rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.back-button:hover {
  background: #764ba2;
  transform: translateX(-2px);
}

@media (max-width: 768px) {
  .app-header h1 {
    font-size: 1.5rem;
  }

  .app-container {
    padding: 1rem;
  }
}
</style>
