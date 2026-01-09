<template>
  <div class="app">
    <header class="app-header">
      <h1>Claude Code Context Manager</h1>
      <p class="subtitle">Sanitize and distill Claude Code context files</p>
    </header>

    <div class="app-container">
      <!-- Initial Project Browser (all projects) -->
      <ProjectBrowser v-if="showBrowser" @select="selectProject" />

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
import ProjectBrowser from './components/ProjectBrowser.vue';
import SessionEditor from './components/SessionEditor.vue';

const navigationStore = useNavigationStore();
const currentSession = ref(null);
const currentProject = ref(null);

const showBrowser = computed(() => !currentSession.value && !currentProject.value);
const showProjectBrowser = computed(() => currentProject.value && !currentSession.value);
const showSessionEditor = computed(() => currentSession.value);

onMounted(() => {
  // Restore navigation state from localStorage
  navigationStore.restoreState();

  // If we have a saved state, restore it
  if (navigationStore.currentView) {
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

function selectProject(project) {
  console.log('[App] selectProject called with:', project);
  if (!project.id) {
    console.error('[App] WARNING: project.id is missing!', project);
  }
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
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.app-header h1 {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.subtitle {
  font-size: 0.95rem;
  opacity: 0.9;
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
