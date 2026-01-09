import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useSelectionStore = defineStore('selection', () => {
  const selectedMessages = ref(new Set());
  const selectedFiles = ref(new Set());
  const allMessages = ref([]);

  const selectedMessageCount = computed(() => selectedMessages.value.size);
  const selectedFileCount = computed(() => selectedFiles.value.size);
  const allSelected = computed(() =>
    allMessages.value.length > 0 && selectedMessages.value.size === allMessages.value.length
  );

  function setAllMessages(messages) {
    allMessages.value = messages.map(m => m.uuid);
  }

  function toggleMessage(uuid) {
    const newSet = new Set(selectedMessages.value);
    if (newSet.has(uuid)) {
      newSet.delete(uuid);
    } else {
      newSet.add(uuid);
    }
    selectedMessages.value = newSet;
  }

  function selectMessageRange(uuids) {
    const newSet = new Set(selectedMessages.value);
    uuids.forEach(uuid => newSet.add(uuid));
    selectedMessages.value = newSet;
  }

  function selectAllMessages() {
    selectedMessages.value = new Set(allMessages.value);
  }

  function clearMessages() {
    selectedMessages.value = new Set();
  }

  function toggleAllMessages() {
    if (allSelected.value) {
      clearMessages();
    } else {
      selectAllMessages();
    }
  }

  function toggleFile(filePath) {
    const newSet = new Set(selectedFiles.value);
    if (newSet.has(filePath)) {
      newSet.delete(filePath);
    } else {
      newSet.add(filePath);
    }
    selectedFiles.value = newSet;
  }

  function selectAllFiles(files) {
    selectedFiles.value = new Set(files.map(f => f.path));
  }

  function clearFiles() {
    selectedFiles.value = new Set();
  }

  function clearAll() {
    clearMessages();
    clearFiles();
  }

  return {
    selectedMessages,
    selectedFiles,
    selectedMessageCount,
    selectedFileCount,
    allSelected,
    setAllMessages,
    toggleMessage,
    selectMessageRange,
    selectAllMessages,
    clearMessages,
    toggleAllMessages,
    toggleFile,
    selectAllFiles,
    clearFiles,
    clearAll
  };
});
