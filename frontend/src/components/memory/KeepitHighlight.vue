<template>
  <span class="keepit-highlighted-content">
    <template v-for="(segment, idx) in parsedContent" :key="idx">
      <!-- Regular text -->
      <span v-if="segment.type === 'text'" class="text-segment">{{ segment.text }}</span>

      <!-- Keepit marker -->
      <span
        v-else-if="segment.type === 'keepit'"
        class="keepit-highlight"
        :class="getWeightClass(segment.weight)"
        @click.stop="handleKeepitClick(segment)"
      >
        <span class="keepit-badge" :title="'Weight: ' + segment.weight.toFixed(2)">
          {{ segment.weight.toFixed(2) }}
        </span>
        <span class="keepit-content">{{ segment.content }}</span>
      </span>
    </template>
  </span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  content: {
    type: String,
    required: true
  },
  editable: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['edit-keepit']);

// Keepit pattern: ##keepitX.XX##content (until next ##keepit or double newline or end)
const KEEPIT_PATTERN = /##keepit(\d+\.\d{2})##([\s\S]*?)(?=##keepit|\n\n|$)/gi;

/**
 * Parse content to extract keepit markers and regular text
 */
const parsedContent = computed(() => {
  if (!props.content) return [];

  const segments = [];
  let lastIndex = 0;
  let match;

  // Reset regex state
  KEEPIT_PATTERN.lastIndex = 0;

  while ((match = KEEPIT_PATTERN.exec(props.content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = props.content.substring(lastIndex, match.index);
      if (textBefore) {
        segments.push({
          type: 'text',
          text: textBefore
        });
      }
    }

    // Add the keepit marker
    const weight = parseFloat(match[1]);
    const content = match[2].trim();

    segments.push({
      type: 'keepit',
      weight: weight,
      content: content,
      originalMatch: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < props.content.length) {
    const remainingText = props.content.substring(lastIndex);
    if (remainingText) {
      segments.push({
        type: 'text',
        text: remainingText
      });
    }
  }

  // If no matches found, return the entire content as text
  if (segments.length === 0) {
    segments.push({
      type: 'text',
      text: props.content
    });
  }

  return segments;
});

/**
 * Get CSS class based on weight level
 */
function getWeightClass(weight) {
  if (weight >= 0.95) return 'weight-pinned';
  if (weight >= 0.80) return 'weight-critical';
  if (weight >= 0.65) return 'weight-important';
  if (weight >= 0.45) return 'weight-notable';
  return 'weight-minor';
}

/**
 * Handle click on keepit marker
 */
function handleKeepitClick(segment) {
  if (props.editable) {
    emit('edit-keepit', {
      weight: segment.weight,
      content: segment.content,
      originalMatch: segment.originalMatch,
      startIndex: segment.startIndex,
      endIndex: segment.endIndex
    });
  }
}
</script>

<style scoped>
.keepit-highlighted-content {
  display: inline;
}

.text-segment {
  white-space: pre-wrap;
}

.keepit-highlight {
  display: inline;
  padding: 0.1rem 0.25rem;
  margin: 0 0.1rem;
  border-radius: 4px;
  background: rgba(102, 126, 234, 0.1);
  border: 1px solid rgba(102, 126, 234, 0.3);
  transition: all 0.2s ease;
}

.keepit-highlight:hover {
  background: rgba(102, 126, 234, 0.2);
  border-color: rgba(102, 126, 234, 0.5);
}

/* Weight-based styling */
.keepit-highlight.weight-pinned {
  background: rgba(229, 62, 62, 0.1);
  border-color: rgba(229, 62, 62, 0.3);
}

.keepit-highlight.weight-pinned:hover {
  background: rgba(229, 62, 62, 0.15);
  border-color: rgba(229, 62, 62, 0.5);
}

.keepit-highlight.weight-critical {
  background: rgba(221, 107, 32, 0.1);
  border-color: rgba(221, 107, 32, 0.3);
}

.keepit-highlight.weight-critical:hover {
  background: rgba(221, 107, 32, 0.15);
  border-color: rgba(221, 107, 32, 0.5);
}

.keepit-highlight.weight-important {
  background: rgba(214, 158, 46, 0.1);
  border-color: rgba(214, 158, 46, 0.3);
}

.keepit-highlight.weight-important:hover {
  background: rgba(214, 158, 46, 0.15);
  border-color: rgba(214, 158, 46, 0.5);
}

.keepit-highlight.weight-notable {
  background: rgba(56, 161, 105, 0.1);
  border-color: rgba(56, 161, 105, 0.3);
}

.keepit-highlight.weight-notable:hover {
  background: rgba(56, 161, 105, 0.15);
  border-color: rgba(56, 161, 105, 0.5);
}

.keepit-highlight.weight-minor {
  background: rgba(113, 128, 150, 0.1);
  border-color: rgba(113, 128, 150, 0.3);
}

.keepit-highlight.weight-minor:hover {
  background: rgba(113, 128, 150, 0.15);
  border-color: rgba(113, 128, 150, 0.5);
}

/* Badge */
.keepit-badge {
  display: inline-block;
  padding: 0.1rem 0.35rem;
  margin-right: 0.35rem;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 700;
  font-family: monospace;
  vertical-align: middle;
  cursor: help;
}

.weight-pinned .keepit-badge {
  background: #fed7d7;
  color: #c53030;
}

.weight-critical .keepit-badge {
  background: #feebc8;
  color: #c05621;
}

.weight-important .keepit-badge {
  background: #fefcbf;
  color: #975a16;
}

.weight-notable .keepit-badge {
  background: #c6f6d5;
  color: #276749;
}

.weight-minor .keepit-badge {
  background: #e2e8f0;
  color: #4a5568;
}

.keepit-content {
  display: inline;
}

/* Editable state cursor */
.keepit-highlight[data-editable="true"] {
  cursor: pointer;
}
</style>
