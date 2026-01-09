import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useSessionStore = defineStore('session', () => {
  const currentSession = ref(null);
  const sessionData = ref(null);
  const loading = ref(false);
  const error = ref(null);

  const hasSession = computed(() => !!currentSession.value);
  const messageCount = computed(() => sessionData.value?.totalMessages || 0);

  async function loadSession(sessionId, projectId) {
    loading.value = true;
    error.value = null;

    try {
      const response = await fetch(`/api/sessions/${sessionId}?projectId=${projectId}`);
      if (!response.ok) {
        throw new Error(`Failed to load session: ${response.statusText}`);
      }

      sessionData.value = await response.json();
      currentSession.value = { sessionId, projectId };
    } catch (err) {
      error.value = err.message;
      console.error('Error loading session:', err);
    } finally {
      loading.value = false;
    }
  }

  function clearSession() {
    currentSession.value = null;
    sessionData.value = null;
    error.value = null;
  }

  return {
    currentSession,
    sessionData,
    loading,
    error,
    hasSession,
    messageCount,
    loadSession,
    clearSession
  };
});
