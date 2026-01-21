import fs from 'fs-extra';
import readline from 'readline';

// Threshold for using streaming mode (100MB)
const STREAMING_THRESHOLD = 100 * 1024 * 1024;

/**
 * Read a JSONL file as an array of parsed JSON objects using streaming.
 * Uses streaming for files > 100MB to avoid ERR_STRING_TOO_LONG errors.
 *
 * @param {string} filePath - Path to the JSONL file
 * @returns {Promise<Array>} Array of parsed JSON objects (one per line)
 */
export async function readJsonlAsArray(filePath) {
  const stats = await fs.stat(filePath);

  if (stats.size > STREAMING_THRESHOLD) {
    return readJsonlStreamingAsArray(filePath);
  }

  // For smaller files, use the faster direct read
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  return lines.map(line => {
    try {
      return JSON.parse(line);
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Read a JSONL file as raw lines using streaming.
 * Uses streaming for files > 100MB to avoid ERR_STRING_TOO_LONG errors.
 *
 * @param {string} filePath - Path to the JSONL file
 * @returns {Promise<Array<string>>} Array of raw line strings
 */
export async function readJsonlAsLines(filePath) {
  const stats = await fs.stat(filePath);

  if (stats.size > STREAMING_THRESHOLD) {
    return readJsonlStreamingAsLines(filePath);
  }

  // For smaller files, use the faster direct read
  const content = await fs.readFile(filePath, 'utf-8');
  return content.split('\n').filter(l => l.trim());
}

/**
 * Stream a JSONL file and call a callback for each parsed record.
 * Always uses streaming, suitable for any file size.
 *
 * @param {string} filePath - Path to the JSONL file
 * @param {Function} callback - Callback function(record, lineNumber) called for each valid JSON line
 * @returns {Promise<{lineCount: number, errorCount: number}>}
 */
export async function streamJsonl(filePath, callback) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineNumber = 0;
  let errorCount = 0;

  for await (const line of rl) {
    lineNumber++;
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line);
      await callback(record, lineNumber);
    } catch (e) {
      errorCount++;
    }
  }

  return { lineCount: lineNumber, errorCount };
}

/**
 * Count messages in a JSONL file by type without loading entire file into memory.
 * Uses streaming to handle very large files.
 *
 * @param {string} filePath - Path to the JSONL file
 * @returns {Promise<number>} Count of user, assistant, or system messages
 */
export async function countMessages(filePath) {
  const stats = await fs.stat(filePath);

  if (stats.size > STREAMING_THRESHOLD) {
    // Use streaming for large files
    let count = 0;
    await streamJsonl(filePath, (record) => {
      if (record.type === 'user' || record.type === 'assistant' || record.type === 'system') {
        count++;
      }
    });
    return count;
  }

  // For smaller files, use regex counting (faster)
  const content = await fs.readFile(filePath, 'utf-8');
  return (content.match(/"type":"(user|assistant|system)"/g) || []).length;
}

/**
 * Verify JSONL file integrity using streaming.
 * Checks that each line is valid JSON.
 *
 * @param {string} filePath - Path to the JSONL file
 * @returns {Promise<{valid: boolean, lineCount: number, errors: Array}>}
 */
export async function verifyJsonlIntegrity(filePath) {
  const errors = [];
  let lineCount = 0;

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    lineCount++;
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line);

      // Basic validation
      if (!record.uuid) {
        errors.push(`Line ${lineCount}: Missing uuid`);
      }
      if (!record.type) {
        errors.push(`Line ${lineCount}: Missing type`);
      }
    } catch (e) {
      errors.push(`Line ${lineCount}: Invalid JSON - ${e.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    lineCount,
    errors
  };
}

/**
 * Compare two JSONL files using streaming.
 * Returns comparison statistics without loading entire files into memory.
 *
 * @param {string} path1 - Path to first JSONL file
 * @param {string} path2 - Path to second JSONL file
 * @returns {Promise<{messages1: Array, messages2: Array, tokens1: number, tokens2: number}>}
 */
export async function compareJsonlFiles(path1, path2) {
  const [result1, result2] = await Promise.all([
    readJsonlWithStats(path1),
    readJsonlWithStats(path2)
  ]);

  return {
    messages1: result1.messages,
    messages2: result2.messages,
    tokens1: result1.totalTokens,
    tokens2: result2.totalTokens
  };
}

/**
 * Read JSONL file and extract messages with token stats.
 * Used internally for comparison.
 */
async function readJsonlWithStats(filePath) {
  const messages = [];
  let totalTokens = 0;

  await streamJsonl(filePath, (record) => {
    if (record.type === 'user' || record.type === 'assistant') {
      messages.push(record);

      // Extract tokens from usage data
      if (record.message?.usage) {
        const usage = record.message.usage;
        totalTokens += (usage.input_tokens || 0) +
                       (usage.output_tokens || 0) +
                       (usage.cache_read_input_tokens || 0);
      }
    }
  });

  return { messages, totalTokens };
}

/**
 * Internal: Read JSONL file as array using streaming.
 */
async function readJsonlStreamingAsArray(filePath) {
  const records = [];

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      records.push(JSON.parse(line));
    } catch (e) {
      // Skip invalid lines
    }
  }

  return records;
}

/**
 * Internal: Read JSONL file as lines using streaming.
 */
async function readJsonlStreamingAsLines(filePath) {
  const lines = [];

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.trim()) {
      lines.push(line);
    }
  }

  return lines;
}

/**
 * Read JSONL file content for export (returns raw content for smaller files,
 * or streams and reassembles for larger files).
 *
 * @param {string} filePath - Path to the JSONL file
 * @returns {Promise<string>} File content as string
 */
export async function readJsonlContent(filePath) {
  const stats = await fs.stat(filePath);

  if (stats.size > STREAMING_THRESHOLD) {
    // For large files, stream and reassemble
    // Note: This still requires enough memory to hold the result
    // but avoids the V8 string limit issue during the read
    const lines = await readJsonlStreamingAsLines(filePath);
    return lines.join('\n');
  }

  // For smaller files, use direct read
  return fs.readFile(filePath, 'utf-8');
}
