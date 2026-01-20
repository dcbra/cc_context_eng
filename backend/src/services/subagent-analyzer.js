import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { parseJsonlFile } from './jsonl-parser.js';
import { calculateTokenBreakdown } from './token-calculator.js';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Analyze subagents in a session
 * Identifies subagent sessions spawned by the main agent
 * Supports both old structure (agent-*.jsonl at project root) and
 * new structure (session-id/subagents/agent-*.jsonl)
 */
export async function analyzeSubagents(parsed, projectId, sessionId = null) {
  const subagents = [];
  const sessionAgentIds = new Set();
  let mainAgentId = null;

  // Get all unique agent IDs and identify main agent
  for (const message of parsed.messages) {
    sessionAgentIds.add(message.agentId);
    if (!message.isSidechain && !mainAgentId) {
      mainAgentId = message.agentId;
    }
  }

  // Find subagent files in the project directory
  const projectPath = path.join(PROJECTS_DIR, projectId);
  if (!await fs.pathExists(projectPath)) {
    return subagents;
  }

  // Collect all agent files from both old and new structures
  const agentFilesToAnalyze = [];

  // 1. Old structure: agent-*.jsonl files at project root
  const files = await fs.readdir(projectPath);
  const rootAgentFiles = files.filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'));
  for (const agentFile of rootAgentFiles) {
    agentFilesToAnalyze.push({
      fileName: agentFile,
      filePath: path.join(projectPath, agentFile),
      agentId: agentFile.replace('agent-', '').replace('.jsonl', '')
    });
  }

  // 2. New structure: session-id/subagents/agent-*.jsonl
  // Check both the provided sessionId and all session directories
  const sessionDirsToCheck = [];

  if (sessionId) {
    // If sessionId provided, prioritize that session's subagents directory
    sessionDirsToCheck.push(sessionId);
  }

  // Also check all directories that might contain subagents
  const projectEntries = await fs.readdir(projectPath, { withFileTypes: true });
  for (const entry of projectEntries) {
    if (entry.isDirectory() && !sessionDirsToCheck.includes(entry.name)) {
      sessionDirsToCheck.push(entry.name);
    }
  }

  for (const sessionDir of sessionDirsToCheck) {
    const subagentsPath = path.join(projectPath, sessionDir, 'subagents');
    if (await fs.pathExists(subagentsPath)) {
      try {
        const subagentFiles = await fs.readdir(subagentsPath);
        for (const agentFile of subagentFiles) {
          if (agentFile.startsWith('agent-') && agentFile.endsWith('.jsonl')) {
            const agentId = agentFile.replace('agent-', '').replace('.jsonl', '');
            // Avoid duplicates
            if (!agentFilesToAnalyze.find(a => a.agentId === agentId)) {
              agentFilesToAnalyze.push({
                fileName: agentFile,
                filePath: path.join(subagentsPath, agentFile),
                agentId,
                parentSessionId: sessionDir
              });
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to read subagents in ${sessionDir}:`, error.message);
      }
    }
  }

  // Analyze each agent file
  for (const agentInfo of agentFilesToAnalyze) {
    const { agentId, filePath: agentPath, fileName: agentFile, parentSessionId } = agentInfo;

    // Skip if it's the main agent
    if (agentId === mainAgentId) continue;

    // Skip if not referenced in main session
    if (!sessionAgentIds.has(agentId)) continue;

    try {
      const agentParsed = await parseJsonlFile(agentPath);

      // Calculate subagent tokens
      let totalTokens = 0;
      let messageCount = 0;

      for (const message of agentParsed.messages) {
        totalTokens += message.tokens.total;
        messageCount++;
      }

      subagents.push({
        agentId,
        filePath: agentPath,
        fileName: agentFile,
        spawnedBy: mainAgentId,
        parentSessionId,
        messageCount,
        tokens: {
          total: totalTokens,
          average: messageCount > 0 ? totalTokens / messageCount : 0
        },
        firstMessage: agentParsed.messages[0]?.timestamp || null,
        lastMessage: agentParsed.messages[agentParsed.messages.length - 1]?.timestamp || null
      });
    } catch (error) {
      console.warn(`Failed to analyze subagent ${agentFile}:`, error.message);
    }
  }

  // Also check for session files that might be subagents (based on sessionId)
  const sessionFiles = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));

  for (const sessionFile of sessionFiles) {
    try {
      const sessionPath = path.join(projectPath, sessionFile);
      const sessionParsed = await parseJsonlFile(sessionPath);

      // Check if this session contains messages from our identified subagent IDs
      const sessionAgentIds = new Set(sessionParsed.messages.map(m => m.agentId));

      for (const agentId of sessionAgentIds) {
        if (agentId === mainAgentId) continue;
        if (!sessionAgentIds.has(agentId)) continue;

        // This might be a subagent session
        const isNewSubagent = !subagents.find(s => s.agentId === agentId);
        if (isNewSubagent) {
          let totalTokens = 0;
          for (const message of sessionParsed.messages) {
            if (message.agentId === agentId) {
              totalTokens += message.tokens.total;
            }
          }

          const messageCount = sessionParsed.messages.filter(m => m.agentId === agentId).length;

          subagents.push({
            agentId,
            filePath: sessionPath,
            fileName: sessionFile,
            spawnedBy: mainAgentId,
            messageCount,
            tokens: {
              total: totalTokens,
              average: messageCount > 0 ? totalTokens / messageCount : 0
            },
            firstMessage: sessionParsed.messages[0]?.timestamp || null,
            lastMessage: sessionParsed.messages[sessionParsed.messages.length - 1]?.timestamp || null
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to analyze session file ${sessionFile}:`, error.message);
    }
  }

  return subagents;
}

/**
 * Get subagent hierarchy (parent-child relationships)
 */
export async function getSubagentHierarchy(parsed, projectId, subagents) {
  const hierarchy = [];
  const processedIds = new Set();

  // Start with main agent
  const mainAgent = {
    id: parsed.messages[0]?.agentId || 'main',
    name: 'Main Agent',
    level: 0,
    children: [],
    messageCount: parsed.messages.length,
    tokens: 0
  };

  // Calculate main agent tokens
  for (const message of parsed.messages) {
    if (!message.isSidechain) {
      mainAgent.tokens += message.tokens.total;
    }
  }

  // Add subagents as children
  if (subagents && subagents.length > 0) {
    for (const subagent of subagents) {
      mainAgent.children.push({
        id: subagent.agentId,
        name: `Agent ${subagent.agentId.substring(0, 6)}`,
        level: 1,
        children: [],
        messageCount: subagent.messageCount,
        tokens: subagent.tokens.total
      });
      processedIds.add(subagent.agentId);
    }
  }

  hierarchy.push(mainAgent);

  return hierarchy;
}

/**
 * Check if removing a message chain would break subagent context
 */
export function checkSubagentDependencies(parsed, subagents, messageUuids) {
  const removeSet = new Set(messageUuids);
  const warnings = [];

  // Check if any subagent messages reference removed main agent messages
  for (const subagent of subagents || []) {
    for (const message of parsed.messages) {
      if (message.agentId === subagent.agentId) {
        // Check if this message's parents are being removed
        let parent = message.parentUuid;
        while (parent) {
          if (removeSet.has(parent)) {
            warnings.push({
              type: 'subagent_context_broken',
              severity: 'high',
              message: `Removing message ${parent.substring(0, 8)} would break context for subagent ${subagent.agentId}`,
              subagentId: subagent.agentId,
              affectedMessageUuid: message.uuid
            });
            break;
          }

          // Find parent message
          const parentMessage = parsed.messages.find(m => m.uuid === parent);
          parent = parentMessage?.parentUuid;
        }
      }
    }
  }

  return warnings;
}
