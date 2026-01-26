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

  // Create a working copy of messages in CONVERSATION ORDER (not file order)
  // This is critical for percentage range filtering to work correctly,
  // as messages in the JSONL file may not be in conversation order due to
  // async operations, agent spawns, etc.
  const orderedMessages = getMessageOrder(parsed);

  // Deduplicate messages by UUID - Claude Code sometimes writes duplicate entries
  const seenUuids = new Set();
  const deduplicatedMessages = orderedMessages.filter(m => {
    if (seenUuids.has(m.uuid)) {
      console.log('[sanitizeSession] Skipping duplicate message:', m.uuid);
      return false;
    }
    seenUuids.add(m.uuid);
    return true;
  });

  if (deduplicatedMessages.length !== orderedMessages.length) {
    console.log('[sanitizeSession] Deduplicated messages:', {
      original: orderedMessages.length,
      deduplicated: deduplicatedMessages.length,
      duplicatesRemoved: orderedMessages.length - deduplicatedMessages.length
    });
  }

  let messages = JSON.parse(JSON.stringify(deduplicatedMessages));
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
        // Keep original parentUuid - dangling reference signals continuation
        parent = message.parentUuid;
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
/**
 * Check if a message contains an AskUserQuestion tool call or result
 */
export function hasAskUserQuestion(message) {
  const content = Array.isArray(message.content) ? message.content : [];

  // Check for AskUserQuestion tool_use
  for (const block of content) {
    if (block?.type === 'tool_use' && block?.name === 'AskUserQuestion') {
      return true;
    }
    // Check for tool_result with AskUserQuestion in the tool_use_id context
    // The tool_use_id links to the original AskUserQuestion call
    if (block?.type === 'tool_result') {
      // We need to check if this result is for an AskUserQuestion
      // Look at the message's sourceToolAssistantUUID or toolUseResult
      if (message.raw?.toolUseResult?.questions) {
        return true;  // AskUserQuestion results have a 'questions' field
      }
    }
  }

  // Check toolUses array (Claude Code format)
  if (message.toolUses) {
    for (const toolUse of message.toolUses) {
      if (toolUse.name === 'AskUserQuestion') {
        return true;
      }
    }
  }

  // Check for AskUserQuestion result in Claude Code format
  if (message.raw?.toolUseResult?.questions || message.raw?.toolUseResult?.answers) {
    return true;
  }

  return false;
}

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
  let workingSet = [...messages];

  // Determine the "in range" set - either from manual selection or percentage range
  // Manual selection takes priority over percentage range
  let inRangeSet = new Set();

  if (criteria.manuallySelected && criteria.manuallySelected.length > 0) {
    // MANUAL SELECTION MODE: Apply settings only to selected messages
    // (percentage range is ignored when using manual selection)
    inRangeSet = new Set(criteria.manuallySelected);

    console.log('[applySanitizationCriteria] Manual selection mode:', {
      selectedCount: inRangeSet.size,
      totalMessages: workingSet.length
    });
  } else if (criteria.percentageRange > 0) {
    // PERCENTAGE RANGE MODE: Apply settings to first X% of messages by position
    // NOTE: We use message position order, NOT timestamp order, because:
    // - Messages are displayed in conversation order (parent-child chain)
    // - Timestamps can be out of order (agents, async tool results, clock differences)
    // - Users expect "oldest 90%" to mean "first 90% of the conversation"
    const cutoffIndex = Math.floor(workingSet.length * (criteria.percentageRange / 100));
    inRangeSet = new Set(workingSet.slice(0, cutoffIndex).map(m => m.uuid));

    console.log('[applySanitizationCriteria] Percentage range calculation:', {
      percentageRange: criteria.percentageRange,
      totalMessages: workingSet.length,
      cutoffIndex,
      inRangeCount: inRangeSet.size,
      firstInRangeTimestamp: workingSet[0]?.timestamp,
      lastInRangeTimestamp: workingSet[cutoffIndex - 1]?.timestamp,
      firstOutOfRangeTimestamp: workingSet[cutoffIndex]?.timestamp
    });
  }

  // If no range specified at all, apply to all messages
  const hasRangeFilter = inRangeSet.size > 0;

  // PRIORITY 2: Message type filter - REMOVE messages of selected types (within range)
  if (criteria.messageTypes && criteria.messageTypes.length > 0) {
    const typesSet = new Set(criteria.messageTypes);
    const beforeFilter = workingSet.length;
    const preserveAskUserQuestion = criteria.preserveAskUserQuestion !== false;

    workingSet = workingSet.filter(m => {
      // If a range filter is active (manual selection or percentage) and message is not in range, keep it
      if (hasRangeFilter && !inRangeSet.has(m.uuid)) {
        return true; // Keep messages outside the range
      }

      // Check message type - REMOVE if it matches selected types
      const messageType = getMessageType(m);
      let shouldRemove = typesSet.has(messageType);

      // Preserve AskUserQuestion tool calls even when removing other tools
      if (shouldRemove && preserveAskUserQuestion && (messageType === 'tool' || messageType === 'tool-result')) {
        if (hasAskUserQuestion(m)) {
          console.log('[applySanitizationCriteria] Preserving AskUserQuestion:', m.uuid);
          shouldRemove = false;
        }
      }

      // Debug logging
      if (hasRangeFilter) {
        console.log('[applySanitizationCriteria] Message filtering decision:', {
          uuid: m.uuid,
          timestamp: m.timestamp,
          messageType,
          inRange: inRangeSet.has(m.uuid),
          selectedTypes: Array.from(typesSet),
          shouldRemove,
          action: shouldRemove ? 'REMOVE' : 'KEEP'
        });
      }

      if (shouldRemove) {
        return false; // Remove this message
      }
      return true; // Keep messages that don't match
    });

    console.log('[applySanitizationCriteria] Message type filtering result:', {
      beforeFilter,
      afterFilter: workingSet.length,
      removedCount: beforeFilter - workingSet.length,
      hasRangeFilter,
      inRangeSetSize: inRangeSet.size
    });

    // Update parentUuid chains for remaining messages to skip removed messages
    // This prevents orphaned roots that Claude Code interprets as session boundaries
    if (beforeFilter !== workingSet.length) {
      // Build a map of all original messages (before filtering) to walk parent chains
      const originalMessageMap = new Map(messages.map(m => [m.uuid, m]));
      // Build a set of kept message UUIDs for quick lookup
      const keptUuids = new Set(workingSet.map(m => m.uuid));

      workingSet = workingSet.map(m => {
        // If parentUuid is null or points to a kept message, no update needed
        if (!m.parentUuid || keptUuids.has(m.parentUuid)) {
          return m;
        }

        // Walk up the parent chain to find the nearest kept ancestor
        let parent = m.parentUuid;
        while (parent && !keptUuids.has(parent)) {
          const parentMessage = originalMessageMap.get(parent);
          if (parentMessage) {
            parent = parentMessage.parentUuid;
          } else {
            // Parent not found in original messages, keep original parentUuid
            // (dangling reference may signal continuation from external context)
            parent = m.parentUuid;
            break;
          }
        }

        // Only update if we found a different ancestor
        if (parent !== m.parentUuid) {
          console.log('[applySanitizationCriteria] Updating parentUuid chain:', {
            uuid: m.uuid,
            oldParent: m.parentUuid,
            newParent: parent
          });
          return { ...m, parentUuid: parent };
        }

        return m;
      });
    }
  }

  // PRIORITY 3: Apply content-based criteria to remaining messages
  return workingSet.map((message, index) => {
    let updated = { ...message };

    // Check if message is in range for content criteria
    // If no range filter, apply to all; otherwise only apply to messages in range
    const isInRange = !hasRangeFilter || inRangeSet.has(message.uuid);

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

  // Determine the leafUuid - preserve original if it still exists, otherwise fall back to last message
  // This is critical for preserving the conversation branch the user was on.
  // The conversation is a tree with potentially multiple branches, and the leafUuid
  // marks which branch is the "current" one. Blindly using the last message in the
  // array would switch to a different branch if deduplication changed the order.
  const originalLeafUuid = parsed.summary?.leafUuid;
  const originalLeafExists = originalLeafUuid && keptUuids.has(originalLeafUuid);
  const lastMessage = sanitizedMessages[sanitizedMessages.length - 1];
  const leafUuid = originalLeafExists ? originalLeafUuid : (lastMessage?.uuid || null);


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

    // CRITICAL: Remove imagePasteIds if images have been extracted to file references
    // This prevents Claude Code from thinking images are "missing" and duplicating messages
    if (updated.imagePasteIds) {
      const contentStr = JSON.stringify(content);
      if (contentStr.includes('[Image extracted:')) {
        console.log(`[reconstructRawRecord] Removing imagePasteIds from message ${message.uuid} (images already extracted)`);
        delete updated.imagePasteIds;
      }
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

/**
 * Normalize content to a consistent format for comparison.
 * Handles both string content and array content formats:
 * - String: "hello" -> [{type:"text",text:"hello"}]
 * - Array: [{type:"text",text:"hello"}] -> kept as-is
 *
 * IMPORTANT: Filters out image blocks for comparison since Claude Code
 * sometimes splits text+image into separate entries when duplicating.
 * This allows detecting duplicates where original has text+image but
 * duplicate has them split into separate messages.
 */
function normalizeContent(content) {
  if (typeof content === 'string') {
    // Convert plain string to array format
    return [{ type: 'text', text: content }];
  }

  if (Array.isArray(content)) {
    // Normalize each item, filtering out images for comparison
    const normalized = [];

    for (const item of content) {
      if (typeof item === 'string') {
        normalized.push({ type: 'text', text: item });
        continue;
      }

      // Skip image blocks - they cause false negatives when duplicates split text+image
      if (item.type === 'image' || item.type === 'image_url') {
        continue;
      }

      // For content blocks, extract just the comparable fields
      // This handles variations in metadata while keeping core content
      if (item.type === 'text') {
        normalized.push({ type: 'text', text: item.text });
      } else if (item.type === 'thinking') {
        normalized.push({ type: 'thinking', thinking: item.thinking });
      } else if (item.type === 'tool_use') {
        normalized.push({ type: 'tool_use', name: item.name, input: item.input });
      } else if (item.type === 'tool_result') {
        normalized.push({ type: 'tool_result', tool_use_id: item.tool_use_id, content: item.content });
      } else {
        // For other types, keep as-is but remove variable fields
        const { id, ...rest } = item;
        normalized.push(rest);
      }
    }

    return normalized;
  }

  return content;
}

/**
 * Create a content key for duplicate detection
 * Normalizes content format before comparison to catch duplicates
 * where the same text is stored in different formats.
 */
function getContentKey(message) {
  // Get the raw content for comparison
  const content = message.raw?.message?.content || message.content;

  // If no content (e.g., system metadata messages), use UUID to make it unique
  // This prevents all no-content messages from being grouped as duplicates
  if (content === undefined || content === null) {
    return `__no_content__${message.uuid}`;
  }

  // Normalize the content to handle format differences
  const normalized = normalizeContent(content);

  // If normalized is empty (image-only message), use UUID to make it unique
  // This prevents all image-only messages from matching each other
  if (Array.isArray(normalized) && normalized.length === 0) {
    return `__image_only__${message.uuid}`;
  }

  // Stringify the normalized content for comparison
  try {
    return JSON.stringify(normalized);
  } catch (e) {
    // Fallback to UUID if content can't be stringified
    return message.uuid;
  }
}

/**
 * Find duplicate messages in a session
 *
 * IMPORTANT: Only flags duplicates that are part of a "block" - meaning they have
 * at least one adjacent duplicate (before or after in conversation order).
 * This distinguishes true bugs (where Claude Code writes duplicate sequences)
 * from legitimate repeated prompts (user typing "still not working" twice).
 *
 * @param {Array} messages - Array of message objects
 * @param {string} leafUuid - Optional UUID of the leaf message. If provided, when the leaf
 *                            message is part of a duplicate group, we keep it instead of
 *                            the newest duplicate. This preserves the conversation chain.
 *
 * Returns an object with:
 * - duplicateGroups: Array of groups, each containing UUIDs of duplicate messages
 * - duplicateUuids: Set of all UUIDs that are duplicates (not the original/oldest)
 * - totalDuplicates: Count of duplicate messages (excluding originals)
 * - isolatedDuplicates: Count of isolated duplicates that were NOT flagged (likely intentional)
 */
export function findDuplicateMessages(messages, leafUuid = null) {

  // Build position index for adjacency checking
  const uuidToIndex = new Map();
  messages.forEach((m, idx) => uuidToIndex.set(m.uuid, idx));

  // Build message map for parent chain traversal
  const messageMap = new Map(messages.map(m => [m.uuid, m]));

  // CRITICAL: Build the set of UUIDs in the leaf's parent chain - these MUST be protected
  // The conversation chain from leaf to root is the "active" branch that must be preserved
  const leafChainUuids = new Set();
  if (leafUuid) {
    let current = leafUuid;
    while (current && messageMap.has(current)) {
      leafChainUuids.add(current);
      current = messageMap.get(current).parentUuid;
    }
  }

  // Group messages by content key
  const contentGroups = new Map();

  for (const message of messages) {
    const key = getContentKey(message);

    if (!contentGroups.has(key)) {
      contentGroups.set(key, []);
    }
    contentGroups.get(key).push(message);
  }

  // First pass: identify ALL potential duplicates (content matches)
  const allPotentialDuplicateUuids = new Set();

  for (const [key, group] of contentGroups) {
    if (group.length > 1) {
      // Check if any message in this group is in the leaf chain (must be protected)
      const chainMessageInGroup = group.find(m => leafChainUuids.has(m.uuid));

      if (chainMessageInGroup) {
        // CRITICAL: A message from the leaf chain is in this duplicate group - we MUST keep it
        // to preserve the conversation chain. Mark all others as duplicates.
        for (const message of group) {
          if (message.uuid !== chainMessageInGroup.uuid) {
            allPotentialDuplicateUuids.add(message.uuid);
          }
        }
      } else {
        // No chain message in this group - sort by timestamp DESCENDING to find the newest
        // IMPORTANT: We keep the NEWEST duplicate, not the oldest, because:
        // Claude Code's active conversation state references the most recent UUIDs.
        // If we remove those, Claude Code will recreate them when the session is resumed.
        group.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Mark all except the newest as potential duplicates
        for (let i = 1; i < group.length; i++) {
          allPotentialDuplicateUuids.add(group[i].uuid);
        }
      }
    }
  }

  // Identify image-only messages (they have unique keys starting with __image_only__)
  const imageOnlyUuids = new Set();
  for (const message of messages) {
    const key = getContentKey(message);
    if (key.startsWith('__image_only__')) {
      imageOnlyUuids.add(message.uuid);
    }
  }

  // Second pass: filter to only duplicates that are part of a block
  // A duplicate is part of a block if the message immediately before or after it
  // (in conversation order) is also a potential duplicate OR an image-only message
  // (image-only messages bridge the gap in split text+image duplicates)
  const blockDuplicateUuids = new Set();

  for (const uuid of allPotentialDuplicateUuids) {
    const idx = uuidToIndex.get(uuid);

    // Check if previous message is also a duplicate or image-only
    const prevUuid = idx > 0 ? messages[idx - 1].uuid : null;
    const prevIsDuplicate = prevUuid && allPotentialDuplicateUuids.has(prevUuid);
    const prevIsImageOnly = prevUuid && imageOnlyUuids.has(prevUuid);

    // Check if next message is also a duplicate or image-only
    const nextUuid = idx < messages.length - 1 ? messages[idx + 1].uuid : null;
    const nextIsDuplicate = nextUuid && allPotentialDuplicateUuids.has(nextUuid);
    const nextIsImageOnly = nextUuid && imageOnlyUuids.has(nextUuid);

    // Only flag if part of a block (has adjacent duplicate or image-only)
    if (prevIsDuplicate || nextIsDuplicate || prevIsImageOnly || nextIsImageOnly) {
      blockDuplicateUuids.add(uuid);
    }
  }

  // Third pass: flag image-only messages that are adjacent to block duplicates
  // These are likely split images from duplicated text+image messages
  // IMPORTANT: Skip messages in the leaf chain - they must be protected
  for (const uuid of imageOnlyUuids) {
    // Skip if in the protected leaf chain
    if (leafChainUuids.has(uuid)) {
      continue;
    }

    const idx = uuidToIndex.get(uuid);

    // Check if previous message is a block duplicate
    const prevUuid = idx > 0 ? messages[idx - 1].uuid : null;
    const prevIsBlockDuplicate = prevUuid && blockDuplicateUuids.has(prevUuid);

    // Check if next message is a block duplicate
    const nextUuid = idx < messages.length - 1 ? messages[idx + 1].uuid : null;
    const nextIsBlockDuplicate = nextUuid && blockDuplicateUuids.has(nextUuid);

    // Flag image-only message if adjacent to a block duplicate
    if (prevIsBlockDuplicate || nextIsBlockDuplicate) {
      blockDuplicateUuids.add(uuid);
    }
  }

  // Build final duplicate groups (only for block duplicates)
  const duplicateGroups = [];
  const duplicateUuids = new Set();

  for (const [key, group] of contentGroups) {
    if (group.length > 1) {
      // Check if any message in this group is in the leaf chain (must be protected)
      const chainMessageInGroup = group.find(m => leafChainUuids.has(m.uuid));

      // Determine which message to keep as "original"
      let original;
      if (chainMessageInGroup) {
        // Keep the leaf chain message
        original = chainMessageInGroup;
      } else {
        // Sort by timestamp DESCENDING to find the newest (to keep)
        group.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        original = group[0];
      }

      // All others in the group (that are block duplicates and not the original) are duplicates to remove
      const duplicates = group.filter(d => d.uuid !== original.uuid && blockDuplicateUuids.has(d.uuid));

      // Only create a group if there are block duplicates
      if (duplicates.length > 0) {
        duplicateGroups.push({
          originalUuid: original.uuid,
          originalTimestamp: original.timestamp,
          duplicateUuids: duplicates.map(d => d.uuid),
          duplicateTimestamps: duplicates.map(d => d.timestamp),
          count: duplicates.length + 1, // +1 for original
          messageType: original.type
        });

        // Add duplicate UUIDs to the set
        for (const dup of duplicates) {
          duplicateUuids.add(dup.uuid);
        }
      }
    }
  }

  // Add image-only duplicates that were flagged (they won't be in any group)
  for (const uuid of imageOnlyUuids) {
    if (blockDuplicateUuids.has(uuid)) {
      duplicateUuids.add(uuid);
    }
  }

  const isolatedCount = allPotentialDuplicateUuids.size - blockDuplicateUuids.size;

  return {
    duplicateGroups,
    duplicateUuids,
    totalDuplicates: duplicateUuids.size,
    isolatedDuplicates: isolatedCount
  };
}

/**
 * Remove duplicate messages from a session
 * Returns the deduplicated messages array with updated parent chains
 *
 * @param {Array} messages - Array of message objects
 * @param {string} leafUuid - Optional UUID of the leaf message. If provided, when the leaf
 *                            message is part of a duplicate group, we keep it to preserve
 *                            the conversation chain.
 */
export function deduplicateMessages(messages, leafUuid = null) {
  const { duplicateUuids } = findDuplicateMessages(messages, leafUuid);

  if (duplicateUuids.size === 0) {
    return messages; // No duplicates found
  }


  // Build a map of all messages for parent chain traversal
  const messageMap = new Map(messages.map(m => [m.uuid, m]));

  // Build set of kept message UUIDs
  const keptUuids = new Set(messages.filter(m => !duplicateUuids.has(m.uuid)).map(m => m.uuid));

  // Filter and update parent chains
  const result = [];

  for (const message of messages) {
    if (duplicateUuids.has(message.uuid)) {
      continue; // Skip duplicates
    }

    // Check if parent was removed and needs updating
    if (message.parentUuid && duplicateUuids.has(message.parentUuid)) {
      // The parent was a duplicate that got removed.
      // Walk up the parent chain to find the nearest kept ancestor.
      // IMPORTANT: We do NOT redirect to a "kept duplicate with same content" because
      // that duplicate might be on a different branch, breaking the conversation chain.
      let newParent = null;
      let current = message.parentUuid;

      while (current) {
        // Check if current is kept
        if (keptUuids.has(current)) {
          newParent = current;
          break;
        }

        const currentMessage = messageMap.get(current);
        if (!currentMessage) {
          // Message not in file (orphan reference), keep original parentUuid
          newParent = message.parentUuid;
          break;
        }

        if (!currentMessage.parentUuid) {
          // Reached root without finding kept ancestor
          newParent = null;
          break;
        }

        current = currentMessage.parentUuid;
      }

      result.push({ ...message, parentUuid: newParent });
    } else {
      result.push(message);
    }
  }

  return result;
}

/**
 * Extract embedded base64 images from messages and save them to disk.
 * Replaces base64 data with file path references.
 *
 * @param {Array} messages - Array of enhanced message objects
 * @param {string} sessionId - Session ID for organizing saved images
 * @param {string} imagesDir - Base directory for saving images (defaults to ~/.claude/images)
 * @returns {Object} { messages: transformedMessages, extractedCount: number, savedPaths: string[] }
 */
export async function extractAndReplaceImages(messages, sessionId, imagesDir = null) {
  const os = await import('os');
  const path = await import('path');
  const fs = await import('fs-extra');

  // Default to ~/.claude/images/{sessionId}/
  const baseDir = imagesDir || path.default.join(os.default.homedir(), '.claude', 'images');
  const sessionImagesDir = path.default.join(baseDir, sessionId);

  let extractedCount = 0;
  const savedPaths = [];
  const transformedMessages = [];

  // Media type to extension mapping
  const mediaTypeToExt = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg'
  };

  for (const message of messages) {
    // Deep clone the message to avoid mutating original
    const transformedMessage = JSON.parse(JSON.stringify(message));
    let messageModified = false;

    // Process content array for embedded images
    if (transformedMessage.content && Array.isArray(transformedMessage.content)) {
      for (let i = 0; i < transformedMessage.content.length; i++) {
        const block = transformedMessage.content[i];

        // Handle direct image blocks in content
        if (block && block.type === 'image' && block.source?.type === 'base64' && block.source?.data) {
          try {
            const result = await saveBase64Image(
              block.source.data,
              block.source.media_type,
              message.uuid,
              i,
              sessionImagesDir,
              mediaTypeToExt,
              fs,
              path
            );

            if (result) {
              // Replace the image block with a text reference
              // Using text instead of source.type="file" because Claude API only accepts base64 or url
              // The web interface can detect this pattern and display the actual image
              transformedMessage.content[i] = {
                type: 'text',
                text: `[Image extracted: file://${result.filePath}]`
              };

              extractedCount++;
              savedPaths.push(result.filePath);
              messageModified = true;
              console.log(`[extractAndReplaceImages] Extracted image from message ${message.uuid} (block ${i}) -> ${result.filePath}`);
            }
          } catch (err) {
            console.error(`[extractAndReplaceImages] Failed to save image from message ${message.uuid}:`, err.message);
          }
        }

        // Handle old format text references: [Image: source: /path/to/image.png]
        // Convert to new format: [Image extracted: file:///path/to/image.png]
        if (block && block.type === 'text' && typeof block.text === 'string') {
          const oldFormatMatch = block.text.match(/\[Image: source: ([^\]]+)\]/);
          if (oldFormatMatch) {
            const imagePath = oldFormatMatch[1].trim();
            // Ensure path has file:// prefix
            const filePath = imagePath.startsWith('file://') ? imagePath : `file://${imagePath}`;
            transformedMessage.content[i] = {
              type: 'text',
              text: `[Image extracted: ${filePath}]`
            };
            messageModified = true;
            extractedCount++;
            console.log(`[extractAndReplaceImages] Converted old format image reference: ${imagePath}`);
          }

          // Also mark as modified if message already has extracted images but still has imagePasteIds
          // This cleans up messages that were extracted before we added imagePasteIds clearing
          // Note: imagePasteIds is in raw since that's where the original record fields are stored
          if (block.text.includes('[Image extracted:') && transformedMessage.raw?.imagePasteIds) {
            messageModified = true;
          }
        }

        // Handle images inside tool_result blocks
        if (block && block.type === 'tool_result' && block.content) {
          const toolResultContent = Array.isArray(block.content) ? block.content : [block.content];
          let toolResultModified = false;

          for (let j = 0; j < toolResultContent.length; j++) {
            const innerBlock = toolResultContent[j];

            if (innerBlock && innerBlock.type === 'image' && innerBlock.source?.type === 'base64' && innerBlock.source?.data) {
              try {
                const result = await saveBase64Image(
                  innerBlock.source.data,
                  innerBlock.source.media_type,
                  message.uuid,
                  `${i}_${j}`,
                  sessionImagesDir,
                  mediaTypeToExt,
                  fs,
                  path
                );

                if (result) {
                  // Replace the image block with a text reference
                  // Using text instead of source.type="file" because Claude API only accepts base64 or url
                  toolResultContent[j] = {
                    type: 'text',
                    text: `[Image extracted: file://${result.filePath}]`
                  };

                  extractedCount++;
                  savedPaths.push(result.filePath);
                  toolResultModified = true;
                  console.log(`[extractAndReplaceImages] Extracted image from tool_result in message ${message.uuid} (block ${i}.${j}) -> ${result.filePath}`);
                }
              } catch (err) {
                console.error(`[extractAndReplaceImages] Failed to save image from tool_result in message ${message.uuid}:`, err.message);
              }
            }
          }

          if (toolResultModified) {
            // Update the tool_result content
            if (Array.isArray(block.content)) {
              transformedMessage.content[i].content = toolResultContent;
            } else {
              transformedMessage.content[i].content = toolResultContent[0];
            }
            messageModified = true;
          }
        }
      }

      // CRITICAL: Merge consecutive text blocks into one
      // Claude Code doesn't handle multiple consecutive text blocks well - it may trigger duplication
      // After image extraction, [text, image] becomes [text, text] which causes issues
      // We merge them into a single text block: [text]
      if (messageModified && Array.isArray(transformedMessage.content)) {
        const mergedContent = [];
        let pendingText = null;

        for (const block of transformedMessage.content) {
          if (block && block.type === 'text') {
            if (pendingText === null) {
              pendingText = block.text || '';
            } else {
              // Merge with previous text block, using newline separator
              pendingText += '\n\n' + (block.text || '');
            }
          } else {
            // Non-text block - flush pending text first
            if (pendingText !== null) {
              mergedContent.push({ type: 'text', text: pendingText });
              pendingText = null;
            }
            mergedContent.push(block);
          }
        }

        // Flush any remaining text
        if (pendingText !== null) {
          mergedContent.push({ type: 'text', text: pendingText });
        }

        // Only update if we actually merged something
        if (mergedContent.length < transformedMessage.content.length) {
          console.log(`[extractAndReplaceImages] Merged ${transformedMessage.content.length} blocks into ${mergedContent.length} for message ${message.uuid}`);
          transformedMessage.content = mergedContent;
        }
      }
    }

    // Handle plain string content with old format: [Image: source: /path]
    if (transformedMessage.content && typeof transformedMessage.content === 'string') {
      const oldFormatRegex = /\[Image: source: ([^\]]+)\]/g;
      let match;
      let newContent = transformedMessage.content;
      let stringModified = false;

      while ((match = oldFormatRegex.exec(transformedMessage.content)) !== null) {
        const imagePath = match[1].trim();
        const filePath = imagePath.startsWith('file://') ? imagePath : `file://${imagePath}`;
        newContent = newContent.replace(match[0], `[Image extracted: ${filePath}]`);
        stringModified = true;
        extractedCount++;
        console.log(`[extractAndReplaceImages] Converted old format in string content: ${imagePath}`);
      }

      if (stringModified) {
        transformedMessage.content = newContent;
        messageModified = true;
      }
    }

    // Also update the raw record if message was modified
    if (messageModified && transformedMessage.raw?.message?.content) {
      // Reconstruct raw.message.content from transformed content
      transformedMessage.raw.message.content = transformedMessage.content;
    }

    // CRITICAL: Clear imagePasteIds when images are extracted
    // This field tells Claude Code that images were pasted - if we've converted them to text references,
    // Claude Code will try to "restore" missing images and cause duplication
    if (messageModified) {
      if (transformedMessage.imagePasteIds) {
        console.log(`[extractAndReplaceImages] Clearing imagePasteIds for message ${message.uuid}: ${JSON.stringify(transformedMessage.imagePasteIds)}`);
        delete transformedMessage.imagePasteIds;
      }
      if (transformedMessage.raw?.imagePasteIds) {
        delete transformedMessage.raw.imagePasteIds;
      }
    }

    // Handle Claude Code-specific toolUseResult field (contains image data in a different format)
    // Format: { type: 'image', file: { base64: '...', type: '...', numLines: ..., etc } }
    // IMPORTANT: Preserve the file object structure - Claude Code expects file.numLines to exist
    if (transformedMessage.raw?.toolUseResult?.type === 'image' && transformedMessage.raw?.toolUseResult?.file?.base64) {
      // Find the corresponding saved path for this message (tool_result image)
      const savedPath = savedPaths.find(p => p.includes(message.uuid));
      if (savedPath) {
        // Preserve the file object structure but remove base64 data
        // Claude Code's internal code expects toolUseResult.file to exist with properties like numLines
        transformedMessage.raw.toolUseResult = {
          ...transformedMessage.raw.toolUseResult,
          file: {
            ...transformedMessage.raw.toolUseResult.file,
            base64: null,  // Remove the large base64 data
            extractedPath: savedPath  // Reference to saved location
          }
        };
        console.log(`[extractAndReplaceImages] Updated toolUseResult for message ${message.uuid} -> ${savedPath}`);
      }
    }

    transformedMessages.push(transformedMessage);
  }

  return {
    messages: transformedMessages,
    extractedCount,
    savedPaths
  };
}

/**
 * Helper function to save a base64 image to disk
 */
async function saveBase64Image(base64Data, mediaType, messageUuid, index, sessionImagesDir, mediaTypeToExt, fs, path) {
  // Get file extension from media type
  const ext = mediaTypeToExt[mediaType] || '.png';

  // Create filename: {messageUuid}_{index}{ext}
  const filename = `${messageUuid}_${index}${ext}`;
  const filePath = path.default.join(sessionImagesDir, filename);

  // Ensure directory exists
  await fs.default.ensureDir(sessionImagesDir);

  // Decode base64 and save
  const buffer = Buffer.from(base64Data, 'base64');
  await fs.default.writeFile(filePath, buffer);

  return {
    filePath,
    filename,
    size: buffer.length
  };
}
