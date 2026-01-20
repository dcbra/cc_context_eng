import { spawn } from 'child_process';

/**
 * AI-powered conversation summarizer using Claude CLI
 * Summarizes user/assistant exchanges while preserving the "interaction soul"
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
const COMPACTION_RATIOS = [2, 3, 4, 5, 10, 15, 20, 25, 35, 50];

// Maximum messages per chunk to avoid timeout
const MAX_MESSAGES_PER_CHUNK = 30;

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
 * Build the summarization prompt for Claude
 */
function buildSummarizationPrompt(messages, options) {
  const { compactionRatio = 10, aggressiveness = 'moderate' } = options;

  const targetCount = Math.max(2, Math.ceil(messages.length / compactionRatio));

  // Extract text content from messages with timestamps
  const formattedMessages = messages.map((msg, idx) => {
    const role = msg.type === 'user' ? 'USER' : 'ASSISTANT';
    const text = extractTextContent(msg);
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'unknown';
    return `[${idx + 1}] ${role} (${timestamp}):\n${text}`;
  }).join('\n\n---\n\n');

  return `You are summarizing a conversation between a user and Claude assistant. Your goal is to reduce context size while maintaining session continuity and the "soul" of the interaction.

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

    // Use ~/.claude_b config dir for subscription account (mirrors bash wrapper)
    const configDir = process.env.CLAUDE_CONFIG_DIR || `${process.env.HOME}/.claude_b`;

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

        // Remove markdown code blocks if present
        resultText = resultText.trim();
        if (resultText.startsWith('```json')) {
          resultText = resultText.slice(7);
        } else if (resultText.startsWith('```')) {
          resultText = resultText.slice(3);
        }
        if (resultText.endsWith('```')) {
          resultText = resultText.slice(0, -3);
        }
        resultText = resultText.trim();

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
 * Main summarization function
 */
export async function summarizeMessages(messages, options = {}) {
  const {
    compactionRatio = 10,
    aggressiveness = 'moderate',
    model = 'opus',
    dryRun = false
  } = options;

  // Filter to only user/assistant text messages and sort by timestamp
  const conversationMessages = messages
    .filter(m => (m.type === 'user' || m.type === 'assistant') && extractTextContent(m).trim())
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  if (conversationMessages.length < 2) {
    throw new Error('Need at least 2 conversation messages to summarize');
  }

  // Build prompt (messages now in chronological order)
  const prompt = buildSummarizationPrompt(conversationMessages, {
    compactionRatio,
    aggressiveness
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
      promptLength: prompt.length
    };
  }

  // Call Claude CLI
  const summaries = await callClaude(prompt, { model });

  return {
    summaries,
    inputMessageCount: conversationMessages.length,
    outputMessageCount: summaries.length,
    actualCompaction: (conversationMessages.length / summaries.length).toFixed(1)
  };
}

/**
 * Summarize a range of messages and integrate into session
 */
export async function summarizeAndIntegrate(parsed, messageUuids, options = {}) {
  const {
    compactionRatio = 10,
    aggressiveness = 'moderate',
    model = 'opus',
    removeNonConversation = true  // Auto-cleanup tools/thinking from range
  } = options;

  // Get messages in the specified range
  const uuidSet = new Set(messageUuids);
  const targetMessages = parsed.messages.filter(m => uuidSet.has(m.uuid));

  if (targetMessages.length < 2) {
    throw new Error('Need at least 2 messages to summarize');
  }

  // Filter to conversation messages only and sort by timestamp
  const conversationMessages = targetMessages
    .filter(m => (m.type === 'user' || m.type === 'assistant') && extractTextContent(m).trim())
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  if (conversationMessages.length < 2) {
    throw new Error('Need at least 2 user/assistant messages to summarize');
  }

  // Get summaries from Claude
  const prompt = buildSummarizationPrompt(conversationMessages, {
    compactionRatio,
    aggressiveness
  });

  const summaries = await callClaude(prompt, { model });

  // Determine which messages to remove:
  // - Always remove conversation messages (they're being summarized)
  // - Optionally remove non-conversation messages in range (tools, thinking)
  let allRemovedUuids;
  if (removeNonConversation) {
    // Remove ALL messages in the selected range (tools, thinking, etc.)
    allRemovedUuids = new Set(messageUuids);
  } else {
    // Only remove conversation messages that were summarized
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
    summaries
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
        aggressiveness: tier.aggressiveness
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
    dryRun = false
  } = options;

  // Use preset if specified
  const effectiveTiers = tierPreset && TIER_PRESETS[tierPreset]
    ? TIER_PRESETS[tierPreset]
    : tiers;

  // Filter to only user/assistant text messages and sort by timestamp
  const conversationMessages = messages
    .filter(m => (m.type === 'user' || m.type === 'assistant') && extractTextContent(m).trim())
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  if (conversationMessages.length < 2) {
    throw new Error('Need at least 2 conversation messages to summarize');
  }

  // Split messages into tiers (now in chronological order)
  const tierData = splitIntoTiers(conversationMessages, effectiveTiers);

  if (dryRun) {
    // Return preview info without calling Claude
    const tierPreviews = tierData.map(tier => ({
      range: `${tier.startPercent}-${tier.endPercent}%`,
      inputMessages: tier.messages.length,
      estimatedOutputMessages: Math.max(1, Math.ceil(tier.messages.length / tier.compactionRatio)),
      compactionRatio: tier.compactionRatio,
      aggressiveness: tier.aggressiveness
    }));

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

    // Split tier into chunks to avoid timeout
    const chunks = chunkArray(tier.messages, MAX_MESSAGES_PER_CHUNK);
    const tierSummaries = [];

    console.log(`[Summarizer] Tier ${tier.startPercent}-${tier.endPercent}%: ${tier.messages.length} messages in ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[Summarizer]   Chunk ${i + 1}/${chunks.length}: ${chunk.length} messages`);

      const prompt = buildSummarizationPrompt(chunk, {
        compactionRatio: tier.compactionRatio,
        aggressiveness: tier.aggressiveness
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
    removeNonConversation = true  // Auto-cleanup tools/thinking from range
  } = options;

  // Get messages in the specified range
  const uuidSet = new Set(messageUuids);
  const targetMessages = parsed.messages.filter(m => uuidSet.has(m.uuid));

  if (targetMessages.length < 2) {
    throw new Error('Need at least 2 messages to summarize');
  }

  // Filter to conversation messages only and sort by timestamp
  const conversationMessages = targetMessages
    .filter(m => (m.type === 'user' || m.type === 'assistant') && extractTextContent(m).trim())
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  if (conversationMessages.length < 2) {
    throw new Error('Need at least 2 user/assistant messages to summarize');
  }

  // Get tiered summaries (messages now in chronological order)
  const result = await summarizeWithTiers(conversationMessages, {
    tiers,
    tierPreset,
    model
  });

  // Determine which messages to remove:
  // - Always remove conversation messages (they're being summarized)
  // - Optionally remove non-conversation messages in range (tools, thinking)
  let allRemovedUuids;
  if (removeNonConversation) {
    // Remove ALL messages in the selected range (tools, thinking, etc.)
    allRemovedUuids = new Set(messageUuids);
  } else {
    // Only remove conversation messages that were summarized
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
  DEFAULT_TIERS,
  TIER_PRESETS,
  splitIntoTiers
};
