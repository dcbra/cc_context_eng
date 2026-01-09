import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useNavigationStore = defineStore('navigation', () => {
  const history = ref([]);
  const currentView = ref(null); // { type: 'browser' | 'project' | 'session', data: {...} }

  const canGoBack = computed(() => history.value.length > 0);

  function push(view) {
    // Save current view to history before navigating
    if (currentView.value) {
      history.value.push(currentView.value);
    }
    currentView.value = view;
    // Persist to localStorage
    persistState();
  }

  function goBack() {
    if (history.value.length === 0) {
      currentView.value = null;
      persistState();
      return;
    }

    currentView.value = history.value.pop();
    persistState();
  }

  function reset() {
    history.value = [];
    currentView.value = null;
    localStorage.removeItem('navigationState');
  }

  function persistState() {
    const state = {
      history: history.value,
      currentView: currentView.value
    };
    localStorage.setItem('navigationState', JSON.stringify(state));
  }

  function restoreState() {
    try {
      const saved = localStorage.getItem('navigationState');
      if (saved) {
        const state = JSON.parse(saved);
        history.value = state.history || [];
        currentView.value = state.currentView || null;
      }
    } catch (error) {
      console.error('Error restoring navigation state:', error);
      reset();
    }
  }

  return {
    history,
    currentView,
    canGoBack,
    push,
    goBack,
    reset,
    restoreState
  };
});
