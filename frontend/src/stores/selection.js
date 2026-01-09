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
    if (selectedMessages.value.has(uuid)) {
      selectedMessages.value.delete(uuid);
    } else {
      selectedMessages.value.add(uuid);
    }
  }

  function selectAllMessages() {
    selectedMessages.value = new Set(allMessages.value);
  }

  function clearMessages() {
    selectedMessages.value.clear();
  }

  function toggleAllMessages() {
    if (allSelected.value) {
      clearMessages();
    } else {
      selectAllMessages();
    }
  }

  function toggleFile(filePath) {
    if (selectedFiles.value.has(filePath)) {
      selectedFiles.value.delete(filePath);
    } else {
      selectedFiles.value.add(filePath);
    }
  }

  function selectAllFiles(files) {
    selectedFiles.value = new Set(files.map(f => f.path));
  }

  function clearFiles() {
    selectedFiles.value.clear();
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
    selectAllMessages,
    clearMessages,
    toggleAllMessages,
    toggleFile,
    selectAllFiles,
    clearFiles,
    clearAll
  };
});
