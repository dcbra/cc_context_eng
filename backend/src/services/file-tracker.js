/**
 * Track files read during a session
 * Groups file references by path and tracks read order and content size
 */
export function trackFilesInSession(messages) {
  const filesMap = new Map();

  for (const message of messages) {
    // Get tool results with file content
    for (const toolResult of message.toolResults) {
      // Extract associated tool use
      const toolId = toolResult.tool_use_id;
      const toolUse = message.toolUses.find(t => t.id === toolId);

      if (toolUse && toolUse.name === 'Read') {
        const filePath = toolUse.input?.file_path;
        if (filePath) {
          recordFileRead(filesMap, filePath, message, toolUse, toolResult);
        }
      } else if (toolUse && toolUse.name === 'Grep') {
        const filePath = toolUse.input?.path;
        if (filePath) {
          recordFileRead(filesMap, filePath, message, toolUse, toolResult);
        }
      } else if (toolUse && toolUse.name === 'Bash') {
        // Extract files from bash command (if any)
        const command = toolUse.input?.command || '';
        const extractedFiles = extractFilesFromBashCommand(command);
        for (const filePath of extractedFiles) {
          recordFileRead(filesMap, filePath, message, toolUse, toolResult);
        }
      }
    }

    // Also check tool uses for file references even without results
    for (const toolUse of message.toolUses) {
      if (toolUse.name === 'Read' && toolUse.input?.file_path) {
        const filePath = toolUse.input.file_path;
        recordFileRead(filesMap, filePath, message, toolUse, null);
      } else if (toolUse.name === 'Edit' && toolUse.input?.file_path) {
        const filePath = toolUse.input.file_path;
        recordFileRead(filesMap, filePath, message, toolUse, null);
      } else if (toolUse.name === 'Write' && toolUse.input?.file_path) {
        const filePath = toolUse.input.file_path;
        recordFileRead(filesMap, filePath, message, toolUse, null);
      }
    }
  }

  // Convert map to array and sort
  const files = Array.from(filesMap.values());
  files.sort((a, b) => b.lastReadTimestamp.getTime() - a.lastReadTimestamp.getTime());

  return files;
}

/**
 * Record a file read instance
 */
function recordFileRead(filesMap, filePath, message, toolUse, toolResult) {
  if (!filesMap.has(filePath)) {
    filesMap.set(filePath, {
      path: filePath,
      readCount: 0,
      instances: [],
      totalContentSize: 0,
      firstReadTimestamp: new Date(message.timestamp),
      lastReadTimestamp: new Date(message.timestamp)
    });
  }

  const file = filesMap.get(filePath);
  const contentSize = toolResult?.content ? String(toolResult.content).length : 0;

  file.instances.push({
    messageUuid: message.uuid,
    timestamp: new Date(message.timestamp),
    toolId: toolUse.id,
    toolName: toolUse.name,
    contentSize
  });

  file.readCount++;
  file.totalContentSize += contentSize;
  file.lastReadTimestamp = new Date(message.timestamp);
}

/**
 * Extract file paths from bash commands
 */
function extractFilesFromBashCommand(command) {
  const files = new Set();

  // Look for common file path patterns
  const filePathPattern = /\/[a-zA-Z0-9\/_.-]+\.(js|ts|tsx|jsx|json|md|yaml|yml|py|java|go|rs|c|cpp|h|rb|php|html|css|scss|xml|txt|sh|bash)/g;
  const matches = command.match(filePathPattern);

  if (matches) {
    matches.forEach(file => files.add(file));
  }

  return files;
}

/**
 * Calculate impact of removing a file from context
 */
export function calculateFileRemovalImpact(messages, filePath) {
  const affectedMessages = [];
  let totalTokensFreed = 0;

  for (const message of messages) {
    if (message.filesReferenced.includes(filePath)) {
      affectedMessages.push(message.uuid);
      totalTokensFreed += message.tokens.total;
    }
  }

  return {
    filePath,
    affectedMessagesCount: affectedMessages.length,
    affectedMessageUuids: affectedMessages,
    tokensFreed: totalTokensFreed
  };
}

/**
 * Get all instances of a specific file read in the session
 */
export function getFileInstances(parsed, filePath) {
  const instances = [];

  for (const message of parsed.messages) {
    for (const instance of parsed.filesRead || []) {
      if (instance.path === filePath) {
        for (const read of instance.instances) {
          if (read.messageUuid === message.uuid) {
            instances.push({
              ...read,
              message
            });
          }
        }
      }
    }
  }

  return instances.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
