/**
 * Keyboard Shortcuts Composable
 *
 * Provides keyboard shortcut handling for the application.
 * Supports modifier keys (Ctrl, Shift, Alt, Meta/Cmd)
 */

import { onMounted, onUnmounted, ref } from 'vue';

/**
 * Register keyboard shortcuts
 * @param {Array<{key: string, ctrl?: boolean, shift?: boolean, alt?: boolean, meta?: boolean, handler: Function, description?: string}>} shortcuts
 * @returns {{ activeShortcuts: Ref<Array> }}
 */
export function useKeyboardShortcuts(shortcuts) {
  const activeShortcuts = ref(shortcuts);

  function handleKeyDown(event) {
    // Skip if user is typing in an input/textarea
    if (
      event.target.tagName === 'INPUT' ||
      event.target.tagName === 'TEXTAREA' ||
      event.target.isContentEditable
    ) {
      return;
    }

    for (const shortcut of activeShortcuts.value) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatch = !!shortcut.ctrl === (event.ctrlKey || event.metaKey);
      const shiftMatch = !!shortcut.shift === event.shiftKey;
      const altMatch = !!shortcut.alt === event.altKey;

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        event.preventDefault();
        event.stopPropagation();
        shortcut.handler(event);
        return;
      }
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  return {
    activeShortcuts
  };
}

/**
 * Get formatted shortcut string for display
 * @param {{key: string, ctrl?: boolean, shift?: boolean, alt?: boolean, meta?: boolean}} shortcut
 * @returns {string}
 */
export function formatShortcut(shortcut) {
  const parts = [];

  if (shortcut.ctrl || shortcut.meta) {
    // Use Cmd on Mac, Ctrl on Windows/Linux
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    parts.push(isMac ? 'Cmd' : 'Ctrl');
  }
  if (shortcut.shift) {
    parts.push('Shift');
  }
  if (shortcut.alt) {
    parts.push('Alt');
  }

  // Format key name
  let keyName = shortcut.key.toUpperCase();
  if (keyName === ' ') keyName = 'Space';
  if (keyName === 'ESCAPE') keyName = 'Esc';
  if (keyName === 'ENTER') keyName = 'Enter';

  parts.push(keyName);

  return parts.join('+');
}
