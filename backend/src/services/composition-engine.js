import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { parseJsonlFile } from './jsonl-parser.js';
import {
  loadManifest,
  saveManifest,
  getSession
} from './memory-manifest.js';
import {
  getComposedDir,
  getSummariesDir,
  ensureDirectoryStructure
} from './memory-storage.js';
import {
  createCompressionVersion,
  getVersionsPath,
  getVersionContent
} from './memory-versions.js';
import { extractTextContent } from './summarizer.js';
import { readJsonlAsArray, readJsonlContent } from '../utils/streaming-jsonl.js';
import {
  getPartsByNumber,
  getHighestPartNumber,
  getPartVersions
} from './memory-delta.js';
// Part-aware composition functions
import {
  selectBestVersionsForParts,
  calculateTotalPartTokens,
  calculateTotalPartMessages,
  checkPartsFitBudget,
  composeFromParts,
  getSessionPartInfo
} from './composition-parts.js';

// Re-export part functions for external use
export {
  selectBestVersionsForParts,
  calculateTotalPartTokens,
  calculateTotalPartMessages,
  checkPartsFitBudget,
  composeFromParts,
  getSessionPartInfo
};

// ============================================
// Task 4.1: Version Selection Algorithm
// ============================================

/**
 * Score a compression version against selection criteria
 * Returns a score from 0 to 1 where higher is better
 *
 * @param {Object} version - The compression version to score
 * @param {Object} criteria - Selection criteria
 * @param {number} criteria.maxTokens - Maximum token budget
 * @param {number} criteria.preferredRatio - Preferred compression ratio
 * @param {boolean} criteria.preserveKeepits - Whether to prioritize keepit preservation
 * @returns {number} Score from 0 to 1
 */
export function scoreVersion(version, criteria) {
  let score = 1.0;

  // Token budget fit (most important)
  if (criteria.maxTokens) {
    if (version.outputTokens > criteria.maxTokens) {
      // Over budget penalty - significantly reduce score
      score *= 0.1;
    } else {
      // Calculate utilization - prefer versions that use more of the budget
      const utilization = version.outputTokens / criteria.maxTokens;
      // Score range: 0.5 (0% utilization) to 1.0 (100% utilization)
      score *= 0.5 + (utilization * 0.5);
    }
  }

  // Ratio preference
  if (criteria.preferredRatio) {
    const ratioDiff = Math.abs(version.compressionRatio - criteria.preferredRatio);
    // Score decreases as ratio differs from preferred
    // Max 50% penalty for ratio difference
    score *= Math.max(0.5, 1 - (ratioDiff / 50));
  }

  // Keepit preservation priority
  if (criteria.preserveKeepits && version.keepitStats) {
    const total = version.keepitStats.preserved + version.keepitStats.summarized;
    if (total > 0) {
      const preservationRate = version.keepitStats.preserved / total;
      // Score range: 0.5 (0% preserved) to 1.0 (100% preserved)
      score *= 0.5 + (preservationRate * 0.5);
    }
  }

  // Recency bonus - prefer newer versions slightly
  if (version.createdAt && criteria.preferRecent) {
    const ageMs = Date.now() - new Date(version.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // Small penalty for older versions (up to 10% for 30+ day old versions)
    score *= Math.max(0.9, 1 - (ageDays / 300));
  }

  return score;
}

/**
 * Select the best compression version for a session given criteria
 * Returns 'original' if original fits, version object if found, or 'need-new-compression'
 *
 * @param {Object} session - The session object from manifest
 * @param {Object} criteria - Selection criteria
 * @returns {'original' | 'need-new-compression' | Object} Selected version or action needed
 */
export function selectBestVersion(session, criteria) {
  // If original fits within budget, use it
  if (!criteria.maxTokens || session.originalTokens <= criteria.maxTokens) {
    return 'original';
  }

  // If no compression versions exist, need new compression
  if (!session.compressions || session.compressions.length === 0) {
    return 'need-new-compression';
  }

  // Score all versions
  const scored = session.compressions
    .map(version => ({
      version,
      score: scoreVersion(version, criteria)
    }))
    .sort((a, b) => b.score - a.score);

  // Return best if score is acceptable (>= 0.5)
  if (scored[0].score >= 0.5) {
    return scored[0].version;
  }

  // No suitable version found, need new compression
  return 'need-new-compression';
}

/**
 * Find the best existing version that fits a token budget
 * Does not trigger new compression, just returns what's available
 *
 * @param {Object} session - The session object from manifest
 * @param {number} maxTokens - Maximum token budget
 * @returns {Object|null} Best fitting version or null
 */
export function findBestFittingVersion(session, maxTokens) {
  // Check if original fits
  if (session.originalTokens <= maxTokens) {
    return {
      versionId: 'original',
      outputTokens: session.originalTokens,
      outputMessages: session.originalMessages,
      compressionRatio: 1.0,
      isOriginal: true
    };
  }

  // Find versions that fit within budget
  const fittingVersions = (session.compressions || [])
    .filter(v => v.outputTokens <= maxTokens)
    .sort((a, b) => b.outputTokens - a.outputTokens); // Prefer larger (more detail)

  return fittingVersions.length > 0 ? fittingVersions[0] : null;
}

// ============================================
// Task 4.2: Token Budget Allocation
// ============================================

/**
 * Allocate token budget across multiple components
 *
 * @param {Array} components - Array of component objects with originalTokens
 * @param {number} totalBudget - Total token budget to allocate
 * @param {string} strategy - Allocation strategy: 'equal', 'proportional', 'recency'
 * @returns {Array<number>} Array of allocated budgets per component
 */
export function allocateTokenBudget(components, totalBudget, strategy = 'equal') {
  if (!components || components.length === 0) {
    return [];
  }

  // Reserve small buffer for composition overhead (headers, separators)
  const overheadPerComponent = 50; // tokens for headers
  const availableBudget = Math.max(0, totalBudget - (components.length * overheadPerComponent));

  switch (strategy) {
    case 'equal':
      // Simple equal division
      const equalShare = Math.floor(availableBudget / components.length);
      return components.map(() => equalShare);

    case 'proportional':
      // Allocate based on original session sizes
      const totalOriginal = components.reduce((sum, c) => sum + (c.originalTokens || 0), 0);
      if (totalOriginal === 0) {
        // Fall back to equal if no size data
        return components.map(() => Math.floor(availableBudget / components.length));
      }
      return components.map(c =>
        Math.floor(((c.originalTokens || 0) / totalOriginal) * availableBudget)
      );

    case 'recency':
      // More budget to recent sessions (later in array = more recent)
      // Weights: [1, 2, 3, ...n] for n components
      const weights = components.map((_, i) => i + 1);
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      return weights.map(w => Math.floor((w / totalWeight) * availableBudget));

    case 'inverse-recency':
      // More budget to older sessions (preserve historical context)
      // Weights: [n, n-1, ...2, 1] for n components
      const inverseWeights = components.map((_, i) => components.length - i);
      const totalInverseWeight = inverseWeights.reduce((a, b) => a + b, 0);
      return inverseWeights.map(w => Math.floor((w / totalInverseWeight) * availableBudget));

    case 'custom':
      // Expect components to have a 'weight' property
      const customWeights = components.map(c => c.weight || 1);
      const totalCustomWeight = customWeights.reduce((a, b) => a + b, 0);
      return customWeights.map(w => Math.floor((w / totalCustomWeight) * availableBudget));

    default:
      throw new Error(`Unknown allocation strategy: ${strategy}`);
  }
}

/**
 * Calculate suggested allocation based on session metadata
 * Returns allocation recommendation with reasoning
 */
export function suggestAllocation(sessions, totalBudget) {
  const totalOriginalTokens = sessions.reduce((sum, s) => sum + (s.originalTokens || 0), 0);
  const avgSessionTokens = totalOriginalTokens / sessions.length;

  // Determine best strategy based on session characteristics
  let recommendedStrategy = 'equal';
  let reasoning = '';

  // If sessions vary significantly in size, use proportional
  const sizes = sessions.map(s => s.originalTokens || 0);
  const minSize = Math.min(...sizes);
  const maxSize = Math.max(...sizes);
  const sizeVariation = minSize > 0 ? maxSize / minSize : Infinity;

  if (sizeVariation > 3) {
    recommendedStrategy = 'proportional';
    reasoning = 'Sessions vary significantly in size; proportional allocation preserves relative detail levels.';
  } else if (sessions.length > 5) {
    recommendedStrategy = 'recency';
    reasoning = 'Many sessions; recency weighting prioritizes recent context.';
  } else {
    reasoning = 'Sessions are similar in size; equal allocation is appropriate.';
  }

  const allocations = allocateTokenBudget(sessions, totalBudget, recommendedStrategy);

  return {
    strategy: recommendedStrategy,
    reasoning,
    allocations,
    perSessionBudgets: sessions.map((s, i) => ({
      sessionId: s.sessionId,
      originalTokens: s.originalTokens,
      allocatedBudget: allocations[i],
      compressionRequired: s.originalTokens > allocations[i]
    }))
  };
}

// ============================================
// Task 4.3: Multi-Session Composition Logic
// ============================================

/**
 * Compose context from multiple sessions
 * Main entry point for composition
 *
 * @param {string} projectId - Project ID
 * @param {Object} request - Composition request
 * @returns {Object} Composition record
 */
export async function composeContext(projectId, request) {
  const {
    name,
    components,
    totalTokenBudget,
    allocationStrategy = 'equal',
    outputFormat = 'both', // 'md', 'jsonl', or 'both'
    model = 'opus',
    description = ''
  } = request;

  // Validate required fields
  if (!name || typeof name !== 'string') {
    const error = new Error('Composition name is required');
    error.code = 'INVALID_NAME';
    error.status = 400;
    throw error;
  }

  if (!components || !Array.isArray(components) || components.length === 0) {
    const error = new Error('At least one component is required');
    error.code = 'NO_COMPONENTS';
    error.status = 400;
    throw error;
  }

  if (!totalTokenBudget || typeof totalTokenBudget !== 'number' || totalTokenBudget < 1000) {
    const error = new Error('Total token budget must be at least 1000');
    error.code = 'INVALID_BUDGET';
    error.status = 400;
    throw error;
  }

  // Load manifest
  const manifest = await loadManifest(projectId);

  // Validate all sessions exist
  for (const comp of components) {
    if (!manifest.sessions[comp.sessionId]) {
      const error = new Error(`Session not found: ${comp.sessionId}`);
      error.code = 'SESSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }
  }

  // Build session info for allocation
  const sessionsInfo = components.map(comp => {
    const session = manifest.sessions[comp.sessionId];
    return {
      sessionId: comp.sessionId,
      originalTokens: session.originalTokens,
      originalMessages: session.originalMessages,
      weight: comp.weight || 1
    };
  });

  // Allocate budget
  const allocations = allocateTokenBudget(
    sessionsInfo,
    totalTokenBudget,
    allocationStrategy === 'custom' && components.some(c => c.weight) ? 'custom' : allocationStrategy
  );

  // Select or create versions for each component
  const selectedComponents = [];
  let totalMessages = 0;

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    const session = manifest.sessions[comp.sessionId];
    const budget = allocations[i];

    let selectedVersion;
    let versionId;
    let tokenContribution;
    let messageContribution;

    // Determine which version to use
    if (comp.versionId && comp.versionId !== 'auto') {
      // Specific version requested
      if (comp.versionId === 'original') {
        selectedVersion = 'original';
        versionId = 'original';
        tokenContribution = session.originalTokens;
        messageContribution = session.originalMessages;
      } else {
        selectedVersion = session.compressions.find(v => v.versionId === comp.versionId);
        if (!selectedVersion) {
          const error = new Error(`Version ${comp.versionId} not found for session ${comp.sessionId}`);
          error.code = 'VERSION_NOT_FOUND';
          error.status = 404;
          throw error;
        }
        versionId = selectedVersion.versionId;
        tokenContribution = selectedVersion.outputTokens;
        messageContribution = selectedVersion.outputMessages;
      }
    } else if (comp.recompressSettings) {
      // Create new compression with specific settings
      selectedVersion = await createCompressionVersion(projectId, comp.sessionId, {
        ...comp.recompressSettings,
        sessionDistance: i + 1,
        model
      });
      versionId = selectedVersion.versionId;
      tokenContribution = selectedVersion.outputTokens;
      messageContribution = selectedVersion.outputMessages;
    } else if (comp.usePartSelection) {
      // Part-aware selection: select best version for each part
      const selectedPartVersions = selectBestVersionsForParts(session, {
        maxTokens: budget,
        preserveKeepits: true
      });

      tokenContribution = calculateTotalPartTokens(selectedPartVersions);
      messageContribution = calculateTotalPartMessages(selectedPartVersions);
      versionId = 'auto-parts';

      // Store selected parts info with the component
      selectedComponents.push({
        sessionId: comp.sessionId,
        versionId,
        order: i,
        tokenContribution,
        messageContribution,
        allocatedBudget: budget,
        selectedParts: selectedPartVersions // Array of part versions
      });

      totalMessages += messageContribution;
      continue; // Skip the standard push below
    } else {
      // Auto-select best version or create new one
      const selectionResult = selectBestVersion(session, {
        maxTokens: budget,
        preserveKeepits: true
      });

      if (selectionResult === 'original') {
        versionId = 'original';
        tokenContribution = session.originalTokens;
        messageContribution = session.originalMessages;
      } else if (selectionResult === 'need-new-compression') {
        // Calculate required compression ratio
        const requiredRatio = Math.ceil(session.originalTokens / budget);
        const compressionRatio = Math.max(2, Math.min(50, requiredRatio));

        // Create new compression
        selectedVersion = await createCompressionVersion(projectId, comp.sessionId, {
          mode: 'tiered',
          tierPreset: compressionRatio > 20 ? 'aggressive' : (compressionRatio > 10 ? 'standard' : 'gentle'),
          model,
          sessionDistance: i + 1
        });

        versionId = selectedVersion.versionId;
        tokenContribution = selectedVersion.outputTokens;
        messageContribution = selectedVersion.outputMessages;
      } else {
        // Use existing version
        versionId = selectionResult.versionId;
        tokenContribution = selectionResult.outputTokens;
        messageContribution = selectionResult.outputMessages;
      }
    }

    selectedComponents.push({
      sessionId: comp.sessionId,
      versionId,
      order: i,
      tokenContribution,
      messageContribution,
      allocatedBudget: budget
    });

    totalMessages += messageContribution;
  }

  // Generate output files
  const outputFiles = await generateComposedOutput(
    projectId,
    name,
    selectedComponents,
    manifest,
    outputFormat
  );

  // Create composition record
  const compositionId = uuidv4();
  const record = {
    compositionId,
    name,
    description,
    createdAt: new Date().toISOString(),
    components: selectedComponents,
    allocationStrategy,
    totalTokenBudget,
    actualTokens: selectedComponents.reduce((sum, c) => sum + c.tokenContribution, 0),
    totalMessages,
    outputFiles,
    usedInSessions: []
  };

  // Save to manifest
  manifest.compositions = manifest.compositions || {};
  manifest.compositions[compositionId] = record;
  await saveManifest(projectId, manifest);

  return record;
}

// ============================================
// Task 4.4: Output Generation (MD/JSONL)
// ============================================

/**
 * Generate composed output files
 *
 * @param {string} projectId - Project ID
 * @param {string} name - Composition name
 * @param {Array} components - Selected components
 * @param {Object} manifest - Project manifest
 * @param {string} format - Output format: 'md', 'jsonl', or 'both'
 * @returns {Object} Output file paths and metadata
 */
async function generateComposedOutput(projectId, name, components, manifest, format) {
  // Create composition directory
  const composedDir = getComposedDir(projectId);
  const sanitizedName = sanitizeName(name);
  const outputDir = path.join(composedDir, sanitizedName);
  await fs.ensureDir(outputDir);

  const outputs = {};
  const timestamp = new Date().toISOString();

  // Collect all content from components
  const componentContents = [];

  for (const comp of components) {
    const session = manifest.sessions[comp.sessionId];
    let content;
    let messages = [];

    if (comp.selectedParts && comp.selectedParts.length > 0) {
      // Part-aware composition: combine messages from multiple parts
      messages = await composeFromParts(projectId, comp.sessionId, comp.selectedParts);

      // Build part info for content record
      const partInfo = comp.selectedParts.map(p => ({
        partNumber: p.partNumber,
        versionId: p.versionId,
        outputTokens: p.outputTokens,
        isOriginal: p.isOriginal || false
      }));

      content = {
        sessionId: comp.sessionId,
        versionId: 'auto-parts',
        isOriginal: false,
        messages,
        compressionRatio: null, // Multiple parts, no single ratio
        timestamp: new Date().toISOString(),
        parts: partInfo
      };
    } else if (comp.versionId === 'original') {
      // Read original session file
      const sourceFile = session.linkedFile || session.originalFile;
      const parsed = await parseJsonlFile(sourceFile);
      messages = parsed.messages;
      content = {
        sessionId: comp.sessionId,
        versionId: 'original',
        isOriginal: true,
        messages,
        metadata: parsed.metadata,
        timestamp: parsed.summary?.timestamp || session.registeredAt
      };
    } else {
      // Read compressed version
      const versionsDir = getVersionsPath(projectId, comp.sessionId);
      const compression = session.compressions.find(c => c.versionId === comp.versionId);

      if (compression) {
        const jsonlPath = path.join(versionsDir, `${compression.file}.jsonl`);
        if (await fs.pathExists(jsonlPath)) {
          // Use streaming for large files to avoid ERR_STRING_TOO_LONG
          const records = await readJsonlAsArray(jsonlPath);
          for (const record of records) {
            if (record.type === 'user' || record.type === 'assistant') {
              messages.push(record);
            }
          }
        }
      }

      content = {
        sessionId: comp.sessionId,
        versionId: comp.versionId,
        isOriginal: false,
        messages,
        compressionRatio: compression?.compressionRatio || null,
        timestamp: compression?.createdAt || null
      };
    }

    componentContents.push(content);
  }

  // Generate markdown output
  if (format === 'md' || format === 'both') {
    const mdContent = generateMarkdownComposition(name, componentContents, components, timestamp);
    const mdPath = path.join(outputDir, `${sanitizedName}.md`);
    await fs.writeFile(mdPath, mdContent, 'utf-8');
    outputs.md = {
      path: mdPath,
      size: Buffer.byteLength(mdContent, 'utf-8')
    };
  }

  // Generate JSONL output
  if (format === 'jsonl' || format === 'both') {
    const jsonlContent = generateJsonlComposition(name, componentContents, components, timestamp);
    const jsonlPath = path.join(outputDir, `${sanitizedName}.jsonl`);
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');
    outputs.jsonl = {
      path: jsonlPath,
      size: Buffer.byteLength(jsonlContent, 'utf-8')
    };
  }

  // Generate composition metadata file
  const metadataContent = JSON.stringify({
    compositionName: name,
    createdAt: timestamp,
    components: components.map(c => ({
      sessionId: c.sessionId,
      versionId: c.versionId,
      order: c.order,
      tokenContribution: c.tokenContribution,
      messageContribution: c.messageContribution,
      // Include selected parts info if available
      selectedParts: c.selectedParts ? c.selectedParts.map(p => ({
        partNumber: p.partNumber,
        versionId: p.versionId,
        outputTokens: p.outputTokens
      })) : undefined
    })),
    totalTokens: components.reduce((sum, c) => sum + c.tokenContribution, 0),
    totalMessages: components.reduce((sum, c) => sum + c.messageContribution, 0),
    lineage: componentContents.map(c => ({
      sessionId: c.sessionId,
      versionId: c.versionId,
      isOriginal: c.isOriginal,
      compressionRatio: c.compressionRatio,
      // Include parts info if composition used parts
      parts: c.parts || undefined
    }))
  }, null, 2);

  const metadataPath = path.join(outputDir, 'composition.json');
  await fs.writeFile(metadataPath, metadataContent, 'utf-8');
  outputs.metadata = {
    path: metadataPath,
    size: Buffer.byteLength(metadataContent, 'utf-8')
  };

  return outputs;
}

/**
 * Generate markdown composition output
 */
function generateMarkdownComposition(name, componentContents, components, timestamp) {
  const lines = [];

  // Header
  lines.push(`# Composed Context: ${name}`);
  lines.push('');
  lines.push(`Generated: ${timestamp}`);
  lines.push(`Sessions: ${components.length}`);
  lines.push(`Total Tokens: ${components.reduce((sum, c) => sum + c.tokenContribution, 0)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Table of contents
  lines.push('## Contents');
  lines.push('');
  for (let i = 0; i < componentContents.length; i++) {
    const content = componentContents[i];
    const comp = components[i];
    lines.push(`${i + 1}. [Session: ${content.sessionId}](#session-${i + 1}) - ${comp.tokenContribution} tokens (${content.isOriginal ? 'original' : `compressed ${content.compressionRatio}x`})`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Each session's content
  for (let i = 0; i < componentContents.length; i++) {
    const content = componentContents[i];
    const comp = components[i];

    lines.push(`## Session ${i + 1}: ${content.sessionId} {#session-${i + 1}}`);
    lines.push('');
    lines.push(`| Property | Value |`);
    lines.push(`|----------|-------|`);
    lines.push(`| Version | ${content.versionId} |`);
    lines.push(`| Tokens | ${comp.tokenContribution} |`);
    lines.push(`| Messages | ${content.messages.length} |`);
    if (content.compressionRatio) {
      lines.push(`| Compression | ${content.compressionRatio}x |`);
    }
    lines.push('');

    // Messages
    for (const msg of content.messages) {
      const role = msg.type === 'user' ? 'User' : 'Assistant';
      const isSummarized = msg.isSummarized ? ' [SUMMARIZED]' : '';
      const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';

      lines.push(`### ${role}${isSummarized}`);
      if (timestamp) {
        lines.push(`*${timestamp}*`);
      }
      lines.push('');

      const text = extractMessageText(msg);
      if (text) {
        lines.push(text);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Provenance footer
  lines.push('## Provenance');
  lines.push('');
  lines.push('This composed context was generated from the following sources:');
  lines.push('');
  for (const content of componentContents) {
    const source = content.isOriginal
      ? `Original session`
      : `Compressed version (${content.compressionRatio}x)`;
    lines.push(`- **${content.sessionId}**: ${source}`);
  }

  return lines.join('\n');
}

/**
 * Generate JSONL composition output
 */
function generateJsonlComposition(name, componentContents, components, timestamp) {
  const lines = [];

  // Composition metadata header
  const header = {
    type: 'composition-metadata',
    version: '1.0',
    compositionName: name,
    createdAt: timestamp,
    sessionCount: components.length,
    totalTokens: components.reduce((sum, c) => sum + c.tokenContribution, 0),
    totalMessages: components.reduce((sum, c) => sum + c.messageContribution, 0),
    lineage: componentContents.map((c, i) => ({
      order: i,
      sessionId: c.sessionId,
      versionId: c.versionId,
      isOriginal: c.isOriginal,
      compressionRatio: c.compressionRatio
    }))
  };
  lines.push(JSON.stringify(header));

  // Messages from each session with session markers
  for (let i = 0; i < componentContents.length; i++) {
    const content = componentContents[i];
    const comp = components[i];

    // Session boundary marker
    const sessionMarker = {
      type: 'session-boundary',
      sessionId: content.sessionId,
      versionId: content.versionId,
      order: i,
      tokenContribution: comp.tokenContribution,
      messageCount: content.messages.length
    };
    lines.push(JSON.stringify(sessionMarker));

    // All messages from this session
    for (const msg of content.messages) {
      const record = {
        type: msg.type,
        uuid: msg.uuid,
        parentUuid: msg.parentUuid,
        timestamp: msg.timestamp,
        sessionId: content.sessionId,
        compositionOrder: i,
        isSummarized: msg.isSummarized || false,
        message: {
          role: msg.type,
          content: msg.content || msg.message?.content
        }
      };
      lines.push(JSON.stringify(record));
    }
  }

  return lines.join('\n');
}

/**
 * Extract text content from a message
 */
function extractMessageText(message) {
  // Use imported extractTextContent if available in the message
  if (message.content) {
    if (typeof message.content === 'string') {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .filter(block => block && block.type === 'text')
        .map(block => block.text)
        .join('\n');
    }
  }

  if (message.message?.content) {
    if (typeof message.message.content === 'string') {
      return message.message.content;
    }
    if (Array.isArray(message.message.content)) {
      return message.message.content
        .filter(block => block && block.type === 'text')
        .map(block => block.text)
        .join('\n');
    }
  }

  return '';
}

/**
 * Sanitize composition name for filesystem
 */
function sanitizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 64);
}

// ============================================
// Additional Utility Functions
// ============================================

/**
 * Get composition by ID
 */
export async function getComposition(projectId, compositionId) {
  const manifest = await loadManifest(projectId);

  if (!manifest.compositions || !manifest.compositions[compositionId]) {
    const error = new Error(`Composition not found: ${compositionId}`);
    error.code = 'COMPOSITION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const composition = manifest.compositions[compositionId];

  // Add download URLs
  const composedDir = getComposedDir(projectId);
  const sanitizedName = sanitizeName(composition.name);
  const outputDir = path.join(composedDir, sanitizedName);

  return {
    ...composition,
    downloadUrls: {
      md: composition.outputFiles?.md
        ? `/api/memory/projects/${encodeURIComponent(projectId)}/compositions/${compositionId}/download?format=md`
        : null,
      jsonl: composition.outputFiles?.jsonl
        ? `/api/memory/projects/${encodeURIComponent(projectId)}/compositions/${compositionId}/download?format=jsonl`
        : null,
      metadata: `/api/memory/projects/${encodeURIComponent(projectId)}/compositions/${compositionId}/download?format=metadata`
    }
  };
}

/**
 * List all compositions for a project
 */
export async function listCompositions(projectId) {
  const manifest = await loadManifest(projectId);

  const compositions = Object.values(manifest.compositions || {});

  // Sort by creation date (most recent first)
  compositions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return compositions.map(comp => ({
    compositionId: comp.compositionId,
    name: comp.name,
    description: comp.description,
    createdAt: comp.createdAt,
    sessionCount: comp.components.length,
    totalTokens: comp.actualTokens,
    totalMessages: comp.totalMessages,
    allocationStrategy: comp.allocationStrategy
  }));
}

/**
 * Delete a composition
 */
export async function deleteComposition(projectId, compositionId) {
  const manifest = await loadManifest(projectId);

  if (!manifest.compositions || !manifest.compositions[compositionId]) {
    const error = new Error(`Composition not found: ${compositionId}`);
    error.code = 'COMPOSITION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const composition = manifest.compositions[compositionId];

  // Delete output directory
  const composedDir = getComposedDir(projectId);
  const sanitizedName = sanitizeName(composition.name);
  const outputDir = path.join(composedDir, sanitizedName);

  const deletedFiles = [];

  try {
    if (await fs.pathExists(outputDir)) {
      const files = await fs.readdir(outputDir);
      for (const file of files) {
        deletedFiles.push(path.join(outputDir, file));
      }
      await fs.remove(outputDir);
    }
  } catch (err) {
    console.error(`Failed to delete composition directory: ${err.message}`);
  }

  // Remove from manifest
  delete manifest.compositions[compositionId];
  await saveManifest(projectId, manifest);

  return {
    deleted: true,
    compositionId,
    name: composition.name,
    filesDeleted: deletedFiles
  };
}

/**
 * Get composition content
 */
export async function getCompositionContent(projectId, compositionId, format = 'md') {
  const manifest = await loadManifest(projectId);

  if (!manifest.compositions || !manifest.compositions[compositionId]) {
    const error = new Error(`Composition not found: ${compositionId}`);
    error.code = 'COMPOSITION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const composition = manifest.compositions[compositionId];
  const composedDir = getComposedDir(projectId);
  const sanitizedName = sanitizeName(composition.name);
  const outputDir = path.join(composedDir, sanitizedName);

  let filePath;
  let contentType;

  switch (format) {
    case 'md':
      filePath = path.join(outputDir, `${sanitizedName}.md`);
      contentType = 'text/markdown';
      break;
    case 'jsonl':
      filePath = path.join(outputDir, `${sanitizedName}.jsonl`);
      contentType = 'application/x-ndjson';
      break;
    case 'metadata':
      filePath = path.join(outputDir, 'composition.json');
      contentType = 'application/json';
      break;
    default:
      const error = new Error(`Invalid format: ${format}. Must be 'md', 'jsonl', or 'metadata'`);
      error.code = 'INVALID_FORMAT';
      error.status = 400;
      throw error;
  }

  if (!await fs.pathExists(filePath)) {
    const error = new Error(`Composition file not found: ${format}`);
    error.code = 'COMPOSITION_FILE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Use streaming for JSONL files to handle large files
  const content = format === 'jsonl'
    ? await readJsonlContent(filePath)
    : await fs.readFile(filePath, 'utf-8');

  return {
    content,
    contentType,
    filename: path.basename(filePath)
  };
}

/**
 * Record that a composition was used in a session
 */
export async function recordCompositionUsage(projectId, compositionId, sessionId) {
  const manifest = await loadManifest(projectId);

  if (!manifest.compositions || !manifest.compositions[compositionId]) {
    return; // Silently ignore if composition doesn't exist
  }

  const composition = manifest.compositions[compositionId];
  composition.usedInSessions = composition.usedInSessions || [];

  if (!composition.usedInSessions.includes(sessionId)) {
    composition.usedInSessions.push(sessionId);
    composition.lastUsed = new Date().toISOString();
    await saveManifest(projectId, manifest);
  }
}

/**
 * Preview composition without creating it
 * Returns what versions would be selected and budget allocation
 */
export async function previewComposition(projectId, request) {
  const {
    components,
    totalTokenBudget,
    allocationStrategy = 'equal'
  } = request;

  const manifest = await loadManifest(projectId);

  // Build session info for allocation
  const sessionsInfo = components.map(comp => {
    const session = manifest.sessions[comp.sessionId];
    if (!session) {
      return {
        sessionId: comp.sessionId,
        exists: false
      };
    }
    return {
      sessionId: comp.sessionId,
      exists: true,
      originalTokens: session.originalTokens,
      originalMessages: session.originalMessages,
      compressionCount: session.compressions?.length || 0,
      weight: comp.weight || 1
    };
  });

  // Check for missing sessions
  const missingSessions = sessionsInfo.filter(s => !s.exists);
  if (missingSessions.length > 0) {
    return {
      valid: false,
      error: `Sessions not found: ${missingSessions.map(s => s.sessionId).join(', ')}`,
      missingSessions: missingSessions.map(s => s.sessionId)
    };
  }

  // Calculate allocations
  const allocations = allocateTokenBudget(
    sessionsInfo,
    totalTokenBudget,
    allocationStrategy === 'custom' && components.some(c => c.weight) ? 'custom' : allocationStrategy
  );

  // Preview version selection for each component
  const preview = [];
  let totalEstimatedTokens = 0;
  let newCompressionsNeeded = 0;

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    const session = manifest.sessions[comp.sessionId];
    const budget = allocations[i];

    let selectedVersionPreview;

    if (comp.versionId && comp.versionId !== 'auto') {
      // Specific version requested
      if (comp.versionId === 'original') {
        selectedVersionPreview = {
          versionId: 'original',
          tokens: session.originalTokens,
          fitsInBudget: session.originalTokens <= budget
        };
      } else {
        const version = session.compressions.find(v => v.versionId === comp.versionId);
        if (version) {
          selectedVersionPreview = {
            versionId: version.versionId,
            tokens: version.outputTokens,
            fitsInBudget: version.outputTokens <= budget
          };
        } else {
          selectedVersionPreview = {
            versionId: comp.versionId,
            error: 'Version not found'
          };
        }
      }
    } else if (comp.usePartSelection) {
      // Part-aware selection preview
      const selectedPartVersions = selectBestVersionsForParts(session, {
        maxTokens: budget,
        preserveKeepits: true
      });

      const totalPartTokens = calculateTotalPartTokens(selectedPartVersions);
      const totalPartMessages = calculateTotalPartMessages(selectedPartVersions);

      selectedVersionPreview = {
        versionId: 'auto-parts',
        action: 'use-parts',
        tokens: totalPartTokens,
        messages: totalPartMessages,
        fitsInBudget: totalPartTokens <= budget,
        partCount: selectedPartVersions.length,
        parts: selectedPartVersions.map(p => ({
          partNumber: p.partNumber,
          versionId: p.versionId,
          outputTokens: p.outputTokens,
          isOriginal: p.isOriginal || false
        }))
      };
      totalEstimatedTokens += totalPartTokens;
    } else {
      // Auto-select
      const selectionResult = selectBestVersion(session, {
        maxTokens: budget,
        preserveKeepits: true
      });

      if (selectionResult === 'original') {
        selectedVersionPreview = {
          versionId: 'original',
          tokens: session.originalTokens,
          action: 'use-original'
        };
      } else if (selectionResult === 'need-new-compression') {
        newCompressionsNeeded++;
        const estimatedTokens = Math.min(budget, session.originalTokens);
        selectedVersionPreview = {
          versionId: null,
          action: 'create-new',
          estimatedTokens,
          requiredRatio: Math.ceil(session.originalTokens / budget)
        };
        totalEstimatedTokens += estimatedTokens;
      } else {
        selectedVersionPreview = {
          versionId: selectionResult.versionId,
          tokens: selectionResult.outputTokens,
          action: 'use-existing',
          compressionRatio: selectionResult.compressionRatio
        };
      }
    }

    if (selectedVersionPreview.tokens && !comp.usePartSelection) {
      totalEstimatedTokens += selectedVersionPreview.tokens;
    }

    // Get part info for the session
    const partInfo = getSessionPartInfo(session);

    preview.push({
      sessionId: comp.sessionId,
      allocatedBudget: budget,
      originalTokens: session.originalTokens,
      availableVersions: [
        { versionId: 'original', tokens: session.originalTokens },
        ...(session.compressions || []).map(v => ({
          versionId: v.versionId,
          tokens: v.outputTokens,
          compressionRatio: v.compressionRatio,
          partNumber: v.partNumber
        }))
      ],
      selectedVersion: selectedVersionPreview,
      // Include part info for UI
      partInfo: partInfo.hasParts ? {
        partCount: partInfo.partCount,
        totalCompressedTokens: partInfo.totalCompressedTokens,
        parts: partInfo.parts
      } : null
    });
  }

  return {
    valid: true,
    allocationStrategy,
    totalTokenBudget,
    totalEstimatedTokens,
    newCompressionsNeeded,
    components: preview
  };
}
