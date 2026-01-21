/**
 * Output generation functions for memory versions
 * Handles markdown and JSONL output generation
 */

import { extractTextContent } from './summarizer.js';

/**
 * Generate markdown output from summarized messages
 */
export function generateMarkdownOutput(result) {
  const lines = [];

  // Header
  lines.push('# Compressed Session');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Original messages: ${result.changes?.compaction || 'N/A'}`);
  if (result.tierResults) {
    lines.push('');
    lines.push('## Tier Summary');
    for (const tier of result.tierResults) {
      lines.push(`- ${tier.range}: ${tier.inputMessages} -> ${tier.outputMessages} messages (${tier.compactionRatio}x)`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Messages
  for (const msg of result.messages) {
    const role = msg.type === 'user' ? 'User' : 'Assistant';
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
    const isSummarized = msg.isSummarized ? ' [SUMMARIZED]' : '';

    lines.push(`## ${role}${isSummarized}`);
    if (timestamp) {
      lines.push(`*${timestamp}*`);
    }
    lines.push('');

    // Extract text content
    const text = extractTextContent(msg);
    if (text) {
      lines.push(text);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate JSONL output from summarized messages
 * This format can be used to reconstruct a session
 */
export function generateJsonlOutput(result) {
  const lines = [];

  // Add a header record
  const header = {
    type: 'compression-metadata',
    version: '1.0',
    createdAt: new Date().toISOString(),
    changes: result.changes,
    tierResults: result.tierResults || null
  };
  lines.push(JSON.stringify(header));

  // Add each message
  for (const msg of result.messages) {
    // Create a clean message record similar to original Claude format
    const record = {
      type: msg.type,
      uuid: msg.uuid,
      parentUuid: msg.parentUuid,
      timestamp: msg.timestamp,
      sessionId: msg.sessionId,
      agentId: msg.agentId,
      isSidechain: msg.isSidechain || false,
      isSummarized: msg.isSummarized || false,
      summarizedCount: msg.summarizedCount || null,
      summarizedFrom: msg.summarizedFrom || null,
      message: {
        role: msg.type,
        content: msg.content
      }
    };
    lines.push(JSON.stringify(record));
  }

  return lines.join('\n');
}

/**
 * Generate markdown from parsed session (for original pseudo-version)
 */
export function generateMarkdownFromParsed(parsed) {
  const lines = [];

  // Header
  lines.push('# Original Session');
  lines.push('');
  lines.push(`Total messages: ${parsed.totalMessages}`);
  if (parsed.metadata) {
    lines.push(`Project: ${parsed.metadata.projectName || 'unknown'}`);
    lines.push(`Branch: ${parsed.metadata.gitBranch || 'unknown'}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Messages
  for (const msg of parsed.messages) {
    if (msg.type !== 'user' && msg.type !== 'assistant') continue;

    const role = msg.type === 'user' ? 'User' : 'Assistant';
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';

    lines.push(`## ${role}`);
    if (timestamp) {
      lines.push(`*${timestamp}*`);
    }
    lines.push('');

    const text = extractTextContent(msg);
    if (text) {
      lines.push(text);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}
