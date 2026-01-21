/**
 * Keepit Pattern Detection and Extraction
 *
 * Detects ##keepitX.XX## markers in conversation content and extracts them
 * for use in compression preservation decisions.
 */

import { v4 as uuidv4 } from 'uuid';

// Keepit pattern: ##keepit0.80##content (weight as decimal 0.00-1.00)
// Content extends until next ##keepit marker or double newline or end of text
const KEEPIT_PATTERN = /##keepit(\d+\.\d{2})##([\s\S]*?)(?=##keepit|\n\n|$)/gi;

// Weight presets for convenience
export const WEIGHT_PRESETS = {
  PINNED: 1.00,      // Always survives - permanent marker
  CRITICAL: 0.90,    // Survives most compressions
  IMPORTANT: 0.75,   // High priority preservation
  NOTABLE: 0.50,     // Moderate priority
  MINOR: 0.25,       // Low priority - survives light compression
  HINT: 0.10         // Lowest priority - easily decayed
};

/**
 * Validate and normalize a keepit weight
 * @param {number|string} weight - The weight value to validate
 * @returns {number} Normalized weight between 0.00 and 1.00
 */
export function validateWeight(weight) {
  // Convert string to number if needed
  const numWeight = typeof weight === 'string' ? parseFloat(weight) : weight;

  // Handle invalid values
  if (typeof numWeight !== 'number' || isNaN(numWeight)) {
    return 0.50; // Default to moderate weight
  }

  // Clamp to valid range
  const clamped = Math.max(0, Math.min(1, numWeight));

  // Round to 2 decimal places
  return Math.round(clamped * 100) / 100;
}

/**
 * Generate a unique marker ID
 * @returns {string} Unique marker ID
 */
export function generateMarkerId() {
  return `keepit_${uuidv4().slice(0, 12)}`;
}

/**
 * Extract keepit markers from text content
 * @param {string} text - The text to search for keepit markers
 * @returns {Array} Array of raw marker objects with weight, content, and positions
 */
export function extractKeepitMarkers(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const markers = [];

  // Reset regex state for fresh search
  KEEPIT_PATTERN.lastIndex = 0;

  let match;
  while ((match = KEEPIT_PATTERN.exec(text)) !== null) {
    const rawWeight = parseFloat(match[1]);
    const content = match[2].trim();

    // Skip empty content
    if (!content) continue;

    markers.push({
      weight: validateWeight(rawWeight),
      content,
      rawMatch: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }

  return markers;
}

/**
 * Extract text content from a message (handles array or string content)
 * @param {object} message - Message object with content field
 * @returns {string} Extracted text content
 */
function getMessageText(message) {
  if (!message || !message.content) return '';

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter(block => block && block.type === 'text')
      .map(block => block.text || '')
      .join('\n');
  }

  return '';
}

/**
 * Extract surrounding context for a keepit marker (for UI display)
 * @param {number} startIndex - Start index of marker in text
 * @param {string} text - Full text content
 * @param {number} contextChars - Number of characters of context (default 50)
 * @returns {object} Context with before and after text
 */
function extractContext(startIndex, text, contextChars = 50) {
  const before = text.slice(Math.max(0, startIndex - contextChars), startIndex).trim();
  const afterStart = startIndex;
  const afterEnd = Math.min(text.length, afterStart + contextChars);
  const after = text.slice(afterStart, afterEnd).trim();

  return {
    before: before.length < contextChars ? before : '...' + before,
    after: after.length < contextChars ? after : after + '...'
  };
}

/**
 * Normalize a raw keepit marker into a full marker object
 * @param {object} rawMarker - Raw marker from extraction
 * @param {string} messageUuid - UUID of the containing message
 * @param {string} fullText - Full text of the message (for context)
 * @returns {object} Normalized KeepitMarker object
 */
export function normalizeKeepitMarker(rawMarker, messageUuid, fullText) {
  return {
    markerId: generateMarkerId(),
    messageUuid,
    weight: rawMarker.weight,
    content: rawMarker.content,
    position: {
      start: rawMarker.startIndex,
      end: rawMarker.endIndex
    },
    context: extractContext(rawMarker.startIndex, fullText),
    createdAt: new Date().toISOString(),
    survivedIn: [],    // Array of versionIds where this marker survived
    summarizedIn: []   // Array of versionIds where this marker was summarized
  };
}

/**
 * Find all keepit markers in a parsed session
 * @param {object} parsed - Parsed session object from jsonl-parser
 * @returns {Array} Array of normalized KeepitMarker objects
 */
export function findKeepitsInSession(parsed) {
  if (!parsed || !parsed.messages || !Array.isArray(parsed.messages)) {
    return [];
  }

  const allMarkers = [];

  for (const message of parsed.messages) {
    // Only process user and assistant messages
    if (message.type !== 'user' && message.type !== 'assistant') {
      continue;
    }

    const text = getMessageText(message);
    if (!text) continue;

    const rawMarkers = extractKeepitMarkers(text);

    for (const rawMarker of rawMarkers) {
      const normalizedMarker = normalizeKeepitMarker(
        rawMarker,
        message.uuid,
        text
      );
      allMarkers.push(normalizedMarker);
    }
  }

  return allMarkers;
}

/**
 * Check if a weight indicates pinned (permanent) content
 * @param {number} weight - The weight value
 * @returns {boolean} True if this is pinned content
 */
export function isPinned(weight) {
  return validateWeight(weight) >= 1.0;
}

/**
 * Get preset name for a given weight
 * @param {number} weight - The weight value
 * @returns {string|null} Preset name or null if not a preset
 */
export function getPresetName(weight) {
  const normalized = validateWeight(weight);

  for (const [name, value] of Object.entries(WEIGHT_PRESETS)) {
    if (Math.abs(normalized - value) < 0.01) {
      return name;
    }
  }

  return null;
}

/**
 * Create a keepit marker string for insertion into text
 * @param {number} weight - The weight value (0.00-1.00)
 * @param {string} content - The content to mark
 * @returns {string} Formatted keepit marker string
 */
export function createKeepitMarker(weight, content) {
  const normalizedWeight = validateWeight(weight);
  return `##keepit${normalizedWeight.toFixed(2)}##${content}`;
}

/**
 * Remove all keepit markers from text, returning clean text
 * @param {string} text - Text containing keepit markers
 * @returns {string} Text with keepit markers removed (content preserved)
 */
export function stripKeepitMarkers(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Replace marker patterns with just the content
  return text.replace(/##keepit\d+\.\d{2}##/gi, '');
}

/**
 * Update a keepit marker's weight in text
 * @param {string} text - Text containing the marker
 * @param {string} content - The marked content to find
 * @param {number} oldWeight - Current weight
 * @param {number} newWeight - New weight to set
 * @returns {string} Updated text
 */
export function updateKeepitWeight(text, content, oldWeight, newWeight) {
  const oldPattern = `##keepit${validateWeight(oldWeight).toFixed(2)}##${content}`;
  const newPattern = `##keepit${validateWeight(newWeight).toFixed(2)}##${content}`;

  return text.replace(oldPattern, newPattern);
}

/**
 * Validate keepit markers in text and return any issues
 * @param {string} text - Text to validate
 * @returns {object} Validation result with valid flag and issues array
 */
export function validateKeepitSyntax(text) {
  const issues = [];

  // Check for malformed patterns (missing decimals, wrong format)
  const malformedPattern = /##keepit(?!\d+\.\d{2}##)([^#]*?)(?:##|$)/gi;
  let match;

  while ((match = malformedPattern.exec(text)) !== null) {
    issues.push({
      type: 'malformed',
      position: match.index,
      found: match[0],
      suggestion: 'Use format ##keepit0.XX## with two decimal places'
    });
  }

  // Check for out-of-range weights
  const weightPattern = /##keepit(\d+\.\d{2})##/gi;
  while ((match = weightPattern.exec(text)) !== null) {
    const weight = parseFloat(match[1]);
    if (weight < 0 || weight > 1) {
      issues.push({
        type: 'out_of_range',
        position: match.index,
        weight,
        suggestion: 'Weight must be between 0.00 and 1.00'
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
