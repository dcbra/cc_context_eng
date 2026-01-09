<template>
  <div class="project-browser">
    <div class="browser-header">
      <h2>Projects</h2>
      <div class="stats">{{ projects.length }} projects</div>
    </div>

    <div v-if="loading" class="loading">Loading projects...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="projects.length === 0" class="empty">
      No projects found in ~/.claude/projects
    </div>

    <div v-else class="projects-list">
      <div
        v-for="project in displayProjects"
        :key="project.id"
        class="project-item"
        :class="{ 'single-project': isSingleProject }"
        @click="!isSingleProject && (expandedProject = expandedProject === project.id ? null : project.id)"
      >
        <div class="project-header">
          <div class="project-name">{{ project.name }}</div>
          <div class="project-meta" v-if="!isSingleProject">
            {{ project.sessionCount }} session{{ project.sessionCount !== 1 ? 's' : '' }}
          </div>
        </div>

        <div v-if="expandedProject === project.id" class="sessions-list">
          <div v-if="loadingSessions[project.id]" class="loading-sessions">
            Loading sessions...
          </div>
          <div
            v-for="session in projectSessions[project.id] || []"
            :key="session.id"
            class="session-item"
            :class="{ 'is-subagent': session.isSubagent }"
            @click.stop="selectSession(session, project)"
          >
            <div class="session-checkbox">
              <input type="checkbox" :checked="false" readonly />
            </div>
            <div class="session-info">
              <div class="session-name">{{ session.fileName }}</div>
              <div class="session-details">
                {{ session.messageCount }} messages • {{ formatSize(session.size) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue';
import { getProjects, getProjectSessions } from '../utils/api.js';

const props = defineProps({
  project: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['select']);

const projects = ref([]);
const projectSessions = ref({});
const loadingSessions = ref({});
const expandedProject = ref(null);
const loading = ref(true);
const error = ref(null);

// If a specific project is passed, show sessions for that project
const isSingleProject = computed(() => !!props.project);
const displayProjects = computed(() => props.project ? [props.project] : projects.value);

onMounted(async () => {
  try {
    if (!props.project) {
      projects.value = await getProjects();
    } else {
      // Load sessions for the specific project
      await expandProject(props.project.id);
      expandedProject.value = props.project.id;
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
});

async function expandProject(projectId) {
  if (loadingSessions.value[projectId]) return;

  loadingSessions.value[projectId] = true;
  try {
    projectSessions.value[projectId] = await getProjectSessions(projectId);
  } catch (err) {
    error.value = err.message;
  } finally {
    loadingSessions.value[projectId] = false;
  }
}

async function selectSession(session, project) {
  emit('select', { session, project });
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Load sessions when expanding project
const originalExpand = expandedProject;
watch(
  () => expandedProject.value,
  (newVal) => {
    if (newVal) {
      expandProject(newVal);
    }
  }
);
</script>

<style scoped>
.project-browser {
  padding: 1.5rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  width: 100%;
}

.browser-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  border-bottom: 2px solid #667eea;
  padding-bottom: 1rem;
}

.browser-header h2 {
  font-size: 1.5rem;
  color: #333;
}

.stats {
  color: #999;
  font-size: 0.9rem;
}

.loading,
.error,
.empty {
  text-align: center;
  padding: 2rem;
  font-size: 1rem;
}

.error {
  color: #d32f2f;
  background-color: #ffebee;
  border-radius: 4px;
}

.empty {
  color: #999;
}

.projects-list {
  display: grid;
  gap: 0.5rem;
}

.project-item {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s ease;
}

.project-item:hover {
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.project-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background-color: #f9f9f9;
  font-weight: 500;
}

.project-name {
  flex: 1;
  font-family: monospace;
  color: #333;
}

.project-meta {
  color: #999;
  font-size: 0.85rem;
  margin-left: 1rem;
}

.sessions-list {
  padding: 0.5rem;
  background-color: #fafafa;
  border-top: 1px solid #e0e0e0;
}

.loading-sessions {
  text-align: center;
  padding: 1rem;
  color: #999;
}

.session-item {
  display: flex;
  align-items: center;
  padding: 0.75rem;
  margin-bottom: 0.25rem;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.session-item:hover {
  background-color: #f0f4ff;
  border-color: #667eea;
}

.session-item.is-subagent {
  background-color: #fffbe6;
}

.session-checkbox {
  margin-right: 0.75rem;
}

.session-info {
  flex: 1;
}

.session-name {
  font-family: monospace;
  font-size: 0.9rem;
  color: #333;
  font-weight: 500;
}

.session-details {
  font-size: 0.85rem;
  color: #999;
  margin-top: 0.25rem;
}
</style>
