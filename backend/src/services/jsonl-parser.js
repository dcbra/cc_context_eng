import fs from 'fs-extra';
import readline from 'readline';
import path from 'path';

/**
 * Parse a JSONL file and extract messages with enhanced metadata
 */
export async function parseJsonlFile(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const messages = [];
  const fileHistorySnapshots = [];
  let summary = null;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line);

      // Handle different record types
      if (record.type === 'summary') {
        summary = record;
      } else if (record.type === 'file-history-snapshot') {
        fileHistorySnapshots.push(record);
      } else if (record.type === 'user' || record.type === 'assistant') {
        const enhancedMessage = enhanceMessage(record);
        messages.push(enhancedMessage);
      }
    } catch (error) {
      console.warn(`Failed to parse line in ${filePath}:`, error.message);
    }
  }

  // Build conversation graph
  const messagesMap = new Map(messages.map(m => [m.uuid, m]));
  const messageGraph = buildMessageGraph(messages, messagesMap);

  return {
    filePath,
    fileName: path.basename(filePath),
    summary,
    messages,
    messageGraph,
    fileHistorySnapshots,
    totalMessages: messages.length,
    sessionId: messages[0]?.sessionId || null,
    metadata: messages[0] ? {
      cwd: messages[0].cwd,
      gitBranch: messages[0].gitBranch,
      version: messages[0].version,
      projectName: extractProjectName(messages[0].cwd)
    } : null
  };
}

/**
 * Enhance a message record with parsed metadata
 */
function enhanceMessage(record) {
  const toolUses = [];
  const toolResults = [];
  const filesReferenced = new Set();

  // Extract tool uses and results from content
  if (record.message && record.message.content) {
    const contentArray = Array.isArray(record.message.content) ? record.message.content : [record.message.content];

    for (const block of contentArray) {
      if (!block) continue; // Skip null/undefined blocks

      if (block.type === 'tool_use') {
        toolUses.push(block);
        // Extract file paths from tool inputs
        if (block.input) {
          extractFilesFromToolInput(block.input, filesReferenced);
        }
      } else if (block.type === 'tool_result') {
        toolResults.push(block);
        // Extract file paths from tool result content
        if (block.content) {
          extractFilesFromContent(block.content, filesReferenced);
        }
      }
    }
  }

  // Calculate token count
  const tokens = calculateTokens(record.message);

  // Ensure content is always an array of proper content blocks
  let contentArray = [];
  if (record.message?.content) {
    if (Array.isArray(record.message.content)) {
      contentArray = record.message.content;
    } else if (typeof record.message.content === 'string') {
      // Convert string content to a proper text block
      contentArray = [{ type: 'text', text: record.message.content }];
    } else {
      contentArray = [record.message.content];
    }
  }

  return {
    // Message identity
    uuid: record.uuid,
    parentUuid: record.parentUuid,
    type: record.type, // 'user' or 'assistant'

    // Context metadata
    sessionId: record.sessionId,
    agentId: record.agentId,
    isSidechain: record.isSidechain || false,
    timestamp: record.timestamp,
    cwd: record.cwd,
    gitBranch: record.gitBranch || '',
    version: record.version,

    // Message content
    content: contentArray,
    model: record.message?.model || null,
    toolUses,
    toolResults,
    filesReferenced: Array.from(filesReferenced),

    // Token tracking
    tokens,

    // Raw record (for reconstruction)
    raw: record
  };
}

/**
 * Extract file paths from tool input objects
 */
function extractFilesFromToolInput(input, fileSet) {
  if (typeof input !== 'object') return;

  if (input.file_path && typeof input.file_path === 'string') {
    fileSet.add(input.file_path);
  }

  if (input.path && typeof input.path === 'string') {
    fileSet.add(input.path);
  }

  // Recursively check nested objects
  for (const value of Object.values(input)) {
    if (typeof value === 'object' && value !== null) {
      extractFilesFromToolInput(value, fileSet);
    }
  }
}

/**
 * Extract file paths from content strings (from grep results, etc.)
 */
function extractFilesFromContent(content, fileSet) {
  if (typeof content !== 'string') return;

  // Simple file path pattern: starts with / and has typical path structure
  const filePathPattern = /\/[a-zA-Z0-9\/_.-]+\.(js|ts|tsx|jsx|json|md|yaml|yml|py|java|go|rs|c|cpp|h|rb|php|html|css|scss|xml|txt)/g;
  const matches = content.match(filePathPattern);

  if (matches) {
    matches.forEach(file => fileSet.add(file));
  }
}

/**
 * Calculate token count from message usage data
 */
function calculateTokens(message) {
  if (!message || !message.usage) {
    return {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
      total: 0
    };
  }

  const usage = message.usage;
  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    cacheCreation: usage.cache_creation_input_tokens || 0,
    total: (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
  };
}

/**
 * Build a graph of messages connected by parentUuid
 */
function buildMessageGraph(messages, messagesMap) {
  const graph = {
    roots: [], // Messages with parentUuid === null
    childrenOf: new Map(), // Map<uuid, [children]>
    parentOf: new Map() // Map<uuid, parent>
  };

  // Find roots and build parent-child relationships
  for (const message of messages) {
    if (!message.parentUuid) {
      graph.roots.push(message.uuid);
    } else {
      if (!graph.childrenOf.has(message.parentUuid)) {
        graph.childrenOf.set(message.parentUuid, []);
      }
      graph.childrenOf.get(message.parentUuid).push(message.uuid);
      graph.parentOf.set(message.uuid, message.parentUuid);
    }
  }

  return graph;
}

/**
 * Extract project name from cwd path
 */
function extractProjectName(cwd) {
  if (!cwd) return 'unknown';
  const parts = cwd.split('/');
  return parts[parts.length - 1] || 'unknown';
}

/**
 * Get all messages in order (depth-first from roots)
 */
export function getMessageOrder(parsed) {
  const order = [];
  const visited = new Set();

  function traverse(uuid) {
    if (visited.has(uuid)) return;
    visited.add(uuid);

    const message = parsed.messages.find(m => m.uuid === uuid);
    if (message) {
      order.push(message);
    }

    const children = parsed.messageGraph.childrenOf.get(uuid) || [];
    for (const childUuid of children) {
      traverse(childUuid);
    }
  }

  // Start from roots
  for (const rootUuid of parsed.messageGraph.roots) {
    traverse(rootUuid);
  }

  return order;
}
