#!/usr/bin/env node
/**
 * Standalone script to remove imagePasteIds from messages that have [Image extracted:] text
 *
 * Usage: node fix-image-paste-ids.js <session-file.jsonl>
 */

import fs from 'fs';

const sessionFile = process.argv[2];

if (!sessionFile) {
  console.error('Usage: node fix-image-paste-ids.js <session-file.jsonl>');
  process.exit(1);
}

console.log(`Reading: ${sessionFile}`);

const content = fs.readFileSync(sessionFile, 'utf-8');
const lines = content.trim().split('\n');

console.log(`Total lines: ${lines.length}`);

let modified = 0;
let alreadyClean = 0;
let noImagePasteIds = 0;

const newLines = lines.map((line, idx) => {
  try {
    const record = JSON.parse(line);

    // Check if has imagePasteIds
    if (!record.imagePasteIds) {
      noImagePasteIds++;
      return line;
    }

    // Check if content has [Image extracted:
    const lineStr = JSON.stringify(record);
    if (!lineStr.includes('[Image extracted:')) {
      alreadyClean++;
      return line;
    }

    // Remove imagePasteIds
    console.log(`Line ${idx + 1}: Removing imagePasteIds=[${record.imagePasteIds}] from uuid=${record.uuid}`);
    delete record.imagePasteIds;
    modified++;

    return JSON.stringify(record);
  } catch (e) {
    console.error(`Line ${idx + 1}: Parse error: ${e.message}`);
    return line;
  }
});

console.log(`\nSummary:`);
console.log(`  - No imagePasteIds: ${noImagePasteIds}`);
console.log(`  - Has imagePasteIds but no [Image extracted:]: ${alreadyClean}`);
console.log(`  - Modified (removed imagePasteIds): ${modified}`);

if (modified > 0) {
  // Write back
  const outFile = sessionFile;
  fs.writeFileSync(outFile, newLines.join('\n') + '\n');
  console.log(`\nWritten to: ${outFile}`);

  // Verify
  const verify = fs.readFileSync(outFile, 'utf-8');
  const stillHas = (verify.match(/imagePasteIds.*\[Image extracted:/g) || []).length;
  console.log(`Verification: ${stillHas} lines still have both imagePasteIds and [Image extracted:]`);
} else {
  console.log(`\nNo changes needed.`);
}
