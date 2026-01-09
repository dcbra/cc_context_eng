<template>
  <div class="app">
    <header class="app-header">
      <h1>Claude Code Context Manager</h1>
      <p class="subtitle">Sanitize and distill Claude Code context files</p>
    </header>

    <div class="app-container">
      <ProjectBrowser v-if="!currentSession" @select="selectSession" />
      <SessionViewer v-else :session="currentSession" @close="currentSession = null" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import ProjectBrowser from './components/ProjectBrowser.vue';
import SessionViewer from './components/SessionViewer.vue';

const currentSession = ref(null);

function selectSession({ session, project }) {
  currentSession.value = {
    sessionId: session.id,
    projectId: project.id,
    fileName: session.fileName,
    size: session.size
  };
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
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
  padding: 2rem;
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
