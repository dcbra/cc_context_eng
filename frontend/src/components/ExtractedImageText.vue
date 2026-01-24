<template>
  <div class="extracted-image-text">
    <template v-for="(segment, idx) in parsedSegments" :key="idx">
      <!-- Text segment -->
      <span v-if="segment.type === 'text'" class="text-segment" v-text="segment.content"></span>
      <!-- Extracted image segment -->
      <div v-else-if="segment.type === 'image'" class="extracted-image-container">
        <img
          :src="getImageApiUrl(segment.path)"
          class="extracted-image"
          :alt="'Extracted image: ' + segment.filename"
          @click="$emit('expandImage', getImageApiUrl(segment.path))"
          @error="handleImageError($event, segment)"
          loading="lazy"
        />
        <div class="image-caption">{{ segment.filename }}</div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  text: {
    type: String,
    required: true
  }
});

const emit = defineEmits(['expandImage']);

// Regex pattern to match [Image extracted: file:///path/to/image.png]
const EXTRACTED_IMAGE_PATTERN = /\[Image extracted: file:\/\/([^\]]+)\]/g;

// Parse text into segments of plain text and extracted images
const parsedSegments = computed(() => {
  if (!props.text) return [];

  const segments = [];
  let lastIndex = 0;
  let match;

  // Reset regex state
  EXTRACTED_IMAGE_PATTERN.lastIndex = 0;

  while ((match = EXTRACTED_IMAGE_PATTERN.exec(props.text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      const textContent = props.text.slice(lastIndex, match.index);
      if (textContent) {
        segments.push({
          type: 'text',
          content: formatText(textContent)
        });
      }
    }

    // Add the image reference
    const fullPath = match[1];
    const filename = fullPath.split('/').pop();
    segments.push({
      type: 'image',
      path: fullPath,
      filename: filename
    });

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining text after the last match
  if (lastIndex < props.text.length) {
    const textContent = props.text.slice(lastIndex);
    if (textContent) {
      segments.push({
        type: 'text',
        content: formatText(textContent)
      });
    }
  }

  // If no matches found, return the whole text as a single segment
  if (segments.length === 0 && props.text) {
    segments.push({
      type: 'text',
      content: formatText(props.text)
    });
  }

  return segments;
});

// Format text by converting escape sequences
function formatText(text) {
  if (!text) return '';

  let str = String(text);

  // Handle escape sequences
  let formatted = str
    .replace(/\\\\/g, '\x00')        // Temporarily replace \\\\ with placeholder
    .replace(/\\n/g, '\n')            // Convert \n to newline
    .replace(/\\t/g, '\t')            // Convert \t to tab
    .replace(/\\r/g, '\r')            // Convert \r to carriage return
    .replace(/\\"/g, '"')             // Convert \" to "
    .replace(/\\'/g, "'")             // Convert \' to '
    .replace(/\\b/g, '\b')            // Convert \b to backspace
    .replace(/\\f/g, '\f')            // Convert \f to form feed
    .replace(/\\v/g, '\v')            // Convert \v to vertical tab
    .replace(/\x00/g, '\\');          // Restore \\\\ as \\

  return formatted;
}

// Generate API URL for serving the image
function getImageApiUrl(imagePath) {
  // Backend API endpoint to serve images
  const encodedPath = encodeURIComponent(imagePath);
  return `/api/images?path=${encodedPath}`;
}

// Handle image load errors
function handleImageError(event, segment) {
  console.warn('Failed to load extracted image:', segment.path);
  // Add a visual indicator that the image failed to load
  event.target.style.display = 'none';
  const container = event.target.parentElement;
  if (container) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'image-error';
    errorDiv.textContent = `Image not found: ${segment.filename}`;
    container.insertBefore(errorDiv, container.firstChild);
  }
}
</script>

<style scoped>
.extracted-image-text {
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
  line-height: 1.6;
  font-size: 0.9rem;
}

.text-segment {
  white-space: pre-wrap;
}

.extracted-image-container {
  display: inline-block;
  margin: 0.5rem 0;
  padding: 0.5rem;
  background-color: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  text-align: center;
  max-width: 100%;
  vertical-align: top;
}

.extracted-image {
  max-width: 400px;
  max-height: 300px;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  display: block;
  margin: 0 auto;
}

.extracted-image:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.image-caption {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: #666;
  font-family: monospace;
  word-break: break-all;
}

.image-error {
  padding: 1rem;
  background-color: #fff5f5;
  border: 1px solid #feb2b2;
  border-radius: 4px;
  color: #c53030;
  font-size: 0.8rem;
}
</style>
