/**
 * Calculate token breakdown for a session
 * Uses actual token counts from usage data where available
 */
export function calculateTokenBreakdown(parsed, subagents = []) {
  const mainAgentTokens = calculateTokensForAgent(parsed.messages, null);

  const subagentTokens = {};
  if (subagents && subagents.length > 0) {
    for (const subagent of subagents) {
      subagentTokens[subagent.agentId] = subagent.tokens;
    }
  }

  const totalMainAgent = mainAgentTokens.total;
  const totalSubagents = Object.values(subagentTokens).reduce((sum, tokens) => sum + tokens.total, 0);
  const combined = totalMainAgent + totalSubagents;

  return {
    main: {
      agentId: 'main',
      breakdown: mainAgentTokens,
      total: totalMainAgent
    },
    subagents: subagentTokens,
    combined: {
      mainAgent: totalMainAgent,
      subagents: totalSubagents,
      total: combined
    }
  };
}

/**
 * Calculate tokens for a specific agent
 */
function calculateTokensForAgent(messages, agentId) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let messageCount = 0;

  for (const message of messages) {
    // Filter by agent if specified
    if (agentId && message.agentId !== agentId) continue;

    totalInput += message.tokens.input;
    totalOutput += message.tokens.output;
    totalCacheRead += message.tokens.cacheRead;
    totalCacheCreation += message.tokens.cacheCreation;
    messageCount++;
  }

  return {
    input: totalInput,
    output: totalOutput,
    cacheRead: totalCacheRead,
    cacheCreation: totalCacheCreation,
    total: totalInput + totalOutput + totalCacheRead + totalCacheCreation,
    messageCount
  };
}

/**
 * Calculate tokens for a selection of messages
 */
export function calculateTokensForSelection(messages, messageUuids) {
  if (!messageUuids || messageUuids.length === 0) {
    return {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
      total: 0,
      messageCount: 0
    };
  }

  const uuidSet = new Set(messageUuids);
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;

  for (const message of messages) {
    if (!uuidSet.has(message.uuid)) continue;

    totalInput += message.tokens.input;
    totalOutput += message.tokens.output;
    totalCacheRead += message.tokens.cacheRead;
    totalCacheCreation += message.tokens.cacheCreation;
  }

  return {
    input: totalInput,
    output: totalOutput,
    cacheRead: totalCacheRead,
    cacheCreation: totalCacheCreation,
    total: totalInput + totalOutput + totalCacheRead + totalCacheCreation,
    messageCount: messageUuids.length
  };
}

/**
 * Estimate tokens using character count
 * Rough approximation: 1 token ≈ 4 characters
 */
export function estimateTokensByCharCount(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Calculate context window usage for Claude
 * Different models have different context limits
 */
export function getContextWindowInfo(modelId) {
  const models = {
    'claude-opus-4.5': { maxTokens: 200000, displayName: 'Claude Opus 4.5' },
    'claude-opus-4-5': { maxTokens: 200000, displayName: 'Claude Opus 4.5' },
    'claude-sonnet-4.5': { maxTokens: 200000, displayName: 'Claude Sonnet 4.5' },
    'claude-sonnet-4-5': { maxTokens: 200000, displayName: 'Claude Sonnet 4.5' },
    'claude-haiku-4.5': { maxTokens: 200000, displayName: 'Claude Haiku 4.5' },
    'claude-haiku-4-5': { maxTokens: 200000, displayName: 'Claude Haiku 4.5' }
  };

  // Find matching model
  const normalized = modelId.toLowerCase();
  for (const [key, info] of Object.entries(models)) {
    if (normalized.includes(key.toLowerCase())) {
      return info;
    }
  }

  // Default to 200k context if unknown
  return {
    maxTokens: 200000,
    displayName: 'Unknown Model'
  };
}

/**
 * Calculate context usage percentage
 */
export function calculateContextUsagePercentage(totalTokens, modelId) {
  const info = getContextWindowInfo(modelId);
  return (totalTokens / info.maxTokens) * 100;
}

/**
 * Get token metrics for a session
 */
export function getTokenMetrics(parsed, subagents = []) {
  const breakdown = calculateTokenBreakdown(parsed, subagents);
  const totalTokens = breakdown.combined.total;

  // Get model used (usually last assistant message)
  let lastModel = null;
  for (let i = parsed.messages.length - 1; i >= 0; i--) {
    if (parsed.messages[i].type === 'assistant' && parsed.messages[i].model) {
      lastModel = parsed.messages[i].model;
      break;
    }
  }

  const contextInfo = lastModel ? getContextWindowInfo(lastModel) : { maxTokens: 200000, displayName: 'Unknown' };
  const usagePercentage = (totalTokens / contextInfo.maxTokens) * 100;

  return {
    breakdown,
    totalTokens,
    modelUsed: lastModel,
    contextInfo,
    usagePercentage,
    availableTokens: contextInfo.maxTokens - totalTokens,
    messageCost: totalTokens / parsed.messages.length
  };
}
