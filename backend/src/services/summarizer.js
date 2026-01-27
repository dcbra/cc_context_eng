import { spawn } from 'child_process';
import { extractKeepitMarkers, stripKeepitMarkers } from './keepit-parser.js';
import { shouldKeepitSurvive, previewDecay } from './keepit-decay.js';
import { verifyKeepitPreservation, generateVerificationReport } from './keepit-verifier.js';
import { hasAskUserQuestion } from './sanitizer.js';

/**
 * AI-powered conversation summarizer using Claude CLI
 * Summarizes user/assistant exchanges while preserving the "interaction soul"
 * Now with keepit marker preservation support
 */

// Output schema for structured responses
const OUTPUT_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['user', 'assistant'] },
      summary: { type: 'string' }
    },
    required: ['role', 'summary']
  }
};

// Aggressiveness presets
const AGGRESSIVENESS_PROMPTS = {
  minimal: `Preserve most detail. Condense repetitive exchanges but keep specific technical details, file paths, function names, and explicit decisions. Each summary should retain the key points of multiple messages.`,
  moderate: `Balance brevity with completeness. Keep the user's core intent, assistant's key findings and decisions. Remove redundant back-and-forth, explanations of obvious things, and verbose reasoning. Preserve technical specifics that are referenced later.`,
  aggressive: `Maximum compression. Extract only: (1) user's explicit requests/goals, (2) critical decisions made, (3) final outcomes/solutions. Remove all exploratory discussion, intermediate reasoning, and verbose explanations.`
};

// Available compaction ratios
// 0 = passthrough (no LLM processing), 1 = verbosity reduction only
const COMPACTION_RATIOS = [0, 1, 2, 3, 4, 5, 10, 15, 20, 25, 35, 50];

// Maximum messages per chunk to avoid timeout
const MAX_MESSAGES_PER_CHUNK = 30;

// Available keep ratios for hybrid mode
// 0 = none (don't keep any, just summarize)
// 1 = all (keep all messages verbatim - passthrough)
// 2+ = keep 1 in N most important
const KEEP_RATIOS = [0, 1, 2, 3, 4, 5, 10, 20, 50];

// Default tier presets for variable compaction (5 tiers)
const DEFAULT_TIERS = [
  { endPercent: 25, compactionRatio: 35, aggressiveness: 'aggressive' },   // 0-25%: oldest, compress most
  { endPercent: 50, compactionRatio: 20, aggressiveness: 'aggressive' },   // 25-50%: old
  { endPercent: 75, compactionRatio: 10, aggressiveness: 'moderate' },     // 50-75%: middle
  { endPercent: 90, compactionRatio: 5, aggressiveness: 'moderate' },      // 75-90%: recent
  { endPercent: 100, compactionRatio: 3, aggressiveness: 'minimal' }       // 90-100%: most recent, preserve most
];

// Preset tier configurations (5 tiers each)
const TIER_PRESETS = {
  uniform: null, // No tiers, use single compaction ratio
  gentle: [
    { endPercent: 25, compactionRatio: 10, aggressiveness: 'moderate' },
    { endPercent: 50, compactionRatio: 7, aggressiveness: 'moderate' },
    { endPercent: 75, compactionRatio: 5, aggressiveness: 'minimal' },
    { endPercent: 90, compactionRatio: 4, aggressiveness: 'minimal' },
    { endPercent: 100, compactionRatio: 2, aggressiveness: 'minimal' }
  ],
  standard: [
    { endPercent: 25, compactionRatio: 25, aggressiveness: 'aggressive' },
    { endPercent: 50, compactionRatio: 15, aggressiveness: 'aggressive' },
    { endPercent: 75, compactionRatio: 10, aggressiveness: 'moderate' },
    { endPercent: 90, compactionRatio: 5, aggressiveness: 'moderate' },
    { endPercent: 100, compactionRatio: 3, aggressiveness: 'minimal' }
  ],
  aggressive: [
    { endPercent: 25, compactionRatio: 50, aggressiveness: 'aggressive' },
    { endPercent: 50, compactionRatio: 35, aggressiveness: 'aggressive' },
    { endPercent: 75, compactionRatio: 20, aggressiveness: 'aggressive' },
    { endPercent: 90, compactionRatio: 10, aggressiveness: 'moderate' },
    { endPercent: 100, compactionRatio: 5, aggressiveness: 'minimal' }
  ]
};

/**
 * Build keepit preservation instructions for the summarization prompt
 */
function buildKeepitInstructions(keepitMarkers, keepitMode) {
  if (!keepitMarkers || keepitMarkers.length === 0) {
    return '';
  }

  const surviving = keepitMarkers.filter(m => m.survives);
  const summarized = keepitMarkers.filter(m => !m.survives);

  if (keepitMode === 'preserve-all') {
    // Preserve all keepit content verbatim
    if (surviving.length === 0 && summarized.length === 0) return '';

    const allMarkers = [...surviving, ...summarized];
    return `
## CRITICAL: Preserve ##keepit## Marked Content
The following content has been explicitly marked for preservation and MUST be included VERBATIM in your summaries.
Do NOT paraphrase, condense, or modify this content in any way:

${allMarkers.map(m => `### PRESERVE EXACTLY (weight ${m.weight.toFixed(2)}):
"""
${m.content.substring(0, 500)}${m.content.length > 500 ? '...' : ''}
"""`).join('\n\n')}

`;
  } else if (keepitMode === 'decay') {
    // Apply decay rules - some survive, some can be summarized
    let instructions = '';

    if (surviving.length > 0) {
      instructions += `
## CRITICAL: MUST PRESERVE Verbatim
The following marked content has high priority and MUST be preserved exactly as written.
Do NOT paraphrase or modify - copy this content word-for-word into your output:

${surviving.map(m => `### PRESERVE EXACTLY (weight ${m.weight.toFixed(2)}${m.isPinned ? ' - PINNED' : ''}):
"""
${m.content.substring(0, 500)}${m.content.length > 500 ? '...' : ''}
"""`).join('\n\n')}

`;
    }

    if (summarized.length > 0) {
      instructions += `
## Lower Priority Marked Content (may be summarized)
The following marked content has lower priority and may be condensed if needed.
Try to preserve the key points but normal summarization rules apply:

${summarized.map(m => `- (weight ${m.weight.toFixed(2)}): "${m.content.substring(0, 100)}..."`).join('\n')}

`;
    }

    return instructions;
  }

  // Default: no keepit instructions
  return '';
}

/**
 * Build the summarization prompt for Claude
 */
function buildSummarizationPrompt(messages, options) {
  const {
    compactionRatio = 10,
    aggressiveness = 'moderate',
    keepitMarkers = [],
    keepitMode = 'decay',  // 'preserve-all', 'decay', or 'ignore'
    preserveLinks = true,   // Preserve URLs and file paths
    preserveAskUserQuestion = true  // Preserve user interaction questions
  } = options;

  // Handle 1:1 ratio (verbosity reduction only)
  const isVerbosityReduction = compactionRatio === 1;
  const targetCount = isVerbosityReduction
    ? messages.length  // Keep same count for 1:1
    : Math.max(2, Math.ceil(messages.length / compactionRatio));

  // Build keepit preservation instructions
  const keepitInstructions = buildKeepitInstructions(keepitMarkers, keepitMode);

  // Build link preservation instructions
  const linkPreservationInstructions = preserveLinks ? `
## CRITICAL - Link and Reference Preservation:
You MUST preserve ALL links and references EXACTLY as they appear in the original:
- URLs (http://, https://) - preserve the full URL
- File paths (/path/to/file, file:///...) - preserve exactly
- Image references like [Image extracted: file:///...] - preserve the ENTIRE reference
- Code references (filename:lineNumber format) - preserve exactly
- Any path or URL mentioned by the user or assistant

DO NOT paraphrase, shorten, or omit any links/paths. If a message mentions a file path or URL, that exact path/URL must appear in the summary.
` : '';

  // Build verbosity reduction instructions (for 1:1 ratio)
  const verbosityReductionInstructions = isVerbosityReduction ? `
## SPECIAL MODE: Verbosity Reduction (1:1)
You are NOT compressing the conversation - you are REDUCING VERBOSITY while keeping the SAME number of messages.
- Output EXACTLY ${messages.length} messages (same as input)
- Keep all the same information, but make each message more concise
- Remove filler words, unnecessary explanations, and redundant phrasing
- Preserve the original meaning and all technical details
- Each output message should correspond to the same input message (same role, same core content)
` : '';

  // Build AskUserQuestion preservation instructions
  const askUserQuestionInstructions = preserveAskUserQuestion ? `
## CRITICAL - Preserve User Interaction Questions:
When you encounter messages where Claude asked the user questions (AskUserQuestion), you MUST:
- Preserve the EXACT questions that were asked
- Preserve the user's answers/responses to those questions
- Keep the question-answer pairs intact and coherent
- These interaction points are critical for understanding the conversation flow
` : '';

  // Extract text content from messages with timestamps
  const formattedMessages = messages.map((msg, idx) => {
    const role = msg.type === 'user' ? 'USER' : 'ASSISTANT';
    const text = extractTextContent(msg);
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'unknown';
    return `[${idx + 1}] ${role} (${timestamp}):\n${text}`;
  }).join('\n\n---\n\n');

  return `You are summarizing a conversation between a user and Claude assistant. Your goal is to reduce context size while maintaining session continuity and the "soul" of the interaction.
${keepitInstructions}${linkPreservationInstructions}${askUserQuestionInstructions}${verbosityReductionInstructions}
## Summarization Rules:
1. Preserve the USER's original intent, questions, and explicit requests
2. Preserve ASSISTANT's key findings, decisions, and important explanations
3. Maintain alternating user/assistant structure (the output must have proper back-and-forth flow)
4. Keep specific technical details: file paths, function names, error messages, code snippets that are referenced
5. Keep any decisions or conclusions that affect later conversation
6. ${AGGRESSIVENESS_PROMPTS[aggressiveness] || AGGRESSIVENESS_PROMPTS.moderate}

## Critical Constraints:
- Output MUST be a raw JSON array (no markdown code blocks, no explanation, ONLY the JSON)
- Each object MUST have "role" (user/assistant) and "summary" fields
- Summaries should be complete sentences, not fragments
- Do NOT lose critical context that would make later messages confusing
- The first message in output should be from the same role as the first input message
- The last message should preserve enough context for conversation to continue naturally
- IMPORTANT: Return ONLY the JSON array, nothing else

## Input: ${messages.length} messages to summarize into approximately ${targetCount} message pairs

${formattedMessages}

---

Output a JSON array with approximately ${targetCount} summarized exchanges. Ensure the flow remains coherent.`;
}

/**
 * Extract text content from a message
 */
function extractTextContent(message) {
  if (!message.content) return '';

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('\n');
  }

  return '';
}

/**
 * Call Claude CLI to summarize messages
 */
async function callClaude(prompt, options = {}) {
  const { model = 'opus', timeout = 300000 } = options;  // 5 minutes default

  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--dangerously-skip-permissions',
      '--model', model,
      '--output-format', 'json'
      // Note: --json-schema removed as it causes CLI to hang
    ];

    // Use standard ~/.claude config dir (can override with CLAUDE_CONFIG_DIR env var)
    const configDir = process.env.CLAUDE_CONFIG_DIR || `${process.env.HOME}/.claude`;

    console.log(`[Summarizer] Spawning Claude CLI with model: ${model}`);
    console.log(`[Summarizer] Config dir: ${configDir}`);
    console.log(`[Summarizer] Prompt length: ${prompt.length} chars`);

    const claude = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
    });

    console.log(`[Summarizer] Claude CLI process started (PID: ${claude.pid})`);

    let stdout = '';
    let stderr = '';

    claude.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`[Summarizer] stdout chunk: ${data.toString().slice(0, 200)}...`);
    });

    claude.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log(`[Summarizer] stderr: ${data.toString()}`);
    });

    // Set timeout
    const timer = setTimeout(() => {
      console.log(`[Summarizer] TIMEOUT after ${timeout}ms - killing process`);
      claude.kill('SIGTERM');
      reject(new Error(`Claude CLI timed out after ${timeout}ms`));
    }, timeout);

    claude.on('close', (code) => {
      clearTimeout(timer);
      console.log(`[Summarizer] Claude CLI exited with code: ${code}`);

      if (code !== 0) {
        console.error(`[Summarizer] ERROR - exit code ${code}, stderr: ${stderr}`);
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Parse the JSON response from Claude CLI
        const response = JSON.parse(stdout);
        console.log(`[Summarizer] Response received, parsing result...`);

        // Extract the result text
        let resultText = response.result;
        if (!resultText) {
          reject(new Error('No result field in Claude response'));
          return;
        }

        // Extract JSON array from response - Claude sometimes adds explanatory text
        resultText = resultText.trim();

        // Try to find JSON array in markdown code block first
        const jsonBlockMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonBlockMatch) {
          resultText = jsonBlockMatch[1].trim();
        }

        // If still not valid JSON, try to find the array directly
        if (!resultText.startsWith('[')) {
          const arrayStart = resultText.indexOf('[');
          const arrayEnd = resultText.lastIndexOf(']');
          if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
            resultText = resultText.slice(arrayStart, arrayEnd + 1);
          }
        }

        // Parse the JSON array
        const summaries = JSON.parse(resultText);

        if (!Array.isArray(summaries)) {
          reject(new Error('Expected JSON array from Claude response'));
          return;
        }

        console.log(`[Summarizer] Parsed ${summaries.length} summaries`);
        resolve(summaries);
      } catch (parseError) {
        reject(new Error(`Failed to parse Claude response: ${parseError.message}\nResponse: ${stdout.slice(0, 500)}`));
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[Summarizer] Failed to spawn Claude CLI: ${err.message}`);
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });

    // Write prompt to stdin
    console.log(`[Summarizer] Writing prompt to stdin...`);
    claude.stdin.write(prompt);
    claude.stdin.end();
    console.log(`[Summarizer] Prompt sent, waiting for response...`);
  });
}

/**
 * Build prompt for selecting important messages to keep verbatim
 */
function buildSelectionPrompt(messages, keepCount) {
  // Format messages with indices
  const formattedMessages = messages.map((msg, idx) => {
    const role = msg.type === 'user' ? 'USER' : 'ASSISTANT';
    const text = extractTextContent(msg);
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'unknown';
    // Truncate very long messages for the selection prompt
    const truncatedText = text.length > 500 ? text.substring(0, 500) + '...' : text;
    return `[${idx}] ${role} (${timestamp}):\n${truncatedText}`;
  }).join('\n\n---\n\n');

  return `You are analyzing a conversation to identify the most important messages to preserve verbatim.

Select exactly ${keepCount} messages that should be kept EXACTLY as-is (not summarized). Choose messages that:
- Contain critical decisions, conclusions, or final solutions
- Include essential code snippets, commands, or technical configurations
- Have key findings that are referenced later in the conversation
- Represent important user requirements, specifications, or constraints
- Contain file paths, URLs, or references that must be preserved exactly

## Critical Constraints:
- Output MUST be a raw JSON array of message indices (0-based), nothing else
- Select EXACTLY ${keepCount} indices
- Return ONLY the JSON array, no explanation or markdown

## Messages (${messages.length} total):

${formattedMessages}

---

Return a JSON array of exactly ${keepCount} indices (0-based) to keep verbatim:`;
}

/**
 * Select the most important messages to keep verbatim using LLM
 */
async function selectImportantMessages(messages, keepRatio, options = {}) {
  const { model = 'opus', timeout = 120000 } = options;

  // Calculate how many messages to keep
  const keepCount = Math.max(1, Math.floor(messages.length / keepRatio));

  console.log(`[Summarizer] Selecting ${keepCount} important messages from ${messages.length} (keepRatio: ${keepRatio})`);

  if (keepCount >= messages.length) {
    // Keep all messages - no selection needed
    return {
      keptMessages: messages,
      keptIndices: messages.map((_, i) => i),
      remainingMessages: [],
      remainingIndices: []
    };
  }

  // Build and send prompt to LLM
  const prompt = buildSelectionPrompt(messages, keepCount);

  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--dangerously-skip-permissions',
      '--model', model,
      '--output-format', 'json'
    ];

    const configDir = process.env.CLAUDE_CONFIG_DIR || `${process.env.HOME}/.claude`;

    console.log(`[Summarizer] Calling Claude for message selection...`);

    const claude = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
    });

    let stdout = '';
    let stderr = '';

    claude.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    claude.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      claude.kill('SIGTERM');
      reject(new Error(`Selection timed out after ${timeout}ms`));
    }, timeout);

    claude.on('close', (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const response = JSON.parse(stdout);
        let resultText = response.result;

        if (!resultText) {
          reject(new Error('No result field in Claude response'));
          return;
        }

        resultText = resultText.trim();

        // Try to find JSON array in markdown code block first
        const jsonBlockMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonBlockMatch) {
          resultText = jsonBlockMatch[1].trim();
        }

        // If still not valid JSON, try to find the array directly
        if (!resultText.startsWith('[')) {
          const arrayStart = resultText.indexOf('[');
          const arrayEnd = resultText.lastIndexOf(']');
          if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
            resultText = resultText.slice(arrayStart, arrayEnd + 1);
          }
        }

        const keptIndices = JSON.parse(resultText);

        if (!Array.isArray(keptIndices)) {
          reject(new Error('Expected JSON array of indices'));
          return;
        }

        // Validate and filter indices
        const validIndices = keptIndices
          .filter(i => typeof i === 'number' && i >= 0 && i < messages.length)
          .map(i => Math.floor(i));

        // Remove duplicates and sort
        const uniqueIndices = [...new Set(validIndices)].sort((a, b) => a - b);

        console.log(`[Summarizer] LLM selected ${uniqueIndices.length} messages to keep: [${uniqueIndices.join(', ')}]`);

        // Split messages into kept and remaining
        const keptSet = new Set(uniqueIndices);
        const keptMessages = [];
        const remainingMessages = [];
        const remainingIndices = [];

        messages.forEach((msg, idx) => {
          if (keptSet.has(idx)) {
            keptMessages.push(msg);
          } else {
            remainingMessages.push(msg);
            remainingIndices.push(idx);
          }
        });

        resolve({
          keptMessages,
          keptIndices: uniqueIndices,
          remainingMessages,
          remainingIndices
        });

      } catch (parseError) {
        reject(new Error(`Failed to parse selection response: ${parseError.message}`));
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });

    claude.stdin.write(prompt);
    claude.stdin.end();
  });
}

/**
 * Generate a UUID
 */
function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Integrate summarized messages back into the session
 * Maintains parent chain integrity
 */
function integrateSummaries(originalMessages, summaries, messageGraph) {
  if (!originalMessages.length || !summaries.length) {
    return { newMessages: [], removedUuids: [] };
  }

  const firstOriginal = originalMessages[0];
  const lastOriginal = originalMessages[originalMessages.length - 1];

  // Get all UUIDs being removed
  const removedUuids = new Set(originalMessages.map(m => m.uuid));

  // Find messages that had parents in our removed range
  // These need their parentUuid updated
  const childrenToUpdate = [];
  if (messageGraph && messageGraph.childrenOf) {
    for (const msg of originalMessages) {
      const children = messageGraph.childrenOf.get(msg.uuid) || [];
      for (const childUuid of children) {
        if (!removedUuids.has(childUuid)) {
          childrenToUpdate.push(childUuid);
        }
      }
    }
  }

  // Create new summary messages using a for loop to allow referencing previous messages
  const newMessages = [];
  for (let index = 0; index < summaries.length; index++) {
    const summary = summaries[index];
    const isFirst = index === 0;

    // First message keeps original UUID and parentUuid for chain continuity
    const uuid = isFirst ? firstOriginal.uuid : generateUuid();
    const parentUuid = isFirst
      ? firstOriginal.parentUuid
      : newMessages[index - 1].uuid;

    // Calculate which original messages this summary represents
    const startIdx = Math.floor(index * originalMessages.length / summaries.length);
    const endIdx = Math.floor((index + 1) * originalMessages.length / summaries.length);
    const summarizedMessages = originalMessages.slice(startIdx, endIdx);

    // Use timestamp from the first message in this summary's range
    const timestamp = summarizedMessages.length > 0
      ? summarizedMessages[0].timestamp
      : firstOriginal.timestamp;

    newMessages.push({
      uuid,
      parentUuid,
      type: summary.role,
      timestamp,
      sessionId: firstOriginal.sessionId,
      agentId: firstOriginal.agentId,
      isSidechain: firstOriginal.isSidechain || false,
      isSummarized: true,
      summarizedCount: summarizedMessages.length,
      summarizedFrom: summarizedMessages.map(m => m.uuid),
      content: [{ type: 'text', text: summary.summary }],
      message: {
        role: summary.role,
        content: [{ type: 'text', text: summary.summary }]
      }
    });
  }

  // Return info needed to update children
  const lastNewMessage = newMessages[newMessages.length - 1];

  return {
    newMessages,
    removedUuids: Array.from(removedUuids),
    lastSummaryUuid: lastNewMessage.uuid,
    childrenToUpdate
  };
}

/**
 * Extract keepit markers from messages and apply decay decisions
 */
function prepareKeepitMarkers(messages, options) {
  const {
    compressionRatio = 10,
    sessionDistance = 0,
    aggressiveness = null,
    keepitMode = 'decay'
  } = options;

  // Extract all keepit markers from messages
  const allMarkers = [];
  for (const msg of messages) {
    const text = extractTextContent(msg);
    const markers = extractKeepitMarkers(text);
    for (const marker of markers) {
      allMarkers.push({
        ...marker,
        messageUuid: msg.uuid
      });
    }
  }

  if (allMarkers.length === 0) {
    return { markers: [], decayPreview: null };
  }

  // Apply decay decisions
  const decayPreview = previewDecay(allMarkers, {
    compressionRatio,
    sessionDistance,
    aggressiveness
  });

  // Merge survival decisions into markers
  const markersWithDecisions = allMarkers.map(marker => {
    const decision = decayPreview.surviving.find(s => s.weight === marker.weight && s.marginFromThreshold !== undefined)
      || decayPreview.summarized.find(s => s.weight === marker.weight);

    const survives = keepitMode === 'preserve-all'
      ? true
      : shouldKeepitSurvive(marker.weight, sessionDistance, compressionRatio, aggressiveness);

    return {
      ...marker,
      survives,
      isPinned: marker.weight >= 1.0
    };
  });

  return {
    markers: markersWithDecisions,
    decayPreview
  };
}

/**
 * Main summarization function
 */
export async function summarizeMessages(messages, options = {}) {
  const {
    compactionRatio = 10,
    aggressiveness = 'moderate',
    model = 'opus',
    dryRun = false,
    keepitMode = 'decay',        // 'preserve-all', 'decay', or 'ignore'
    sessionDistance = 0,
    verifyKeepits = true,        // Whether to verify keepit preservation after summarization
    preserveLinks = true,        // Ask LLM to preserve URLs and file paths
    preserveAskUserQuestion = true  // Preserve user interaction questions
  } = options;

  // Filter to conversation messages and sort by timestamp
  // Include AskUserQuestion tool calls if preserveAskUserQuestion is enabled
  const conversationMessages = messages
    .filter(m => {
      // Always include user/assistant messages with text
      if ((m.type === 'user' || m.type === 'assistant') && extractTextContent(m).trim()) {
        return true;
      }
      // Include AskUserQuestion tool calls if option is enabled
      if (preserveAskUserQuestion && hasAskUserQuestion(m)) {
        return true;
      }
      return false;
    })
    .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

  if (conversationMessages.length < 2) {
    throw new Error('Need at least 2 conversation messages to summarize');
  }

  // Prepare keepit markers with decay decisions
  const { markers: keepitMarkers, decayPreview } = prepareKeepitMarkers(conversationMessages, {
    compressionRatio: compactionRatio,
    sessionDistance,
    aggressiveness,
    keepitMode
  });

  // Build prompt with keepit instructions
  const prompt = buildSummarizationPrompt(conversationMessages, {
    compactionRatio,
    aggressiveness,
    keepitMarkers,
    keepitMode,
    preserveLinks,
    preserveAskUserQuestion
  });

  if (dryRun) {
    // Return preview info without calling Claude
    const targetCount = Math.max(2, Math.ceil(conversationMessages.length / compactionRatio));
    return {
      dryRun: true,
      inputMessageCount: conversationMessages.length,
      estimatedOutputCount: targetCount,
      compactionRatio,
      aggressiveness,
      promptLength: prompt.length,
      keepitStats: decayPreview ? {
        total: decayPreview.stats.total,
        surviving: decayPreview.stats.survivingCount,
        summarized: decayPreview.stats.summarizedCount,
        pinned: decayPreview.stats.pinnedCount,
        threshold: decayPreview.threshold
      } : null
    };
  }

  // Call Claude CLI
  const summaries = await callClaude(prompt, { model });

  // Build result
  const result = {
    summaries,
    inputMessageCount: conversationMessages.length,
    outputMessageCount: summaries.length,
    actualCompaction: (conversationMessages.length / summaries.length).toFixed(1),
    keepitStats: decayPreview ? {
      total: decayPreview.stats.total,
      surviving: decayPreview.stats.survivingCount,
      summarized: decayPreview.stats.summarizedCount,
      pinned: decayPreview.stats.pinnedCount,
      threshold: decayPreview.threshold
    } : null
  };

  // Verify keepit preservation if requested
  if (verifyKeepits && keepitMarkers.length > 0 && keepitMode !== 'ignore') {
    const compressedContent = summaries.map(s => s.summary).join('\n');
    const survivalDecisions = keepitMarkers.map(m => ({
      markerId: m.markerId || `temp_${m.startIndex}`,
      survives: m.survives,
      weight: m.weight
    }));

    const verification = await verifyKeepitPreservation(
      keepitMarkers.map(m => ({
        markerId: m.markerId || `temp_${m.startIndex}`,
        weight: m.weight,
        content: m.content
      })),
      compressedContent,
      survivalDecisions
    );

    result.keepitVerification = verification;

    // Log verification results
    if (verification.summary.missing > 0) {
      console.warn('[Summarizer] Keepit verification warning: some markers missing');
      console.warn(generateVerificationReport(verification));
    }
  }

  return result;
}

/**
 * Summarize a range of messages and integrate into session
 */
export async function summarizeAndIntegrate(parsed, messageUuids, options = {}) {
  const {
    compactionRatio = 10,
    aggressiveness = 'moderate',
    model = 'opus',
    removeNonConversation = true,  // Auto-cleanup tools/thinking from range
    skipFirstMessages = 0,  // Skip first N messages from summarization (keep as-is)
    keepitMode = 'decay',         // 'preserve-all', 'decay', or 'ignore'
    sessionDistance = 0,
    verifyKeepits = true,
    preserveLinks = true,          // Ask LLM to preserve URLs and file paths
    preserveAskUserQuestion = true  // Preserve user interaction questions
  } = options;

  // Get messages in the specified range
  const uuidSet = new Set(messageUuids);
  const targetMessages = parsed.messages.filter(m => uuidSet.has(m.uuid));

  if (targetMessages.length < 2) {
    throw new Error('Need at least 2 messages to summarize');
  }

  // Filter to conversation messages only and sort by timestamp
  const allConversationMessages = targetMessages
    .filter(m => (m.type === 'user' || m.type === 'assistant') && extractTextContent(m).trim())
    .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

  // Split: messages to skip (keep as-is) vs messages to summarize
  const skippedMessages = allConversationMessages.slice(0, skipFirstMessages);
  const conversationMessages = allConversationMessages.slice(skipFirstMessages);

  if (skipFirstMessages > 0) {
    console.log(`[Summarizer] Skipping first ${skipFirstMessages} messages from summarization`);
    console.log(`[Summarizer]   - Kept as-is: ${skippedMessages.length} messages`);
    console.log(`[Summarizer]   - To summarize: ${conversationMessages.length} messages`);
  }

  if (conversationMessages.length < 2) {
    throw new Error('Need at least 2 user/assistant messages to summarize (after skipping)');
  }

  // Prepare keepit markers with decay decisions
  const { markers: keepitMarkers, decayPreview } = prepareKeepitMarkers(conversationMessages, {
    compressionRatio: compactionRatio,
    sessionDistance,
    aggressiveness,
    keepitMode
  });

  // Get summaries from Claude
  const prompt = buildSummarizationPrompt(conversationMessages, {
    compactionRatio,
    aggressiveness,
    keepitMarkers,
    keepitMode,
    preserveLinks,
    preserveAskUserQuestion
  });

  const summaries = await callClaude(prompt, { model });

  // Verify keepit preservation if requested
  let keepitVerification = null;
  if (verifyKeepits && keepitMarkers.length > 0 && keepitMode !== 'ignore') {
    const compressedContent = summaries.map(s => s.summary).join('\n');
    const survivalDecisions = keepitMarkers.map(m => ({
      markerId: m.markerId || `temp_${m.startIndex}`,
      survives: m.survives,
      weight: m.weight
    }));

    keepitVerification = await verifyKeepitPreservation(
      keepitMarkers.map(m => ({
        markerId: m.markerId || `temp_${m.startIndex}`,
        weight: m.weight,
        content: m.content
      })),
      compressedContent,
      survivalDecisions
    );

    if (keepitVerification.summary.missing > 0) {
      console.warn('[Summarizer] Keepit verification warning: some markers missing');
      console.warn(generateVerificationReport(keepitVerification));
    }
  }

  // Determine which messages to remove:
  // - Always remove conversation messages (they're being summarized)
  // - Optionally remove non-conversation messages in range (tools, thinking)
  // - NEVER remove skipped messages (they're kept as-is)
  const skippedUuids = new Set(skippedMessages.map(m => m.uuid));

  let allRemovedUuids;
  if (removeNonConversation) {
    // Remove ALL messages in the selected range EXCEPT skipped messages
    allRemovedUuids = new Set([...messageUuids].filter(uuid => !skippedUuids.has(uuid)));
  } else {
    // Only remove conversation messages that were summarized (not skipped)
    allRemovedUuids = new Set(conversationMessages.map(m => m.uuid));
  }

  // Integrate summaries back into message list
  const integration = integrateSummaries(
    conversationMessages,
    summaries,
    parsed.messageGraph
  );

  // Override removedUuids with our expanded set if removing non-conversation
  const removedSet = removeNonConversation ? allRemovedUuids : new Set(integration.removedUuids);

  // Track additional removed messages for reporting
  const nonConversationRemoved = removeNonConversation
    ? targetMessages.filter(m => !conversationMessages.some(c => c.uuid === m.uuid)).length
    : 0;

  // Build new message list
  const newMessageList = [];
  let summariesInserted = false;

  for (const msg of parsed.messages) {
    if (removedSet.has(msg.uuid)) {
      // Insert summaries at position of first removed message
      if (!summariesInserted) {
        newMessageList.push(...integration.newMessages);
        summariesInserted = true;
      }
      // Skip removed messages
      continue;
    }

    // Update parentUuid if this message's parent was removed
    if (integration.childrenToUpdate.includes(msg.uuid) || removedSet.has(msg.parentUuid)) {
      msg.parentUuid = integration.lastSummaryUuid;
    }

    newMessageList.push(msg);
  }

  return {
    messages: newMessageList,
    changes: {
      removed: removedSet.size,
      added: integration.newMessages.length,
      compaction: `${conversationMessages.length} -> ${summaries.length}`,
      nonConversationRemoved
    },
    summaries,
    keepitStats: decayPreview ? {
      total: decayPreview.stats.total,
      surviving: decayPreview.stats.survivingCount,
      summarized: decayPreview.stats.summarizedCount,
      pinned: decayPreview.stats.pinnedCount,
      threshold: decayPreview.threshold
    } : null,
    keepitVerification
  };
}

/**
 * Split an array into chunks of specified size
 */
function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Split messages into tiers based on percentage ranges
 */
function splitIntoTiers(messages, tiers) {
  const total = messages.length;
  const result = [];
  let startPercent = 0;

  for (const tier of tiers) {
    const startIdx = Math.floor(total * (startPercent / 100));
    const endIdx = Math.floor(total * (tier.endPercent / 100));

    if (endIdx > startIdx) {
      result.push({
        messages: messages.slice(startIdx, endIdx),
        startIdx,
        endIdx,
        startPercent,
        endPercent: tier.endPercent,
        compactionRatio: tier.compactionRatio,
        aggressiveness: tier.aggressiveness,
        keepRatio: tier.keepRatio || 0  // Include keepRatio for hybrid mode
      });
    }

    startPercent = tier.endPercent;
  }

  return result;
}

/**
 * Summarize messages with variable compaction using tiers
 * Each tier gets its own compaction ratio and aggressiveness level
 */
export async function summarizeWithTiers(messages, options = {}) {
  const {
    tiers = DEFAULT_TIERS,
    tierPreset = null,
    model = 'opus',
    dryRun = false,
    preserveLinks = true,  // Ask LLM to preserve URLs and file paths
    preserveAskUserQuestion = true  // Preserve user interaction questions
  } = options;

  // Use preset if specified
  const effectiveTiers = tierPreset && TIER_PRESETS[tierPreset]
    ? TIER_PRESETS[tierPreset]
    : tiers;

  // Filter to conversation messages and sort by timestamp
  // Include AskUserQuestion tool calls if preserveAskUserQuestion is enabled
  const conversationMessages = messages
    .filter(m => {
      // Always include user/assistant messages with text
      if ((m.type === 'user' || m.type === 'assistant') && extractTextContent(m).trim()) {
        return true;
      }
      // Include AskUserQuestion tool calls if option is enabled
      if (preserveAskUserQuestion && hasAskUserQuestion(m)) {
        return true;
      }
      return false;
    })
    .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

  if (conversationMessages.length < 2) {
    throw new Error('Need at least 2 conversation messages to summarize');
  }

  // Split messages into tiers (now in chronological order)
  const tierData = splitIntoTiers(conversationMessages, effectiveTiers);

  if (dryRun) {
    // Return preview info without calling Claude
    const tierPreviews = tierData.map(tier => {
      const preview = {
        range: `${tier.startPercent}-${tier.endPercent}%`,
        inputMessages: tier.messages.length,
        compactionRatio: tier.compactionRatio,
        aggressiveness: tier.aggressiveness
      };

      // Handle hybrid mode (keepRatio > 0)
      if (tier.keepRatio && tier.keepRatio > 0) {
        const keptCount = Math.max(1, Math.floor(tier.messages.length / tier.keepRatio));
        const remainingCount = tier.messages.length - keptCount;
        const summarizedCount = tier.compactionRatio > 1
          ? Math.max(1, Math.ceil(remainingCount / tier.compactionRatio))
          : remainingCount;
        preview.estimatedOutputMessages = keptCount + summarizedCount;
        preview.keepRatio = tier.keepRatio;
        preview.estimatedKept = keptCount;
        preview.estimatedSummarized = summarizedCount;
        preview.hybrid = true;
      } else if (tier.compactionRatio === 0) {
        // Passthrough mode
        preview.estimatedOutputMessages = tier.messages.length;
        preview.passthrough = true;
      } else {
        // Standard summarization
        preview.estimatedOutputMessages = Math.max(1, Math.ceil(tier.messages.length / tier.compactionRatio));
      }

      return preview;
    });

    const totalInput = tierPreviews.reduce((sum, t) => sum + t.inputMessages, 0);
    const totalOutput = tierPreviews.reduce((sum, t) => sum + t.estimatedOutputMessages, 0);

    return {
      dryRun: true,
      tiered: true,
      inputMessageCount: totalInput,
      estimatedOutputCount: totalOutput,
      effectiveCompaction: (totalInput / totalOutput).toFixed(1),
      tiers: tierPreviews
    };
  }

  // Summarize each tier separately, processing in chunks to avoid timeout
  const allSummaries = [];
  const tierResults = [];

  for (const tier of tierData) {
    if (tier.messages.length < 2) {
      // If tier has only 1 message, keep it as-is (convert to summary format)
      const msg = tier.messages[0];
      allSummaries.push({
        role: msg.type,
        summary: extractTextContent(msg),
        _tierInfo: {
          range: `${tier.startPercent}-${tier.endPercent}%`,
          compactionRatio: tier.compactionRatio
        }
      });
      tierResults.push({
        range: `${tier.startPercent}-${tier.endPercent}%`,
        inputMessages: 1,
        outputMessages: 1,
        compactionRatio: tier.compactionRatio
      });
      continue;
    }

    // Handle hybrid mode (keepRatio > 0) - LLM selects important messages to keep
    // Check this BEFORE passthrough since user may want LLM selection + discard (not summarize) the rest
    if (tier.keepRatio && tier.keepRatio > 0) {
      console.log(`[Summarizer] Tier ${tier.startPercent}-${tier.endPercent}%: HYBRID MODE (keepRatio: ${tier.keepRatio}, summarizeRatio: ${tier.compactionRatio})`);

      // Phase 1: Select important messages to keep verbatim
      const selection = await selectImportantMessages(tier.messages, tier.keepRatio, { model });

      console.log(`[Summarizer]   Selected ${selection.keptMessages.length} important messages to keep verbatim`);

      // Phase 1b: Also keep AskUserQuestion messages (they're critical interaction points)
      // Add their indices to the kept set if preserveAskUserQuestion is enabled
      const allKeptIndices = new Set(selection.keptIndices);
      if (preserveAskUserQuestion) {
        tier.messages.forEach((msg, idx) => {
          if (hasAskUserQuestion(msg) && !allKeptIndices.has(idx)) {
            allKeptIndices.add(idx);
            console.log(`[Summarizer]   Also keeping AskUserQuestion message at index ${idx}`);
          }
        });
      }

      // Phase 2: Build intervals between kept messages and summarize each interval separately
      // This preserves chronological order: [summary_before_keep1] [keep1] [summary_between_1_2] [keep2] ...

      // Sort kept indices to build intervals
      const sortedKeptIndices = [...allKeptIndices].sort((a, b) => a - b);

      // Build intervals: messages between each kept message
      const intervals = [];
      let prevEnd = 0;

      for (const keptIdx of sortedKeptIndices) {
        if (keptIdx > prevEnd) {
          // Interval before this kept message
          intervals.push({
            type: 'summarize',
            messages: tier.messages.slice(prevEnd, keptIdx),
            startIdx: prevEnd,
            endIdx: keptIdx
          });
        }
        // The kept message itself
        intervals.push({
          type: 'keep',
          message: tier.messages[keptIdx],
          idx: keptIdx
        });
        prevEnd = keptIdx + 1;
      }

      // Any remaining messages after the last kept
      if (prevEnd < tier.messages.length) {
        intervals.push({
          type: 'summarize',
          messages: tier.messages.slice(prevEnd),
          startIdx: prevEnd,
          endIdx: tier.messages.length
        });
      }

      console.log(`[Summarizer]   Built ${intervals.length} intervals (${sortedKeptIndices.length} keeps, ${intervals.filter(i => i.type === 'summarize').length} summarize segments)`);

      // Process each interval in order
      const combinedSummaries = [];
      let totalSummarizedFrom = 0;
      let totalSummarizedTo = 0;

      for (let intervalIdx = 0; intervalIdx < intervals.length; intervalIdx++) {
        const interval = intervals[intervalIdx];

        if (interval.type === 'keep') {
          // Add kept message as-is
          combinedSummaries.push({
            role: interval.message.type,
            summary: extractTextContent(interval.message),
            _tierInfo: {
              range: `${tier.startPercent}-${tier.endPercent}%`,
              compactionRatio: tier.compactionRatio,
              keepRatio: tier.keepRatio,
              kept: true
            },
            _originalTimestamp: interval.message.timestamp
          });
        } else if (interval.type === 'summarize' && interval.messages.length > 0) {
          totalSummarizedFrom += interval.messages.length;

          if (tier.compactionRatio === 0) {
            // Discard non-selected messages (user chose "Remove" option)
            console.log(`[Summarizer]     Interval ${intervalIdx + 1}: discarding ${interval.messages.length} non-selected messages`);
            // Don't add anything - these messages are removed
          } else if (tier.compactionRatio >= 1) {
            // Summarize this interval (ratio 1 = verbosity reduction, ratio 2+ = summarization)
            console.log(`[Summarizer]     Interval ${intervalIdx + 1}: summarizing ${interval.messages.length} messages (indices ${interval.startIdx}-${interval.endIdx - 1})`);

            // Split interval into chunks if needed
            const chunks = chunkArray(interval.messages, MAX_MESSAGES_PER_CHUNK);

            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              if (chunks.length > 1) {
                console.log(`[Summarizer]       Chunk ${i + 1}/${chunks.length}: ${chunk.length} messages`);
              }

              const prompt = buildSummarizationPrompt(chunk, {
                compactionRatio: tier.compactionRatio,
                aggressiveness: tier.aggressiveness,
                preserveLinks,
                preserveAskUserQuestion
              });

              const summaries = await callClaude(prompt, { model });

              summaries.forEach((s) => {
                s._tierInfo = {
                  range: `${tier.startPercent}-${tier.endPercent}%`,
                  compactionRatio: tier.compactionRatio,
                  keepRatio: tier.keepRatio,
                  interval: intervalIdx + 1,
                  summarized: true
                };
                s._originalTimestamp = chunk[0]?.timestamp;
              });

              combinedSummaries.push(...summaries);
              totalSummarizedTo += summaries.length;

              if (chunks.length > 1) {
                console.log(`[Summarizer]       Chunk ${i + 1} complete: ${chunk.length} -> ${summaries.length} messages`);
              }
            }

            console.log(`[Summarizer]     Interval ${intervalIdx + 1} complete: ${interval.messages.length} -> ${chunks.reduce((acc, c) => acc, 0)} messages`);
          }
          // Note: compactionRatio === 0 case already handled above (discard)
        }
      }

      allSummaries.push(...combinedSummaries);
      tierResults.push({
        range: `${tier.startPercent}-${tier.endPercent}%`,
        inputMessages: tier.messages.length,
        outputMessages: combinedSummaries.length,
        compactionRatio: tier.compactionRatio,
        keepRatio: tier.keepRatio,
        keptVerbatim: selection.keptMessages.length,
        summarizedFrom: totalSummarizedFrom,
        summarizedTo: totalSummarizedTo,
        intervals: intervals.length,
        aggressiveness: tier.aggressiveness,
        hybrid: true
      });

      console.log(`[Summarizer] Tier ${tier.startPercent}-${tier.endPercent}% HYBRID complete: ${tier.messages.length} -> ${combinedSummaries.length} (kept: ${selection.keptMessages.length}, summarized: ${totalSummarizedFrom} -> ${totalSummarizedTo}, intervals: ${intervals.length})`);
      continue;
    }

    // Handle passthrough (ratio 0, no keepRatio) - no LLM processing, keep messages as-is
    if (tier.compactionRatio === 0) {
      console.log(`[Summarizer] Tier ${tier.startPercent}-${tier.endPercent}%: PASSTHROUGH (${tier.messages.length} messages kept as-is)`);

      for (const msg of tier.messages) {
        allSummaries.push({
          role: msg.type,
          summary: extractTextContent(msg),
          _tierInfo: {
            range: `${tier.startPercent}-${tier.endPercent}%`,
            compactionRatio: 0,
            passthrough: true
          },
          _originalTimestamp: msg.timestamp
        });
      }

      tierResults.push({
        range: `${tier.startPercent}-${tier.endPercent}%`,
        inputMessages: tier.messages.length,
        outputMessages: tier.messages.length,
        compactionRatio: 0,
        passthrough: true
      });
      continue;
    }

    // Standard summarization (no keepRatio)
    // Check if we need to preserve AskUserQuestion messages as interval boundaries
    const askUserIndices = [];
    if (preserveAskUserQuestion) {
      tier.messages.forEach((msg, idx) => {
        if (hasAskUserQuestion(msg)) {
          askUserIndices.push(idx);
        }
      });
    }

    // If there are AskUserQuestion messages, use interval-based processing
    if (askUserIndices.length > 0) {
      console.log(`[Summarizer] Tier ${tier.startPercent}-${tier.endPercent}%: ${tier.messages.length} messages with ${askUserIndices.length} AskUserQuestion to preserve`);

      // Build intervals around AskUserQuestion messages
      const intervals = [];
      let prevEnd = 0;
      const sortedIndices = [...askUserIndices].sort((a, b) => a - b);

      for (const keepIdx of sortedIndices) {
        if (keepIdx > prevEnd) {
          intervals.push({
            type: 'summarize',
            messages: tier.messages.slice(prevEnd, keepIdx),
            startIdx: prevEnd,
            endIdx: keepIdx
          });
        }
        intervals.push({
          type: 'keep',
          message: tier.messages[keepIdx],
          idx: keepIdx
        });
        prevEnd = keepIdx + 1;
      }

      if (prevEnd < tier.messages.length) {
        intervals.push({
          type: 'summarize',
          messages: tier.messages.slice(prevEnd),
          startIdx: prevEnd,
          endIdx: tier.messages.length
        });
      }

      const tierSummaries = [];
      for (const interval of intervals) {
        if (interval.type === 'keep') {
          tierSummaries.push({
            role: interval.message.type,
            summary: extractTextContent(interval.message),
            _tierInfo: {
              range: `${tier.startPercent}-${tier.endPercent}%`,
              compactionRatio: tier.compactionRatio,
              kept: true,
              askUserQuestion: true
            },
            _originalTimestamp: interval.message.timestamp
          });
        } else if (interval.messages.length > 0) {
          const chunks = chunkArray(interval.messages, MAX_MESSAGES_PER_CHUNK);
          for (const chunk of chunks) {
            const prompt = buildSummarizationPrompt(chunk, {
              compactionRatio: tier.compactionRatio,
              aggressiveness: tier.aggressiveness,
              preserveLinks,
              preserveAskUserQuestion
            });
            const summaries = await callClaude(prompt, { model });
            summaries.forEach(s => {
              s._tierInfo = {
                range: `${tier.startPercent}-${tier.endPercent}%`,
                compactionRatio: tier.compactionRatio
              };
              s._originalTimestamp = chunk[0]?.timestamp;
            });
            tierSummaries.push(...summaries);
          }
        }
      }

      allSummaries.push(...tierSummaries);
      tierResults.push({
        range: `${tier.startPercent}-${tier.endPercent}%`,
        inputMessages: tier.messages.length,
        outputMessages: tierSummaries.length,
        compactionRatio: tier.compactionRatio,
        aggressiveness: tier.aggressiveness,
        askUserQuestionsPreserved: askUserIndices.length
      });

      console.log(`[Summarizer] Tier ${tier.startPercent}-${tier.endPercent}% complete: ${tier.messages.length} -> ${tierSummaries.length} (preserved ${askUserIndices.length} AskUserQuestion)`);
      continue;
    }

    // No AskUserQuestion to preserve - use simple chunking
    const chunks = chunkArray(tier.messages, MAX_MESSAGES_PER_CHUNK);
    const tierSummaries = [];

    console.log(`[Summarizer] Tier ${tier.startPercent}-${tier.endPercent}%: ${tier.messages.length} messages in ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[Summarizer]   Chunk ${i + 1}/${chunks.length}: ${chunk.length} messages`);

      const prompt = buildSummarizationPrompt(chunk, {
        compactionRatio: tier.compactionRatio,
        aggressiveness: tier.aggressiveness,
        preserveLinks,
        preserveAskUserQuestion
      });

      const summaries = await callClaude(prompt, { model });

      // Add tier info to each summary
      summaries.forEach(s => {
        s._tierInfo = {
          range: `${tier.startPercent}-${tier.endPercent}%`,
          compactionRatio: tier.compactionRatio,
          chunk: i + 1
        };
      });

      tierSummaries.push(...summaries);
      console.log(`[Summarizer]   Chunk ${i + 1} complete: ${chunk.length} -> ${summaries.length} messages`);
    }

    allSummaries.push(...tierSummaries);
    tierResults.push({
      range: `${tier.startPercent}-${tier.endPercent}%`,
      inputMessages: tier.messages.length,
      outputMessages: tierSummaries.length,
      compactionRatio: tier.compactionRatio,
      aggressiveness: tier.aggressiveness,
      chunks: chunks.length
    });

    console.log(`[Summarizer] Tier ${tier.startPercent}-${tier.endPercent}% complete: ${tier.messages.length} -> ${tierSummaries.length} messages`);
  }

  return {
    summaries: allSummaries,
    tiered: true,
    inputMessageCount: conversationMessages.length,
    outputMessageCount: allSummaries.length,
    actualCompaction: (conversationMessages.length / allSummaries.length).toFixed(1),
    tierResults
  };
}

/**
 * Summarize a range of messages with tiered compaction and integrate into session
 */
export async function summarizeAndIntegrateWithTiers(parsed, messageUuids, options = {}) {
  const {
    tiers = DEFAULT_TIERS,
    tierPreset = null,
    model = 'opus',
    removeNonConversation = true,  // Auto-cleanup tools/thinking from range
    skipFirstMessages = 0,  // Skip first N messages from summarization (keep as-is)
    preserveLinks = true,    // Ask LLM to preserve URLs and file paths
    preserveAskUserQuestion = true  // Preserve user interaction questions
  } = options;

  // Get messages in the specified range
  const uuidSet = new Set(messageUuids);
  const targetMessages = parsed.messages.filter(m => uuidSet.has(m.uuid));

  if (targetMessages.length < 2) {
    throw new Error('Need at least 2 messages to summarize');
  }

  // Filter to conversation messages only and sort by timestamp
  const allConversationMessages = targetMessages
    .filter(m => (m.type === 'user' || m.type === 'assistant') && extractTextContent(m).trim())
    .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

  // Split: messages to skip (keep as-is) vs messages to summarize
  const skippedMessages = allConversationMessages.slice(0, skipFirstMessages);
  const conversationMessages = allConversationMessages.slice(skipFirstMessages);

  if (skipFirstMessages > 0) {
    console.log(`[Summarizer] Skipping first ${skipFirstMessages} messages from summarization`);
    console.log(`[Summarizer]   - Kept as-is: ${skippedMessages.length} messages`);
    console.log(`[Summarizer]   - To summarize: ${conversationMessages.length} messages`);
  }

  if (conversationMessages.length < 2) {
    throw new Error('Need at least 2 user/assistant messages to summarize (after skipping)');
  }

  // Get tiered summaries (messages now in chronological order)
  const result = await summarizeWithTiers(conversationMessages, {
    tiers,
    tierPreset,
    model,
    preserveLinks,
    preserveAskUserQuestion
  });

  // Determine which messages to remove:
  // - Always remove conversation messages (they're being summarized)
  // - Optionally remove non-conversation messages in range (tools, thinking)
  // - NEVER remove skipped messages (they're kept as-is)
  const skippedUuids = new Set(skippedMessages.map(m => m.uuid));

  let allRemovedUuids;
  if (removeNonConversation) {
    // Remove ALL messages in the selected range EXCEPT skipped messages
    allRemovedUuids = new Set([...messageUuids].filter(uuid => !skippedUuids.has(uuid)));
  } else {
    // Only remove conversation messages that were summarized (not skipped)
    allRemovedUuids = new Set(conversationMessages.map(m => m.uuid));
  }

  // Integrate summaries back into message list
  const integration = integrateSummaries(
    conversationMessages,
    result.summaries,
    parsed.messageGraph
  );

  // Override removedUuids with our expanded set if removing non-conversation
  const removedSet = removeNonConversation ? allRemovedUuids : new Set(integration.removedUuids);

  // Track additional removed messages for reporting
  const nonConversationRemoved = removeNonConversation
    ? targetMessages.filter(m => !conversationMessages.some(c => c.uuid === m.uuid)).length
    : 0;

  // Build new message list
  const newMessageList = [];
  let summariesInserted = false;

  for (const msg of parsed.messages) {
    if (removedSet.has(msg.uuid)) {
      // Insert summaries at position of first removed message
      if (!summariesInserted) {
        newMessageList.push(...integration.newMessages);
        summariesInserted = true;
      }
      // Skip removed messages
      continue;
    }

    // Update parentUuid if this message's parent was removed
    if (integration.childrenToUpdate.includes(msg.uuid) || removedSet.has(msg.parentUuid)) {
      msg.parentUuid = integration.lastSummaryUuid;
    }

    newMessageList.push(msg);
  }

  return {
    messages: newMessageList,
    changes: {
      removed: removedSet.size,
      added: integration.newMessages.length,
      compaction: `${conversationMessages.length} -> ${result.summaries.length}`,
      nonConversationRemoved
    },
    summaries: result.summaries,
    tierResults: result.tierResults
  };
}

export {
  extractTextContent,
  buildSummarizationPrompt,
  AGGRESSIVENESS_PROMPTS,
  COMPACTION_RATIOS,
  KEEP_RATIOS,
  DEFAULT_TIERS,
  TIER_PRESETS,
  splitIntoTiers,
  selectImportantMessages
};
