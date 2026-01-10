import { getMessageOrder } from './jsonl-parser.js';

/**
 * Sanitize a session by removing messages and/or files
 */
export function sanitizeSession(parsed, options = {}) {
  const {
    removeMessages = [],
    removeFiles = [],
    removeCriteria = {}
  } = options;

  // Create a working copy of messages
  let messages = JSON.parse(JSON.stringify(parsed.messages));
  const messageUuids = new Set(removeMessages);
  const filesSet = new Set(removeFiles);

  // Phase 1: Remove selected messages
  if (removeMessages.length > 0) {
    messages = removeSelectedMessages(messages, messageUuids, parsed.messageGraph);
  }

  // Phase 2: Remove file content from tool results
  if (removeFiles.length > 0) {
    messages = removeFileContent(messages, filesSet);
  }

  // Phase 3: Apply additional sanitization criteria
  if (Object.keys(removeCriteria).length > 0) {
    messages = applySanitizationCriteria(messages, removeCriteria);
  }

  return {
    messages,
    changes: {
      removedMessages: removeMessages.length,
      filesWithContentRemoved: removeFiles.length,
      criteriaApplied: Object.keys(removeCriteria).filter(k => removeCriteria[k]).length
    }
  };
}

/**
 * Remove selected messages while maintaining thread integrity and tool_use/tool_result pairing
 */
function removeSelectedMessages(messages, messagesToRemove, messageGraph) {
  const messageMap = new Map(messages.map(m => [m.uuid, m]));

  // First pass: collect all tool_use IDs from messages being removed
  const orphanedToolUseIds = new Set();
  for (const uuid of messagesToRemove) {
    const message = messageMap.get(uuid);
    if (message && message.toolUses) {
      for (const toolUse of message.toolUses) {
        orphanedToolUseIds.add(toolUse.id);
      }
    }
  }

  // Also collect tool_result IDs that will be orphaned (their tool_use is being removed)
  // And tool_use IDs whose results are being removed
  for (const uuid of messagesToRemove) {
    const message = messageMap.get(uuid);
    if (message && message.toolResults) {
      for (const toolResult of message.toolResults) {
        // This tool_result's tool_use might be in a kept message - we need to remove that too
        orphanedToolUseIds.add(toolResult.tool_use_id);
      }
    }
  }

  console.log('[removeSelectedMessages] Orphaned tool_use IDs:', Array.from(orphanedToolUseIds));

  // Second pass: build kept messages list
  const kept = [];

  for (const message of messages) {
    if (messagesToRemove.has(message.uuid)) continue;

    // Find the nearest parent that we're keeping
    let parent = message.parentUuid;
    while (parent && messagesToRemove.has(parent)) {
      const parentMessage = messageMap.get(parent);
      if (parentMessage) {
        parent = parentMessage.parentUuid;
      } else {
        break;
      }
    }

    // Create a copy of the message
    const updatedMessage = { ...message };

    // Track if parent was removed (message is now orphaned from its tool_use)
    const parentWasRemoved = parent !== message.parentUuid;

    // Update parentUuid to skip removed messages
    if (parentWasRemoved) {
      updatedMessage.parentUuid = parent;
    }

    // Convert orphaned tool_use/tool_result blocks to text (preserving content but removing tool structure)
    // This handles STANDARD Claude API format (tool_result content blocks)
    if (orphanedToolUseIds.size > 0 && updatedMessage.content) {
      updatedMessage.content = updatedMessage.content.map(block => {
        if (block.type === 'tool_result' && orphanedToolUseIds.has(block.tool_use_id)) {
          // Convert tool_result to text block, preserving the content AND original type
          const content = typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content, null, 2);
          const convertedBlock = { type: 'text', text: content, converted_from: 'tool_result' };
          console.log('[removeSelectedMessages] Converting orphaned tool_result (API format) to text:', {
            tool_use_id: block.tool_use_id,
            convertedBlock: { type: convertedBlock.type, converted_from: convertedBlock.converted_from }
          });
          return convertedBlock;
        }
        if (block.type === 'tool_use' && orphanedToolUseIds.has(block.id)) {
          console.log('[removeSelectedMessages] Converting orphaned tool_use to text:', block.id);
          // Convert tool_use to text block, preserving the reasoning/intent AND original type
          const inputStr = block.input ? JSON.stringify(block.input, null, 2) : '';
          return { type: 'text', text: `[${block.name}]\n${inputStr}`, converted_from: 'tool_use' };
        }
        return block;
      });

      // Remove from toolUses and toolResults arrays (they're now text blocks)
      if (updatedMessage.toolUses) {
        updatedMessage.toolUses = updatedMessage.toolUses.filter(t => !orphanedToolUseIds.has(t.id));
      }
      if (updatedMessage.toolResults) {
        updatedMessage.toolResults = updatedMessage.toolResults.filter(t => !orphanedToolUseIds.has(t.tool_use_id));
      }
    }

    // Handle CLAUDE CODE format: tool results with toolUseResult field (not tool_result content blocks)
    // When parent (tool_use message) is removed, mark text content as converted tool_result
    const hasToolUseResult = updatedMessage.raw?.toolUseResult != null;
    if (parentWasRemoved && hasToolUseResult && updatedMessage.content) {
      console.log('[removeSelectedMessages] Converting orphaned tool_result (Claude Code format):', {
        uuid: updatedMessage.uuid,
        hasToolUseResult: true
      });
      updatedMessage.content = updatedMessage.content.map(block => {
        if (block.type === 'text' && !block.converted_from) {
          return { ...block, converted_from: 'tool_result' };
        }
        return block;
      });
    }

    kept.push(updatedMessage);
  }

  return kept;
}

/**
 * Remove file content from tool results AND tool uses across ALL messages
 */
function removeFileContent(messages, filesToRemove) {
  console.log('[removeFileContent] Files to remove:', Array.from(filesToRemove));

  // First pass: collect ALL tool_use IDs that reference files to remove
  const toolUseIdsToRemove = new Set();

  for (const message of messages) {
    for (const toolUse of message.toolUses || []) {
      if (toolUse.name === 'Read' || toolUse.name === 'Edit' || toolUse.name === 'Write') {
        const filePath = toolUse.input?.file_path;
        if (filePath && filesToRemove.has(filePath)) {
          console.log('[removeFileContent] Marking tool_use for removal:', toolUse.id, toolUse.name, filePath);
          toolUseIdsToRemove.add(toolUse.id);
        }
      } else if (toolUse.name === 'Grep') {
        const filePath = toolUse.input?.path;
        if (filePath && filesToRemove.has(filePath)) {
          console.log('[removeFileContent] Marking Grep tool_use for removal:', toolUse.id, filePath);
          toolUseIdsToRemove.add(toolUse.id);
        }
      }
    }
  }

  console.log('[removeFileContent] Total tool_use IDs to remove:', toolUseIdsToRemove.size);

  // Second pass: remove tool_use and tool_result blocks from ALL messages
  return messages.map(message => {
    // Check if this message has any tool blocks to remove
    const hasToolUseToRemove = (message.toolUses || []).some(t => toolUseIdsToRemove.has(t.id));
    const hasToolResultToRemove = (message.toolResults || []).some(t => toolUseIdsToRemove.has(t.tool_use_id));
    const hasContentToRemove = (message.content || []).some(block =>
      (block.type === 'tool_use' && toolUseIdsToRemove.has(block.id)) ||
      (block.type === 'tool_result' && toolUseIdsToRemove.has(block.tool_use_id))
    );

    if (!hasToolUseToRemove && !hasToolResultToRemove && !hasContentToRemove) {
      return message;
    }

    // Create a copy of the message
    const updated = { ...message };

    // Remove tool_use and tool_result blocks from content
    updated.content = (updated.content || []).filter(block => {
      if (block.type === 'tool_use' && toolUseIdsToRemove.has(block.id)) {
        console.log('[removeFileContent] Removing tool_use block:', block.id);
        return false;
      }
      if (block.type === 'tool_result' && toolUseIdsToRemove.has(block.tool_use_id)) {
        console.log('[removeFileContent] Removing tool_result block for:', block.tool_use_id);
        return false;
      }
      return true;
    });

    // Remove from toolUses array
    updated.toolUses = (updated.toolUses || []).filter(toolUse => {
      return !toolUseIdsToRemove.has(toolUse.id);
    });

    // Remove from toolResults array
    updated.toolResults = (updated.toolResults || []).filter(toolResult => {
      return !toolUseIdsToRemove.has(toolResult.tool_use_id);
    });

    // Update filesReferenced
    updated.filesReferenced = (updated.filesReferenced || []).filter(f => !filesToRemove.has(f));

    return updated;
  });
}

/**
 * Detect message type (tool, tool-result, thinking, assistant, you)
 * Matches frontend logic from SessionEditor.vue
 * Also handles converted blocks that preserve semantic type via converted_from property
 */
function getMessageType(message) {
  const content = Array.isArray(message.content) ? message.content : [];

  // Priority order matches SessionEditor.vue logic
  // 1. Standard Claude API format: tool_result content blocks
  if (content.some(c => c && c.type === 'tool_result')) return 'tool-result';
  // 2. Converted tool_result blocks (preserved semantic type)
  if (content.some(c => c && c.type === 'text' && c.converted_from === 'tool_result')) {
    console.log('[getMessageType] Detected converted tool_result:', message.uuid);
    return 'tool-result';
  }
  // 3. Claude Code format: toolUseResult field at message level
  if (message.raw?.toolUseResult != null) {
    console.log('[getMessageType] Detected toolUseResult field:', message.uuid);
    return 'tool-result';
  }

  if (content.some(c => c && c.type === 'thinking')) return 'thinking';

  // Check for actual tool_use blocks or toolUses array
  if (message.toolUses && message.toolUses.length > 0) return 'tool';
  // Check for converted tool_use blocks (preserved semantic type)
  if (content.some(c => c && c.type === 'text' && c.converted_from === 'tool_use')) return 'tool';

  if (message.type === 'assistant') return 'assistant';

  if (message.type === 'user') {
    // Filter out system messages
    const originalContent = message.raw?.message?.content;
    if (typeof originalContent === 'string') {
      if (
        originalContent.includes('<command-name>') ||
        originalContent.includes('<system-reminder>') ||
        originalContent.includes('<user-prompt-submit-hook>') ||
        originalContent.startsWith('Caveat:')
      ) {
        return null;
      }
    }
    return 'you';
  }

  return null;
}

/**
 * Apply additional sanitization criteria with priority system
 * Priority: Manual selections > Percentage range + Message type filter (REMOVE) > Content criteria
 */
function applySanitizationCriteria(messages, criteria) {
  // PRIORITY 1: Manual selections override everything - REMOVE selected messages
  if (criteria.manuallySelected && criteria.manuallySelected.length > 0) {
    const selectedSet = new Set(criteria.manuallySelected);
    return messages.filter(m => !selectedSet.has(m.uuid));
  }

  let workingSet = [...messages];

  // PRIORITY 2: Apply percentage range (select oldest X%) - mark for potential removal
  let inRangeSet = new Set();
  if (criteria.percentageRange > 0) {
    const sortedByTime = [...workingSet].sort((a, b) =>
      new Date(a.timestamp) - new Date(b.timestamp)
    );
    const cutoffIndex = Math.floor(sortedByTime.length * (criteria.percentageRange / 100));
    inRangeSet = new Set(sortedByTime.slice(0, cutoffIndex).map(m => m.uuid));
  }

  // PRIORITY 3: Message type filter - REMOVE messages of selected types (within range)
  if (criteria.messageTypes && criteria.messageTypes.length > 0) {
    const typesSet = new Set(criteria.messageTypes);
    workingSet = workingSet.filter(m => {
      // If percentage range is set and message is not in range, keep it
      if (criteria.percentageRange > 0 && !inRangeSet.has(m.uuid)) {
        return true; // Keep messages outside the range
      }
      // Check message type - REMOVE if it matches selected types
      const messageType = getMessageType(m);
      const shouldRemove = typesSet.has(messageType);

      // Debug logging for tool results
      if (m.raw?.toolUseResult != null || messageType === 'tool-result') {
        console.log('[applySanitizationCriteria] Tool result detection:', {
          uuid: m.uuid,
          messageType,
          hasToolUseResult: m.raw?.toolUseResult != null,
          hasConvertedFrom: m.content?.some(c => c?.converted_from === 'tool_result'),
          selectedTypes: Array.from(typesSet),
          shouldRemove
        });
      }

      if (shouldRemove) {
        return false; // Remove this message
      }
      return true; // Keep messages that don't match
    });
  }

  // PRIORITY 4: Apply content-based criteria to remaining messages
  return workingSet.map((message, index) => {
    let updated = { ...message };

    // Check if message is in range for content criteria
    const isInRange = criteria.percentageRange === 0 ||
                      criteria.percentageRange === undefined ||
                      inRangeSet.has(message.uuid);

    // Only apply content criteria if in range (or no range specified)
    if (!isInRange) {
      return updated;
    }

    // Remove error tool results
    if (criteria.removeErrors) {
      updated.toolResults = (updated.toolResults || []).filter(result => !result.is_error);
      updated.content = (updated.content || []).filter(block => {
        if (block.type === 'tool_result' && block.is_error) {
          return false;
        }
        return true;
      });
    }

    // Remove verbose assistant text with configurable threshold
    if (criteria.removeVerbose && message.type === 'assistant') {
      const threshold = criteria.verboseThreshold || 500;
      const keepChars = Math.floor(threshold * 0.4);
      updated.content = (updated.content || []).map(block => {
        if (block.type === 'text') {
          if (block.text && block.text.length > threshold) {
            return {
              ...block,
              text: block.text.substring(0, keepChars) + '...\n[verbose content removed for context reduction]'
            };
          }
        }
        return block;
      });
    }

    // Remove duplicate file reads
    if (criteria.removeDuplicateFileReads && index > 0) {
      const prevMessage = workingSet[index - 1];
      if (!prevMessage) return updated;

      // Check if both are Read operations on the same file
      if (
        message.type === 'assistant' &&
        prevMessage.type === 'user' &&
        message.toolUses && message.toolUses.length === 1
      ) {
        const toolUse = message.toolUses[0];
        if (toolUse.name === 'Read') {
          const filePath = toolUse.input?.file_path;

          // Check if previous messages also read this file
          for (let i = index - 2; i >= Math.max(0, index - 5); i--) {
            const checkMessage = workingSet[i];
            if (checkMessage && checkMessage.toolUses &&
              checkMessage.toolUses.some(
                t =>
                  t.name === 'Read' &&
                  t.input?.file_path === filePath
              )
            ) {
              updated.content = (updated.content || []).map(block => {
                if (block.type === 'tool_result') {
                  return {
                    ...block,
                    content: `[Duplicate read of ${filePath} - removed for context reduction]`
                  };
                }
                return block;
              });
              break;
            }
          }
        }
      }
    }

    return updated;
  });
}

/**
 * Convert sanitized messages back to JSONL format
 */
export function messagesToJsonl(messages) {
  return messages.map(msg => {
    // ALWAYS reconstruct from the modified message, never use cached raw
    const raw = reconstructRawRecord(msg);
    return JSON.stringify(raw) + '\n';
  }).join('');
}

/**
 * Convert complete session (with summary, file-history-snapshots, and messages) to JSONL
 */
export function sessionToJsonl(parsed, sanitizedMessages) {
  const lines = [];
  const keptUuids = new Set(sanitizedMessages.map(m => m.uuid));

  // Get the last message UUID for the summary
  const lastMessage = sanitizedMessages[sanitizedMessages.length - 1];
  const leafUuid = lastMessage?.uuid || null;

  // Add summary record (updated with new leafUuid)
  if (parsed.summary) {
    const updatedSummary = {
      ...parsed.summary,
      leafUuid: leafUuid
    };
    lines.push(JSON.stringify(updatedSummary));
  }

  // Add file-history-snapshots that reference kept messages
  for (const snapshot of (parsed.fileHistorySnapshots || [])) {
    // Only keep snapshots that reference messages we're keeping
    if (!snapshot.messageId || keptUuids.has(snapshot.messageId)) {
      lines.push(JSON.stringify(snapshot));
    }
  }

  // Add sanitized messages
  for (const msg of sanitizedMessages) {
    const raw = reconstructRawRecord(msg);
    lines.push(JSON.stringify(raw));
  }

  return lines.join('\n') + '\n';
}

/**
 * Reconstruct a raw record from an enhanced message
 * Preserves original structure and only updates the content
 */
function reconstructRawRecord(message) {
  // Ensure content is valid - filter out any null/undefined entries
  let content = (message.content || []).filter(block => block != null && typeof block === 'object');

  // If content is empty, add a placeholder to avoid API errors
  if (content.length === 0) {
    content = [{ type: 'text', text: '[Content removed during sanitization]' }];
  }

  // If we have the original raw record, use it and just update the content
  if (message.raw) {
    const updated = JSON.parse(JSON.stringify(message.raw)); // Deep clone
    updated.parentUuid = message.parentUuid; // Update parentUuid in case it changed
    if (updated.message) {
      updated.message.content = content;
    }
    return updated;
  }

  // Fallback: reconstruct from scratch (preserving original field order as much as possible)
  return {
    parentUuid: message.parentUuid,
    isSidechain: message.isSidechain,
    userType: message.userType || 'external',
    cwd: message.cwd,
    sessionId: message.sessionId,
    version: message.version,
    gitBranch: message.gitBranch,
    type: message.type,
    message: {
      role: message.type === 'user' ? 'user' : 'assistant',
      content: content,
      model: message.model,
      ...(message.type === 'assistant' && message.tokens && {
        usage: {
          input_tokens: message.tokens.input || 0,
          output_tokens: message.tokens.output || 0,
          cache_read_input_tokens: message.tokens.cacheRead || 0,
          cache_creation_input_tokens: message.tokens.cacheCreation || 0
        }
      })
    },
    uuid: message.uuid,
    timestamp: message.timestamp,
    agentId: message.agentId
  };
}

/**
 * Calculate sanitization impact
 */
export function calculateSanitizationImpact(parsed, options) {
  const sanitized = sanitizeSession(parsed, options);
  const originalTokens = parsed.messages.reduce((sum, m) => sum + m.tokens.total, 0);
  const sanitizedTokens = sanitized.messages.reduce((sum, m) => sum + m.tokens.total, 0);

  return {
    original: {
      messages: parsed.messages.length,
      tokens: originalTokens
    },
    sanitized: {
      messages: sanitized.messages.length,
      tokens: sanitizedTokens
    },
    freed: {
      messages: parsed.messages.length - sanitized.messages.length,
      tokens: originalTokens - sanitizedTokens,
      percentage: ((originalTokens - sanitizedTokens) / originalTokens) * 100
    },
    changes: sanitized.changes
  };
}
