import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useHistoryStore = defineStore('history', () => {
  const undoStack = ref([]);
  const redoStack = ref([]);

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function push(action) {
    undoStack.value.push(action);
    // Clear redo stack when new action is performed
    redoStack.value = [];
  }

  function undo() {
    if (!canUndo.value) return null;
    const action = undoStack.value.pop();
    if (action) {
      redoStack.value.push(action);
    }
    return action;
  }

  function redo() {
    if (!canRedo.value) return null;
    const action = redoStack.value.pop();
    if (action) {
      undoStack.value.push(action);
    }
    return action;
  }

  function clear() {
    undoStack.value = [];
    redoStack.value = [];
  }

  return {
    undoStack,
    redoStack,
    canUndo,
    canRedo,
    push,
    undo,
    redo,
    clear
  };
});
