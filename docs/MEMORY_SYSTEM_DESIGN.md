# Memory System for LLM Context Management

## Design Document v1.0

**Date:** 2026-01-20
**Status:** Draft
**Author:** Claude Code Context Manager Team

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Data Model](#2-data-model)
3. [Storage Architecture](#3-storage-architecture)
4. [Core Algorithms](#4-core-algorithms)
5. [Workflows](#5-workflows)
6. [UI/UX Considerations](#6-uiux-considerations)
7. [Future Enhancements](#7-future-enhancements)
8. [Implementation Phases](#8-implementation-phases)

---

## 1. System Overview

### 1.1 Goals

The Memory System extends Claude Code Context Manager with persistent, cross-session memory capabilities that mimic human memory patterns:

1. **Preserve Important Information**: Maintain critical context across multiple coding sessions
2. **Progressive Compression**: Apply different compression levels based on age and relevance
3. **Composition**: Build new session contexts from multiple past sessions with appropriate compression
4. **Immutable Originals**: Never modify original session files; generate compressed versions on-demand
5. **Lineage Tracking**: Maintain full provenance of all compressions and compositions

### 1.2 Human Memory Analogy

```
Human Brain                    LLM Memory System
-------------------------------------------------------------
Working memory (active)        Current context window (live session)
Short-term memory (recent)     Recent sessions, light compression
Long-term memory (old)         Old sessions, heavy compression
Episodic memory (events)       ##keepit## marked moments
Semantic memory (knowledge)    Extracted patterns across sessions
Forgetting curve               Time-based compression decay
Rehearsal (re-remembering)     Accessing old sessions brings them forward
```

### 1.3 Architecture Overview

```
                    +---------------------------+
                    |   Claude Code Context     |
                    |       Manager (UI)        |
                    +-------------+-------------+
                                  |
                    +-------------v-------------+
                    |     Memory Service        |
                    | (Orchestration Layer)     |
                    +-------------+-------------+
                                  |
        +-------------------------+-------------------------+
        |                         |                         |
+-------v-------+        +--------v--------+       +--------v--------+
|   Session     |        |   Compression   |       |   Composition   |
|   Registry    |        |     Engine      |       |     Engine      |
+-------+-------+        +--------+--------+       +--------+--------+
        |                         |                         |
        +-------------------------+-------------------------+
                                  |
                    +-------------v-------------+
                    |    Storage Layer          |
                    |   (~/.claude-memory/)     |
                    +---------------------------+
```

### 1.4 Key Principles

1. **Non-Destructive**: Original `.jsonl` files in `~/.claude/projects/` are NEVER modified by the memory system
2. **Isolated Storage**: All memory data lives in `~/.claude-memory/`, separate from git repos
3. **Reproducible**: Any compression can be regenerated from the original with the same settings
4. **Composable**: Sessions can be combined in any configuration
5. **Transparent**: Full audit trail of what was compressed, when, and how

---

## 2. Data Model

### 2.1 Core Entities

#### 2.1.1 Project Record

```typescript
interface ProjectRecord {
  projectId: string;              // Sanitized path (e.g., "-home-dac-github-myapp")
  originalPath: string;           // Original path (e.g., "/home/dac/github/myapp")
  displayName: string;            // Human-readable name (e.g., "myapp")
  createdAt: string;              // ISO timestamp
  lastAccessed: string;           // ISO timestamp
  sessions: SessionRecord[];      // All sessions in this project
}
```

#### 2.1.2 Session Record

```typescript
interface SessionRecord {
  sessionId: string;              // UUID from Claude Code
  originalFile: string;           // Absolute path to original .jsonl
  originalTokens: number;         // Token count of original
  originalMessages: number;       // Message count of original
  firstTimestamp: string;         // Timestamp of first message
  lastTimestamp: string;          // Timestamp of last message
  registeredAt: string;           // When added to memory system
  lastAccessed: string;           // When last used in composition

  // Metadata extracted from session
  metadata: {
    gitBranch?: string;
    projectName?: string;
    claudeVersion?: string;
    primaryTopics?: string[];     // AI-extracted topics (future)
  };

  // Keepit markers found in this session
  keepitMarkers: KeepitMarker[];

  // All compression versions
  compressions: CompressionRecord[];
}
```

#### 2.1.3 Compression Record

```typescript
interface CompressionRecord {
  versionId: string;              // e.g., "v001", "v002"
  file: string;                   // Relative path within session folder
  createdAt: string;              // ISO timestamp

  // Compression settings used
  settings: CompressionSettings;

  // Results
  outputTokens: number;           // Resulting token count
  outputMessages: number;         // Resulting message count
  compressionRatio: number;       // Actual ratio achieved (input/output)

  // Keepit handling
  keepitStats: {
    preserved: number;            // Markers that survived
    summarized: number;           // Markers that were summarized
    weights: Record<string, number>; // Distribution of weights
  };

  // Lineage (if this was further compressed from another version)
  sourceVersion?: string;         // e.g., "v001" if compressed from v001
}

interface CompressionSettings {
  mode: 'uniform' | 'tiered';

  // For uniform mode
  compactionRatio?: number;       // e.g., 10, 30, 50
  aggressiveness?: 'minimal' | 'moderate' | 'aggressive';

  // For tiered mode
  tierPreset?: 'gentle' | 'standard' | 'aggressive' | 'custom';
  customTiers?: TierConfig[];

  // Common settings
  model: string;                  // Claude model used
  skipFirstMessages: number;      // Messages to skip

  // Keepit handling
  keepitMode: 'decay' | 'preserve-all' | 'ignore';
  sessionDistance?: number;       // For decay calculation (1 = current, 10 = old)
}

interface TierConfig {
  endPercent: number;
  compactionRatio: number;
  aggressiveness: 'minimal' | 'moderate' | 'aggressive';
}
```

#### 2.1.4 Keepit Marker

```typescript
interface KeepitMarker {
  markerId: string;               // Generated unique ID
  messageUuid: string;            // UUID of message containing marker
  weight: number;                 // 0.00 - 1.00
  content: string;                // The marked content
  position: {
    start: number;                // Character position in message
    end: number;
  };
  context: string;                // Surrounding text for display
  createdAt: string;              // When marker was added (if tracked)

  // Survival tracking
  survivedIn: string[];           // Version IDs where this marker survived
  summarizedIn: string[];         // Version IDs where this marker was summarized
}
```

#### 2.1.5 Composed Context Record

```typescript
interface ComposedContextRecord {
  compositionId: string;          // Generated UUID
  name: string;                   // User-provided name
  createdAt: string;              // ISO timestamp

  // Components
  components: CompositionComponent[];

  // Output
  outputFile: string;             // Path to composed file
  totalTokens: number;
  totalMessages: number;

  // Usage tracking
  usedInSessions: string[];       // Session IDs that used this composition
}

interface CompositionComponent {
  sessionId: string;
  versionId: string;              // Which compression version to use
  order: number;                  // Position in composition (0 = first)
  tokenContribution: number;      // Tokens from this component

  // Optional: recompress from original instead of using existing version
  recompress?: {
    settings: CompressionSettings;
    reason: string;               // Why recompression was needed
  };
}
```

### 2.2 Manifest Schema

The project manifest (`manifest.json`) ties everything together:

```typescript
interface ProjectManifest {
  version: string;                // Schema version (e.g., "1.0.0")
  projectId: string;
  originalPath: string;
  displayName: string;
  createdAt: string;
  lastModified: string;

  sessions: Record<string, SessionManifestEntry>;
  compositions: Record<string, ComposedContextRecord>;

  // Global settings
  settings: {
    defaultCompressionPreset: string;
    autoRegisterNewSessions: boolean;
    keepitDecayEnabled: boolean;
  };
}

interface SessionManifestEntry {
  sessionId: string;
  originalFile: string;
  originalTokens: number;
  originalMessages: number;
  firstTimestamp: string;
  lastTimestamp: string;
  registeredAt: string;
  lastAccessed: string;
  metadata: SessionMetadata;
  keepitMarkers: KeepitMarker[];
  compressions: CompressionRecord[];
}
```

---

## 3. Storage Architecture

### 3.1 Directory Structure

```
~/.claude-memory/                           # Root - isolated from git repos
├── config.json                             # Global configuration
├── projects/
│   ├── -home-dac-github-project-a/         # Project folder (sanitized path)
│   │   ├── manifest.json                   # Project manifest
│   │   ├── originals/                      # Symlinks or copies of original .jsonl
│   │   │   ├── abc123.jsonl -> /home/dac/.claude/projects/.../abc123.jsonl
│   │   │   └── def456.jsonl -> ...
│   │   ├── summaries/                      # Compressed versions
│   │   │   ├── abc123/                     # Session-specific folder
│   │   │   │   ├── v001_tiered-standard_10k.md
│   │   │   │   ├── v001_tiered-standard_10k.jsonl
│   │   │   │   ├── v002_uniform-aggressive_3k.md
│   │   │   │   ├── v002_uniform-aggressive_3k.jsonl
│   │   │   │   └── versions.json           # Version metadata for this session
│   │   │   └── def456/
│   │   │       ├── v001_tiered-gentle_15k.md
│   │   │       └── ...
│   │   └── composed/                       # Combined context files
│   │       ├── feature-x-context/
│   │       │   ├── composed.md
│   │       │   ├── composed.jsonl
│   │       │   └── composition.json        # What was combined
│   │       └── bugfix-session-start/
│   │           └── ...
│   └── -home-dac-github-project-b/
│       └── ...
└── cache/                                  # Temporary files
    └── ...
```

### 3.2 File Naming Conventions

**Compression files:**
```
v{version}_{mode}-{preset}_{tokens}k.{ext}
```

Examples:
- `v001_tiered-standard_10k.md` - Version 1, tiered mode, standard preset, ~10k tokens
- `v002_uniform-aggressive_3k.jsonl` - Version 2, uniform mode, aggressive, ~3k tokens
- `v003_tiered-custom_5k.md` - Version 3, tiered mode, custom settings, ~5k tokens

**Composition files:**
```
{name}/
├── composed.md
├── composed.jsonl
└── composition.json
```

### 3.3 Global Configuration

`~/.claude-memory/config.json`:

```json
{
  "version": "1.0.0",
  "createdAt": "2026-01-20T10:00:00Z",

  "storage": {
    "maxCacheSize": "1GB",
    "compressionRetention": "all"
  },

  "defaults": {
    "compressionPreset": "standard",
    "keepitDecayEnabled": true,
    "autoRegisterSessions": false,
    "model": "opus"
  },

  "keepitDecay": {
    "compressionBase": {
      "light": 0.1,
      "moderate": 0.3,
      "aggressive": 0.5
    },
    "maxSessionDistance": 10,
    "pinnedWeight": 1.0
  }
}
```

### 3.4 Session Versions Metadata

`summaries/{sessionId}/versions.json`:

```json
{
  "sessionId": "abc123",
  "originalFile": "/home/dac/.claude/projects/.../abc123.jsonl",
  "originalTokens": 100000,
  "originalMessages": 450,

  "versions": [
    {
      "versionId": "v001",
      "file": "v001_tiered-standard_10k",
      "createdAt": "2026-01-15T10:00:00Z",
      "settings": {
        "mode": "tiered",
        "tierPreset": "standard",
        "model": "opus",
        "skipFirstMessages": 0,
        "keepitMode": "decay",
        "sessionDistance": 1
      },
      "outputTokens": 10234,
      "outputMessages": 42,
      "compressionRatio": 9.8,
      "keepitStats": {
        "preserved": 5,
        "summarized": 2,
        "weights": { "1.00": 2, "0.80": 2, "0.50": 1, "0.25": 2 }
      }
    },
    {
      "versionId": "v002",
      "file": "v002_uniform-aggressive_3k",
      "createdAt": "2026-01-20T14:00:00Z",
      "settings": {
        "mode": "uniform",
        "compactionRatio": 30,
        "aggressiveness": "aggressive",
        "model": "opus",
        "skipFirstMessages": 0,
        "keepitMode": "decay",
        "sessionDistance": 10
      },
      "outputTokens": 3012,
      "outputMessages": 15,
      "compressionRatio": 33.2,
      "keepitStats": {
        "preserved": 2,
        "summarized": 5,
        "weights": { "1.00": 2, "0.80": 0, "0.50": 0, "0.25": 0 }
      }
    }
  ]
}
```

---

## 4. Core Algorithms

### 4.1 Weight Decay Calculation

The keepit weight decay model determines whether a marked piece of content survives compression or gets summarized.

#### 4.1.1 Threshold Formula

```
survival_threshold = compression_base + (ratio_penalty * distance_factor)

Where:
- compression_base: Baseline threshold based on compression level
    - light (ratios 2-5): 0.1
    - moderate (ratios 6-15): 0.3
    - aggressive (ratios 16+): 0.5

- ratio_penalty: The compression ratio divided by 100
    - Example: 30:1 compression = 0.30

- distance_factor: Session age normalized to 0-1 range
    - distance_factor = min(session_distance, max_distance) / max_distance
    - Default max_distance = 10
    - Example: Session 5 ago = 5/10 = 0.5
```

#### 4.1.2 Survival Decision

```typescript
function shouldKeepitSurvive(
  weight: number,
  sessionDistance: number,
  compressionRatio: number,
  aggressiveness: 'light' | 'moderate' | 'aggressive'
): boolean {
  // Pinned content (weight 1.0) ALWAYS survives
  if (weight >= 1.0) {
    return true;
  }

  const compressionBase = {
    light: 0.1,
    moderate: 0.3,
    aggressive: 0.5
  }[aggressiveness];

  const ratioPenalty = compressionRatio / 100;
  const maxDistance = 10;
  const distanceFactor = Math.min(sessionDistance, maxDistance) / maxDistance;

  const threshold = compressionBase + (ratioPenalty * distanceFactor);

  return weight >= threshold;
}
```

#### 4.1.3 Example Calculations

```
Example 1: ##keepit0.80## from session 1 (distance=10), aggressive 30:1
  threshold = 0.5 + (0.30 * 1.0) = 0.80
  weight 0.80 >= 0.80 -> BARELY SURVIVES

Example 2: ##keepit0.80## from session 5 (distance=5), aggressive 30:1
  threshold = 0.5 + (0.30 * 0.5) = 0.65
  weight 0.80 >= 0.65 -> SURVIVES

Example 3: ##keepit0.25## from session 1 (distance=10), moderate 15:1
  threshold = 0.3 + (0.15 * 1.0) = 0.45
  weight 0.25 < 0.45 -> SUMMARIZED

Example 4: ##keepit0.50## from session 3 (distance=7), light 5:1
  threshold = 0.1 + (0.05 * 0.7) = 0.135
  weight 0.50 >= 0.135 -> SURVIVES

Example 5: ##keepit1.00## (pinned) - any settings
  -> ALWAYS SURVIVES (special case)
```

### 4.2 Keepit Detection and Extraction

#### 4.2.1 Pattern Matching

```typescript
const KEEPIT_PATTERN = /##keepit(\d+\.\d{2})##([\s\S]*?)(?=##keepit|$)/gi;

interface ExtractedKeepit {
  weight: number;
  content: string;
  startIndex: number;
  endIndex: number;
}

function extractKeepitMarkers(text: string): ExtractedKeepit[] {
  const markers: ExtractedKeepit[] = [];
  let match;

  while ((match = KEEPIT_PATTERN.exec(text)) !== null) {
    markers.push({
      weight: parseFloat(match[1]),
      content: match[2].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }

  return markers;
}
```

#### 4.2.2 Weight Validation

```typescript
function validateWeight(weight: number): number {
  // Clamp to valid range
  if (weight < 0) return 0;
  if (weight > 1) return 1;

  // Round to 2 decimal places
  return Math.round(weight * 100) / 100;
}

// Suggested weight levels with semantic meaning
const WEIGHT_PRESETS = {
  PINNED: 1.00,      // Never summarized
  CRITICAL: 0.90,    // Very high decay resistance
  IMPORTANT: 0.75,   // High decay resistance
  NOTABLE: 0.50,     // Moderate decay resistance
  MINOR: 0.25,       // Low decay resistance
  HINT: 0.10         // Minimal decay resistance
};
```

### 4.3 Compression Version Selection

When composing context, the system must select appropriate compression versions:

```typescript
interface VersionSelectionCriteria {
  maxTokens?: number;           // Token budget for this component
  minFreshness?: number;        // Minimum "freshness" (1 = current, 10 = stale)
  preferredRatio?: number;      // Preferred compression ratio
  preserveKeepits?: boolean;    // Must preserve keepit markers
}

function selectBestVersion(
  session: SessionRecord,
  criteria: VersionSelectionCriteria
): CompressionRecord | 'original' | 'need-new-compression' {
  const versions = session.compressions;

  // If no versions exist, need to create one
  if (versions.length === 0) {
    return 'need-new-compression';
  }

  // If original fits within budget, use it
  if (!criteria.maxTokens || session.originalTokens <= criteria.maxTokens) {
    return 'original';
  }

  // Score each version
  const scored = versions.map(v => ({
    version: v,
    score: scoreVersion(v, criteria)
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // If best score is too low, might need new compression
  if (scored[0].score < 0.5) {
    return 'need-new-compression';
  }

  return scored[0].version;
}

function scoreVersion(
  version: CompressionRecord,
  criteria: VersionSelectionCriteria
): number {
  let score = 1.0;

  // Token budget fit (most important)
  if (criteria.maxTokens) {
    if (version.outputTokens > criteria.maxTokens) {
      // Over budget - major penalty
      score *= 0.1;
    } else {
      // Prefer versions that use more of the budget (less wasted)
      const utilization = version.outputTokens / criteria.maxTokens;
      score *= 0.5 + (utilization * 0.5);
    }
  }

  // Ratio preference
  if (criteria.preferredRatio) {
    const ratioDiff = Math.abs(version.compressionRatio - criteria.preferredRatio);
    score *= Math.max(0.5, 1 - (ratioDiff / 50));
  }

  // Keepit preservation
  if (criteria.preserveKeepits) {
    const preservationRate = version.keepitStats.preserved /
      (version.keepitStats.preserved + version.keepitStats.summarized);
    score *= 0.5 + (preservationRate * 0.5);
  }

  return score;
}
```

### 4.4 Composition Algorithm

```typescript
interface CompositionRequest {
  name: string;
  components: {
    sessionId: string;
    versionId?: string;           // Specific version or 'auto'
    recompressSettings?: CompressionSettings;
  }[];
  totalTokenBudget: number;
  outputFormat: 'markdown' | 'jsonl' | 'both';
}

async function composeContext(
  projectId: string,
  request: CompositionRequest
): Promise<ComposedContextRecord> {
  const manifest = await loadManifest(projectId);
  const components: CompositionComponent[] = [];

  // Calculate token budget per component (can be weighted)
  const perComponentBudget = request.totalTokenBudget / request.components.length;

  for (let i = 0; i < request.components.length; i++) {
    const comp = request.components[i];
    const session = manifest.sessions[comp.sessionId];

    if (!session) {
      throw new Error(`Session ${comp.sessionId} not found`);
    }

    let selectedVersion: CompressionRecord | string;

    if (comp.versionId && comp.versionId !== 'auto') {
      // Use specific version
      selectedVersion = session.compressions.find(v => v.versionId === comp.versionId);
      if (!selectedVersion) {
        throw new Error(`Version ${comp.versionId} not found for session ${comp.sessionId}`);
      }
    } else if (comp.recompressSettings) {
      // Generate new compression
      selectedVersion = await createCompression(session, comp.recompressSettings);
    } else {
      // Auto-select best version
      selectedVersion = selectBestVersion(session, {
        maxTokens: perComponentBudget,
        preserveKeepits: true
      });

      if (selectedVersion === 'need-new-compression') {
        // Create a new compression with appropriate settings
        selectedVersion = await createCompression(session, {
          mode: 'uniform',
          compactionRatio: Math.ceil(session.originalTokens / perComponentBudget),
          aggressiveness: 'moderate',
          model: 'opus',
          skipFirstMessages: 0,
          keepitMode: 'decay',
          sessionDistance: i + 1  // Older components get higher distance
        });
      }
    }

    const version = selectedVersion === 'original'
      ? { versionId: 'original', outputTokens: session.originalTokens }
      : selectedVersion as CompressionRecord;

    components.push({
      sessionId: comp.sessionId,
      versionId: version.versionId,
      order: i,
      tokenContribution: version.outputTokens
    });
  }

  // Generate composed output
  const composed = await generateComposedOutput(manifest, components, request.outputFormat);

  // Save composition record
  const record: ComposedContextRecord = {
    compositionId: generateUuid(),
    name: request.name,
    createdAt: new Date().toISOString(),
    components,
    outputFile: composed.path,
    totalTokens: components.reduce((sum, c) => sum + c.tokenContribution, 0),
    totalMessages: composed.messageCount,
    usedInSessions: []
  };

  await saveComposition(projectId, record);

  return record;
}
```

---

## 5. Workflows

### 5.1 Adding a New Session to the Memory System

```
1. User opens a session in the Context Manager
2. User clicks "Add to Memory System" button
3. System:
   a. Extracts session metadata (timestamps, tokens, messages)
   b. Scans for ##keepit## markers and extracts them
   c. Creates symlink in originals/ folder
   d. Updates project manifest
   e. Shows confirmation with session stats

UI Flow:
┌─────────────────────────────────────────────┐
│ Add Session to Memory                       │
├─────────────────────────────────────────────┤
│ Session: abc123                             │
│ Messages: 450 | Tokens: 100,234             │
│ Time Range: Jan 15 10:00 - Jan 15 18:30     │
│                                             │
│ Detected ##keepit## markers: 7              │
│   - ##keepit1.00## (2 pinned)              │
│   - ##keepit0.80## (2 important)           │
│   - ##keepit0.50## (2 notable)             │
│   - ##keepit0.25## (1 minor)               │
│                                             │
│ [Cancel]                    [Add to Memory] │
└─────────────────────────────────────────────┘
```

### 5.2 Creating a New Compression

```
1. User selects a session in the Memory Browser
2. User clicks "Create Compression"
3. User configures compression settings:
   - Mode: Uniform or Tiered
   - Ratio/Preset selection
   - Keepit handling mode
   - Session distance (for decay calculation)
4. System shows preview with estimated results
5. User confirms, system generates compression
6. New version appears in session's version list

UI Flow:
┌─────────────────────────────────────────────┐
│ Create Compression - Session abc123         │
├─────────────────────────────────────────────┤
│ Original: 100,234 tokens | 450 messages     │
│                                             │
│ Mode: [Uniform ▼]  [Tiered]                 │
│                                             │
│ ┌─ Uniform Settings ─────────────────────┐  │
│ │ Ratio: [30:1 ▼]                        │  │
│ │ Aggressiveness: [Aggressive ▼]         │  │
│ └────────────────────────────────────────┘  │
│                                             │
│ Session Distance: [5] (1=recent, 10=old)    │
│                                             │
│ ┌─ Keepit Handling ──────────────────────┐  │
│ │ [x] Apply decay model                  │  │
│ │ Markers: 7 total                       │  │
│ │   Will preserve: 2 (weight >= 0.65)    │  │
│ │   Will summarize: 5 (weight < 0.65)    │  │
│ └────────────────────────────────────────┘  │
│                                             │
│ ┌─ Preview ──────────────────────────────┐  │
│ │ Estimated output: ~3,300 tokens        │  │
│ │ Estimated messages: ~15                │  │
│ │ Compression ratio: ~30:1               │  │
│ └────────────────────────────────────────┘  │
│                                             │
│ [Cancel]                [Create Compression]│
└─────────────────────────────────────────────┘
```

### 5.3 Composing Context from Multiple Sessions

```
1. User opens "Compose Context" dialog
2. User selects parent sessions
3. For each session, user chooses:
   - Existing compression version, OR
   - Create new compression with specific settings
4. User sets total token budget
5. System auto-allocates tokens or user manually adjusts
6. User names the composition
7. System generates composed context file
8. Composition saved and available for use

UI Flow:
┌─────────────────────────────────────────────────────┐
│ Compose Context                                     │
├─────────────────────────────────────────────────────┤
│ Name: [feature-x-context_______________]            │
│                                                     │
│ Token Budget: [16000____] tokens                    │
│                                                     │
│ ┌─ Components ────────────────────────────────────┐ │
│ │ ┌────────────────────────────────────────────┐  │ │
│ │ │ 1. Session abc123 (Jan 15)                 │  │ │
│ │ │    Version: [v002 - 3k tokens ▼]           │  │ │
│ │ │    Allocation: [3000___] tokens            │  │ │
│ │ │    [ ] Recompress from original            │  │ │
│ │ └────────────────────────────────────────────┘  │ │
│ │ ┌────────────────────────────────────────────┐  │ │
│ │ │ 2. Session def456 (Jan 18)                 │  │ │
│ │ │    Version: [v001 - 8k tokens ▼]           │  │ │
│ │ │    Allocation: [8000___] tokens            │  │ │
│ │ │    [ ] Recompress from original            │  │ │
│ │ └────────────────────────────────────────────┘  │ │
│ │ ┌────────────────────────────────────────────┐  │ │
│ │ │ 3. Current session (compressing...)        │  │ │
│ │ │    Mode: [Tiered - Standard ▼]             │  │ │
│ │ │    Allocation: [5000___] tokens            │  │ │
│ │ └────────────────────────────────────────────┘  │ │
│ │                                                 │ │
│ │ [+ Add Session]                                 │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Total: 16,000 / 16,000 tokens                      │
│                                                     │
│ Output: [x] Markdown  [x] JSONL                    │
│                                                     │
│ [Cancel]                            [Compose]       │
└─────────────────────────────────────────────────────┘
```

### 5.4 Updating Keepit Weights

Users can modify keepit weights in messages (requires re-processing):

```
1. User opens session in Messages view
2. User locates message with ##keepit## marker
3. User edits the weight (e.g., ##keepit0.50## -> ##keepit0.80##)
4. System detects change and updates keepit registry
5. Existing compressions remain unchanged
6. New compressions will use updated weights

Note: This modifies the ORIGINAL session file, which is acceptable
since keepit markers are user-authored content.
```

### 5.5 Pruning Old/Unused Compressions

```
1. User opens Memory Settings or Session details
2. User clicks "Manage Compressions"
3. System shows all compression versions with:
   - Creation date
   - Last used date
   - Size
   - Used in compositions count
4. User selects versions to delete
5. System warns if version is used in active compositions
6. User confirms deletion
7. Files removed, manifest updated

UI Flow:
┌─────────────────────────────────────────────────────┐
│ Manage Compressions - Session abc123                │
├─────────────────────────────────────────────────────┤
│ Original: 100,234 tokens | Used in 0 compositions   │
│                                                     │
│ [ ] v001 - tiered-standard (10k tokens)            │
│     Created: Jan 15, 2026                          │
│     Last used: Jan 18, 2026                        │
│     Used in: 2 compositions                        │
│                                                     │
│ [x] v002 - uniform-aggressive (3k tokens)          │
│     Created: Jan 20, 2026                          │
│     Last used: Never                               │
│     Used in: 0 compositions                        │
│                                                     │
│ [x] v003 - tiered-gentle (15k tokens)              │
│     Created: Jan 20, 2026                          │
│     Last used: Never                               │
│     Used in: 0 compositions                        │
│                                                     │
│ Selected: 2 versions (18k tokens)                  │
│                                                     │
│ [Cancel]                      [Delete Selected]     │
└─────────────────────────────────────────────────────┘
```

---

## 6. UI/UX Considerations

### 6.1 Memory Browser Component

A new top-level component for browsing and managing memory:

```
┌─────────────────────────────────────────────────────────────┐
│ Memory Browser                                    [Settings]│
├─────────────────────────────────────────────────────────────┤
│ Projects: [my-app ▼]                                        │
├───────────────────────┬─────────────────────────────────────┤
│ Sessions              │ Session Details                     │
│ ─────────────────────│──────────────────────────────────────│
│ ▼ Jan 2026           │ abc123                               │
│   [M] abc123  100k   │ ────────────────────────────────────│
│   [ ] def456   45k   │ Original: 100,234 tokens            │
│   [M] ghi789   78k   │ Messages: 450                       │
│                      │ Date: Jan 15, 2026                  │
│ ▼ Dec 2025           │                                     │
│   [M] old123   50k   │ Compressions:                       │
│                      │ ┌──────────────────────────────────┐│
│                      │ │ v001 tiered-standard    10k  ▼  ││
│                      │ │ v002 uniform-aggressive  3k  ▼  ││
│                      │ └──────────────────────────────────┘│
│                      │                                     │
│ [M] = In Memory      │ Keepit Markers: 7                   │
│                      │ ┌──────────────────────────────────┐│
│                      │ │ ##keepit1.00## Architecture...  ││
│                      │ │ ##keepit0.80## API decision...  ││
│                      │ └──────────────────────────────────┘│
│                      │                                     │
│                      │ [Create Compression] [View Original]│
└──────────────────────┴─────────────────────────────────────┘
```

### 6.2 Composition Builder

Visual interface for building composed contexts:

```
┌─────────────────────────────────────────────────────────────┐
│ Composition Builder                                         │
├─────────────────────────────────────────────────────────────┤
│ ┌─ Token Budget ──────────────────────────────────────────┐ │
│ │ [========================================] 16k / 200k   │ │
│ │ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░ 8% of context window used         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ Composition Timeline ──────────────────────────────────┐ │
│ │                                                         │ │
│ │  ┌─────────┐    ┌─────────┐    ┌─────────┐             │ │
│ │  │Session 1│ -> │Session 2│ -> │Current  │             │ │
│ │  │  3k tok │    │  8k tok │    │  5k tok │             │ │
│ │  │ Jan 15  │    │ Jan 18  │    │ Jan 20  │             │ │
│ │  │ v002    │    │ v001    │    │ (new)   │             │ │
│ │  └────┬────┘    └────┬────┘    └────┬────┘             │ │
│ │       │              │              │                   │ │
│ │       └──────────────┴──────────────┘                   │ │
│ │                      │                                  │ │
│ │               [Composed Context]                        │ │
│ │                  16k tokens                             │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [Add Session]  [Preview]  [Export Markdown]  [Compose]      │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 Keepit Marker Editor

In-message editor for keepit markers:

```
┌─────────────────────────────────────────────────────────────┐
│ Message #234 - User                                         │
├─────────────────────────────────────────────────────────────┤
│ The architecture should use a layered approach:             │
│                                                             │
│ ┌─ Keepit Marker ────────────────────────────────────────┐  │
│ │ ##keepit[0.80]## This is the critical decision:        │  │
│ │                                                        │  │
│ │ We will use PostgreSQL for the main database because:  │  │
│ │ 1. JSONB support for flexible schemas                  │  │
│ │ 2. Strong ACID compliance                              │  │
│ │ 3. Excellent tooling ecosystem                         │  │
│ │                                                        │  │
│ │ Weight: [0.80 ▼]                                       │  │
│ │ Presets: [Pinned] [Critical] [Important] [Notable]     │  │
│ │                                                        │  │
│ │ Decay Preview:                                         │  │
│ │ - At distance 1, ratio 30:1: SURVIVES                  │  │
│ │ - At distance 5, ratio 30:1: SURVIVES                  │  │
│ │ - At distance 10, ratio 30:1: BARELY SURVIVES         │  │
│ │ - At distance 10, ratio 50:1: SUMMARIZED              │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                             │
│ Please implement this starting with the data layer.        │
└─────────────────────────────────────────────────────────────┘
```

### 6.4 Integration Points

The Memory System integrates with existing components:

1. **ProjectBrowser.vue**: Add "Memory" indicator to sessions
2. **SessionEditor.vue**: Add "Add to Memory" action
3. **SanitizationPanel.vue**: Add "Create Memory Compression" option
4. **New Components**:
   - `MemoryBrowser.vue` - Main memory management interface
   - `CompositionBuilder.vue` - Visual composition tool
   - `KeepitEditor.vue` - Inline keepit marker editor
   - `VersionSelector.vue` - Compression version picker

---

## 7. Future Enhancements

### 7.1 Auto-Suggest Relevant Context

```typescript
interface ContextSuggestion {
  sessionId: string;
  versionId: string;
  relevanceScore: number;
  matchedTopics: string[];
  matchedFiles: string[];
  suggestedTokens: number;
}

async function suggestRelevantContext(
  currentWorkingDir: string,
  currentFiles: string[],
  currentTopics: string[],
  tokenBudget: number
): Promise<ContextSuggestion[]> {
  // 1. Find sessions that touched the same files
  // 2. Find sessions with similar topics (AI-extracted)
  // 3. Score by recency, relevance, and file overlap
  // 4. Return top N suggestions that fit in budget
}
```

### 7.2 Cross-Project Memory Sharing

```typescript
interface SharedMemoryLink {
  sourceProject: string;
  sourceSession: string;
  targetProject: string;
  linkedAt: string;
  reason: string;  // "Shared utility code", "Related feature", etc.
}

// Allow linking sessions across projects for:
// - Shared libraries used by multiple projects
// - Monorepo sub-projects
// - Related microservices
```

### 7.3 Automatic Decay/Recompression Scheduling

```typescript
interface AutoDecayConfig {
  enabled: boolean;
  schedule: 'daily' | 'weekly' | 'on-access';

  rules: {
    // After 7 days, create moderate compression if none exists
    createAfterDays: number;
    createPreset: string;

    // After 30 days, create aggressive compression
    aggressiveAfterDays: number;
    aggressivePreset: string;

    // Delete intermediate versions after 60 days
    pruneIntermediateAfterDays: number;
  };
}

async function runAutoDecay(projectId: string, config: AutoDecayConfig) {
  // 1. Scan all sessions
  // 2. Identify sessions needing new compressions
  // 3. Generate compressions in background
  // 4. Prune old intermediate versions
  // 5. Update manifest
}
```

### 7.4 Semantic Memory Extraction

```typescript
interface SemanticMemory {
  id: string;
  type: 'pattern' | 'decision' | 'preference' | 'fact';
  content: string;
  confidence: number;
  sources: {
    sessionId: string;
    messageUuid: string;
    excerpt: string;
  }[];
  extractedAt: string;
  validatedByUser: boolean;
}

// Extract recurring patterns:
// - "User prefers functional programming style"
// - "Project uses Jest for testing"
// - "API follows REST conventions with /api/v1 prefix"
// - "Error handling uses Result type pattern"
```

### 7.5 Memory Search

```typescript
interface MemorySearchQuery {
  text?: string;           // Full-text search
  files?: string[];        // Sessions touching these files
  dateRange?: {
    start: string;
    end: string;
  };
  topics?: string[];       // AI-extracted topics
  keepitWeight?: {
    min: number;
    max: number;
  };
}

async function searchMemory(
  projectId: string,
  query: MemorySearchQuery
): Promise<SearchResult[]> {
  // Search across all sessions and compressions
  // Return ranked results with context snippets
}
```

---

## 8. Implementation Phases

### Phase 1: Foundation (MVP)

**Goal**: Basic memory storage and compression version management

**Duration**: 2-3 weeks

**Tasks**:
1. Create storage directory structure
2. Implement manifest schema and read/write
3. Add "Register Session" functionality
4. Basic compression version storage (leverage existing summarizer)
5. Simple version listing UI
6. Manual composition (select versions, concatenate)

**Deliverables**:
- `~/.claude-memory/` directory with proper structure
- Manifest management service
- "Add to Memory" button in session editor
- Version list in session details
- Basic "Compose" function

### Phase 2: Keepit Markers

**Goal**: Implement keepit marker detection and decay model

**Duration**: 2 weeks

**Tasks**:
1. Keepit pattern detection in messages
2. Keepit registry in manifest
3. Decay calculation algorithm
4. Integration with summarizer (preserve/summarize based on threshold)
5. Keepit stats in compression records
6. Basic keepit editor in message view

**Deliverables**:
- Keepit extraction and storage
- Decay model implementation
- Modified summarizer that respects keepit markers
- Visual keepit indicators in messages

### Phase 3: Smart Composition

**Goal**: Intelligent version selection and composition builder

**Duration**: 2-3 weeks

**Tasks**:
1. Version scoring algorithm
2. Auto-selection based on token budget
3. Composition Builder UI component
4. Token budget visualization
5. Composition history and reuse
6. "Recompress from original" option

**Deliverables**:
- Composition Builder component
- Smart version selection
- Token budget management
- Saved composition records

### Phase 4: Memory Browser

**Goal**: Dedicated UI for memory management

**Duration**: 2 weeks

**Tasks**:
1. Memory Browser main component
2. Session timeline view
3. Compression version management (create, delete, compare)
4. Keepit marker overview
5. Storage usage statistics
6. Import/export memory data

**Deliverables**:
- Full Memory Browser UI
- Version management tools
- Storage analytics

### Phase 5: Polish and Integration

**Goal**: Seamless integration with existing workflows

**Duration**: 1-2 weeks

**Tasks**:
1. Integration with existing session workflows
2. Keyboard shortcuts
3. Context menu integrations
4. Settings and preferences
5. Documentation
6. Performance optimization

**Deliverables**:
- Polished, integrated experience
- User documentation
- Performance improvements

### Future Phases

**Phase 6**: Auto-decay and scheduling
**Phase 7**: Semantic memory extraction
**Phase 8**: Cross-project sharing
**Phase 9**: Context suggestions
**Phase 10**: Memory search

---

## Appendix A: API Endpoints

### Memory Management

```
GET    /api/memory/projects                    # List all projects in memory
GET    /api/memory/projects/:projectId         # Get project details
POST   /api/memory/projects/:projectId/sessions/:sessionId  # Register session
DELETE /api/memory/projects/:projectId/sessions/:sessionId  # Unregister session

GET    /api/memory/sessions/:sessionId/versions        # List compression versions
POST   /api/memory/sessions/:sessionId/versions        # Create new compression
DELETE /api/memory/sessions/:sessionId/versions/:versionId  # Delete version
GET    /api/memory/sessions/:sessionId/versions/:versionId  # Get version content

GET    /api/memory/sessions/:sessionId/keepits         # List keepit markers
PUT    /api/memory/sessions/:sessionId/keepits/:markerId  # Update keepit weight

GET    /api/memory/projects/:projectId/compositions    # List compositions
POST   /api/memory/projects/:projectId/compositions    # Create composition
GET    /api/memory/compositions/:compositionId         # Get composition details
DELETE /api/memory/compositions/:compositionId         # Delete composition
```

### Decay Calculation

```
POST   /api/memory/decay/preview               # Preview decay for given settings
{
  "sessionId": "abc123",
  "compressionRatio": 30,
  "aggressiveness": "aggressive",
  "sessionDistance": 5
}
Response: {
  "markers": [
    { "markerId": "m1", "weight": 1.00, "survives": true },
    { "markerId": "m2", "weight": 0.80, "survives": true },
    { "markerId": "m3", "weight": 0.50, "survives": false }
  ],
  "threshold": 0.65
}
```

---

## Appendix B: Configuration Reference

### Global Config (`~/.claude-memory/config.json`)

```json
{
  "version": "1.0.0",
  "storage": {
    "maxCacheSize": "1GB",
    "compressionRetention": "all"
  },
  "defaults": {
    "compressionPreset": "standard",
    "keepitDecayEnabled": true,
    "autoRegisterSessions": false,
    "model": "opus"
  },
  "keepitDecay": {
    "compressionBase": {
      "light": 0.1,
      "moderate": 0.3,
      "aggressive": 0.5
    },
    "maxSessionDistance": 10,
    "pinnedWeight": 1.0
  },
  "ui": {
    "defaultView": "timeline",
    "showTokenEstimates": true,
    "confirmDestructiveActions": true
  }
}
```

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Compression** | A summarized version of a session with reduced token count |
| **Composition** | A combined context built from multiple session compressions |
| **Decay** | The process by which keepit markers become eligible for summarization over time |
| **Keepit Marker** | User-defined marker (`##keepitX.XX##`) indicating content importance |
| **Session Distance** | How many sessions ago a session occurred (1 = most recent) |
| **Weight** | Numeric importance value (0.00-1.00) assigned to keepit markers |
| **Threshold** | Calculated minimum weight required for a keepit to survive compression |
| **Manifest** | JSON file tracking all sessions, compressions, and compositions for a project |
| **Original** | The unmodified source `.jsonl` session file |

---

*End of Design Document*
