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
 * Remove selected messages while maintaining thread integrity
 */
function removeSelectedMessages(messages, messagesToRemove, messageGraph) {
  const messageMap = new Map(messages.map(m => [m.uuid, m]));

  // Find messages to keep
  const kept = [];
  const parentMap = new Map();

  // Build parent mapping for messages we're keeping
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

    // Update parentUuid to skip removed messages
    const updatedMessage = { ...message };
    if (parent !== message.parentUuid) {
      updatedMessage.parentUuid = parent;
    }

    kept.push(updatedMessage);
  }

  return kept;
}

/**
 * Remove file content from tool results
 */
function removeFileContent(messages, filesToRemove) {
  return messages.map(message => {
    // Check if this message references any files to remove
    const hasRemovedFiles = message.filesReferenced.some(f => filesToRemove.has(f));

    if (!hasRemovedFiles) {
      return message;
    }

    // Create a copy of the message
    const updated = { ...message };

    // Filter content blocks
    updated.content = (updated.content || []).filter(block => {
      if (block.type === 'tool_result') {
        // Check if this tool result is related to a file being removed
        const toolId = block.tool_use_id;
        const toolUse = message.toolUses.find(t => t.id === toolId);

        if (toolUse && toolUse.name === 'Read') {
          const filePath = toolUse.input?.file_path;
          if (filePath && filesToRemove.has(filePath)) {
            // Replace content with placeholder, but keep structure
            return {
              ...block,
              content: `[Content of ${filePath} removed for context reduction]`,
              is_error: false
            };
          }
        } else if (toolUse && toolUse.name === 'Grep') {
          const filePath = toolUse.input?.path;
          if (filePath && filesToRemove.has(filePath)) {
            return {
              ...block,
              content: `[Grep results for ${filePath} removed for context reduction]`,
              is_error: false
            };
          }
        }
      }

      return block;
    });

    // Update tool results
    updated.toolResults = updated.toolResults.filter(toolResult => {
      const toolId = toolResult.tool_use_id;
      const toolUse = updated.toolUses.find(t => t.id === toolId);

      if (toolUse && (toolUse.name === 'Read' || toolUse.name === 'Grep')) {
        const filePath = toolUse.input?.file_path || toolUse.input?.path;
        if (filePath && filesToRemove.has(filePath)) {
          return false; // Remove this tool result
        }
      }

      return true;
    });

    return updated;
  });
}

/**
 * Apply additional sanitization criteria
 */
function applySanitizationCriteria(messages, criteria) {
  return messages.map((message, index) => {
    let updated = { ...message };

    // Remove error tool results
    if (criteria.removeErrors) {
      updated.toolResults = updated.toolResults.filter(result => !result.is_error);
      updated.content = (updated.content || []).filter(block => {
        if (block.type === 'tool_result' && block.is_error) {
          return false;
        }
        return true;
      });
    }

    // Remove verbose assistant text (keep only short summaries)
    if (criteria.removeVerbose && message.type === 'assistant') {
      updated.content = (updated.content || []).map(block => {
        if (block.type === 'text') {
          // Keep only first 200 chars if verbose
          if (block.text && block.text.length > 500) {
            return {
              ...block,
              text: block.text.substring(0, 200) + '...\n[verbose content removed for context reduction]'
            };
          }
        }
        return block;
      });
    }

    // Remove duplicate file reads
    if (criteria.removeDuplicateFileReads && index > 0) {
      const prevMessage = messages[index - 1];

      // Check if both are Read operations on the same file
      if (
        message.type === 'assistant' &&
        prevMessage.type === 'user' &&
        message.toolUses.length === 1
      ) {
        const toolUse = message.toolUses[0];
        if (toolUse.name === 'Read') {
          const filePath = toolUse.input?.file_path;

          // Check if previous messages also read this file
          for (let i = index - 2; i >= Math.max(0, index - 5); i--) {
            const checkMessage = messages[i];
            if (
              checkMessage.toolUses.some(
                t =>
                  t.name === 'Read' &&
                  t.input?.file_path === filePath
              )
            ) {
              // Mark this message for removal? Or just skip
              // For now, we'll keep it but remove the content
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
    // Reconstruct the raw record from the enhanced message
    const raw = msg.raw || reconstructRawRecord(msg);
    return JSON.stringify(raw) + '\n';
  }).join('');
}

/**
 * Reconstruct a raw record from an enhanced message
 */
function reconstructRawRecord(message) {
  return {
    uuid: message.uuid,
    parentUuid: message.parentUuid,
    type: message.type,
    sessionId: message.sessionId,
    agentId: message.agentId,
    isSidechain: message.isSidechain,
    timestamp: message.timestamp,
    cwd: message.cwd,
    gitBranch: message.gitBranch,
    version: message.version,
    message: {
      role: message.type === 'user' ? 'user' : 'assistant',
      content: message.content,
      model: message.model,
      ...(message.type === 'assistant' && {
        usage: {
          input_tokens: message.tokens.input,
          output_tokens: message.tokens.output,
          cache_read_input_tokens: message.tokens.cacheRead,
          cache_creation_input_tokens: message.tokens.cacheCreation
        }
      })
    }
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
