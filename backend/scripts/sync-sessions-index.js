#!/usr/bin/env node
/**
 * Sync sessions-index.json with actual session file stats
 *
 * Usage: node sync-sessions-index.js <session-file.jsonl>
 */

import fs from 'fs';
import path from 'path';

const sessionFile = process.argv[2];

if (!sessionFile) {
  console.error('Usage: node sync-sessions-index.js <session-file.jsonl>');
  process.exit(1);
}

// Get session ID from filename
const sessionId = path.basename(sessionFile, '.jsonl');
const projectDir = path.dirname(sessionFile);
const indexFile = path.join(projectDir, 'sessions-index.json');

console.log(`Session file: ${sessionFile}`);
console.log(`Session ID: ${sessionId}`);
console.log(`Index file: ${indexFile}`);

// Count actual messages
const content = fs.readFileSync(sessionFile, 'utf-8');
const lines = content.trim().split('\n');
let messageCount = 0;

for (const line of lines) {
  try {
    const record = JSON.parse(line);
    if (record.type === 'user' || record.type === 'assistant') {
      messageCount++;
    }
  } catch (e) {}
}

// Get file mtime
const stat = fs.statSync(sessionFile);
const fileMtime = stat.mtimeMs;

console.log(`\nActual stats:`);
console.log(`  messageCount: ${messageCount}`);
console.log(`  fileMtime: ${fileMtime}`);

// Read and update index
if (!fs.existsSync(indexFile)) {
  console.error(`Index file not found: ${indexFile}`);
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
const entry = index.entries.find(e => e.sessionId === sessionId);

if (!entry) {
  console.error(`Session ${sessionId} not found in index`);
  process.exit(1);
}

console.log(`\nIndex stats (before):`);
console.log(`  messageCount: ${entry.messageCount}`);
console.log(`  fileMtime: ${entry.fileMtime}`);

// Update
entry.messageCount = messageCount;
entry.fileMtime = Math.floor(fileMtime);
entry.modified = new Date().toISOString();

// Write back
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));

console.log(`\nIndex stats (after):`);
console.log(`  messageCount: ${entry.messageCount}`);
console.log(`  fileMtime: ${entry.fileMtime}`);
console.log(`\nIndex updated successfully!`);
