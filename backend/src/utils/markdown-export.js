/**
 * Convert a parsed session to Markdown format
 * @param {Object} parsed - Parsed session data
 * @param {Array} messageOrder - Messages in order
 * @param {Object} options - Export options
 * @param {boolean} options.full - If true, export full content without truncation (default: false)
 */
export function sessionToMarkdown(parsed, messageOrder, options = {}) {
  const { full = false } = options;
  const lines = [];

  // Header
  lines.push(`# Session: ${parsed.sessionId}`);
  lines.push('');

  // Metadata
  if (parsed.metadata) {
    lines.push('## Metadata');
    lines.push(`**Working Directory:** \`${parsed.metadata.cwd}\``);
    if (parsed.metadata.gitBranch) {
      lines.push(`**Git Branch:** ${parsed.metadata.gitBranch}`);
    }
    lines.push(`**Claude Code Version:** ${parsed.metadata.version}`);
    lines.push('');
  }

  // Summary
  if (parsed.summary) {
    lines.push('## Summary');
    lines.push(parsed.summary.summary || '(No summary available)');
    lines.push('');
  }

  // Conversation
  lines.push('## Conversation');
  lines.push('');

  for (const message of messageOrder) {
    const timestamp = new Date(message.timestamp).toLocaleString();
    const type = message.type === 'user' ? 'User' : 'Assistant';

    lines.push(`### ${type}`);
    lines.push(`*${timestamp}*`);
    lines.push('');

    // Add message content
    if (message.content && message.content.length > 0) {
      for (const block of message.content) {
        if (block.type === 'text') {
          lines.push(block.text);
          lines.push('');
        } else if (block.type === 'tool_use') {
          lines.push(`**Tool:** ${block.name}`);
          if (block.input) {
            lines.push('```json');
            lines.push(JSON.stringify(block.input, null, 2));
            lines.push('```');
            lines.push('');
          }
        } else if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          lines.push('**Result:**');
          lines.push('```');
          if (full) {
            lines.push(content);
          } else {
            lines.push(content.substring(0, 500) + (content.length > 500 ? '...' : ''));
          }
          lines.push('```');
          lines.push('');
        }
      }
    }

    // Add metadata
    if (message.type === 'assistant' && message.model) {
      lines.push(`*Model: ${message.model}*`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Export session as plain text conversation
 */
export function sessionToPlainText(messageOrder) {
  const lines = [];

  for (const message of messageOrder) {
    const timestamp = new Date(message.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    const type = message.type.toUpperCase();
    lines.push(`[${timestamp}] ${type}:`);

    if (message.content && message.content.length > 0) {
      for (const block of message.content) {
        if (block.type === 'text') {
          const text = block.text.split('\n').map(l => '  ' + l).join('\n');
          lines.push(text);
        } else if (block.type === 'tool_use') {
          lines.push(`  [Tool: ${block.name}]`);
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Create a summary report of the session
 * @param {Object} parsed - Parsed session data
 * @param {Array} messageOrder - Messages in order
 * @param {Array} filesRead - Files read in session
 * @param {Object} tokens - Token breakdown
 * @param {Array} subagents - Subagent info
 * @param {Object} options - Export options
 * @param {boolean} options.full - If true, include all files without limit (default: false)
 */
export function createSessionReport(parsed, messageOrder, filesRead, tokens, subagents, options = {}) {
  const { full = false } = options;
  const lines = [];

  lines.push('# Context Analysis Report');
  lines.push('');

  // Generated at
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');

  // Session Info
  lines.push('## Session Information');
  lines.push(`- **ID:** ${parsed.sessionId}`);
  lines.push(`- **Working Directory:** ${parsed.metadata?.cwd || 'N/A'}`);
  lines.push(`- **Git Branch:** ${parsed.metadata?.gitBranch || 'N/A'}`);
  lines.push(`- **Claude Code Version:** ${parsed.metadata?.version || 'N/A'}`);
  lines.push('');

  // Message Statistics
  lines.push('## Message Statistics');
  lines.push(`- **Total Messages:** ${messageOrder.length}`);

  const userMessages = messageOrder.filter(m => m.type === 'user').length;
  const assistantMessages = messageOrder.filter(m => m.type === 'assistant').length;

  lines.push(`- **User Messages:** ${userMessages}`);
  lines.push(`- **Assistant Messages:** ${assistantMessages}`);
  lines.push('');

  // Token Statistics
  lines.push('## Token Usage');
  if (tokens) {
    const breakdown = tokens.breakdown;
    lines.push(`- **Input Tokens:** ${breakdown.main.breakdown.input}`);
    lines.push(`- **Output Tokens:** ${breakdown.main.breakdown.output}`);
    lines.push(`- **Cache Read:** ${breakdown.main.breakdown.cacheRead}`);
    lines.push(`- **Cache Creation:** ${breakdown.main.breakdown.cacheCreation}`);
    lines.push(`- **Total (Main):** ${breakdown.main.breakdown.total}`);

    if (subagents && subagents.length > 0) {
      lines.push(`- **Subagents Total:** ${breakdown.combined.subagents}`);
      lines.push(`- **Combined Total:** ${breakdown.combined.total}`);
    }
  }
  lines.push('');

  // Files Accessed
  lines.push('## Files Accessed');
  if (filesRead && filesRead.length > 0) {
    lines.push(`Total files read: **${filesRead.length}**`);
    lines.push('');

    const filesToShow = full ? filesRead : filesRead.slice(0, 20);
    for (const file of filesToShow) {
      lines.push(`- \`${file.path}\``);
      lines.push(`  - Read ${file.readCount} times`);
      lines.push(`  - Total size: ${formatSize(file.totalContentSize)}`);
    }

    if (!full && filesRead.length > 20) {
      lines.push(`- ... and ${filesRead.length - 20} more files`);
    }
  }
  lines.push('');

  // Subagents
  if (subagents && subagents.length > 0) {
    lines.push('## Subagents');
    for (const subagent of subagents) {
      lines.push(`- **${subagent.agentId}**`);
      lines.push(`  - Messages: ${subagent.messageCount}`);
      lines.push(`  - Tokens: ${subagent.tokens.total}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format file size for display
 */
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
