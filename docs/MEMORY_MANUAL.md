# Memory System Manual

The Memory System provides persistent cross-session context management for Claude Code sessions. It solves the problem of cumulative information loss when repeatedly summarizing LLM conversations.

## The Problem

When working with Claude across multiple sessions:

```
Session 1 → summarize → 100k → 10k tokens
Session 2 → summarize (includes prev summary) → 80k → 8k tokens
Session 3 → summarize (summary of summary) → 70k → 7k tokens
...
Critical decisions from Session 1 are now compressed 3x, losing fidelity
```

Each summarization compounds information loss. Important architectural decisions, debugging insights, and project context progressively degrade.

## Core Concepts

### 1. Layered Compression

Instead of re-compressing already compressed content, the Memory System maintains multiple compression versions of each session:

```
~/.claude-memory/projects/your-project/
├── manifest.json           # Tracks all sessions and versions
├── originals/              # Symlinks to original .jsonl files
├── summaries/
│   └── session-abc/
│       ├── v001_light_10pct.jsonl      # 10% compression
│       ├── v002_moderate_30pct.jsonl   # 30% compression
│       └── v003_aggressive_50pct.jsonl # 50% compression
└── composed/               # Combined context from multiple sessions
```

**Key principle**: Original sessions are never modified. Each compression level is stored separately.

### 2. Smart Composition

When starting a new session, compose context by mixing compression levels based on age:

| Session Age | Compression Level | Rationale |
|-------------|-------------------|-----------|
| Recent (1-2 sessions ago) | Light | Preserve detail for recent work |
| Medium (3-5 sessions ago) | Moderate | Balance detail vs. token budget |
| Old (6+ sessions ago) | Aggressive | Keep only essential decisions |

The composition engine automatically selects appropriate versions to fit within your token budget.

### 3. Keepit Markers

Mark important content that should survive compression using weighted markers:

```markdown
##keepit1.00## This architectural decision MUST never be forgotten
##keepit0.80## Important implementation detail
##keepit0.50## Useful context but not critical
##keepit0.25## Minor detail, can be lost if needed
```

**Weight meanings**:
- `1.00` = Pinned content, always survives any compression
- `0.80` = High importance, survives light and moderate compression
- `0.50` = Medium importance, survives light compression only
- `0.25` = Low importance, likely compressed away in most scenarios

### 4. Decay Model

Content importance naturally decays over time. The survival threshold increases with:
- **Session distance**: Older sessions have higher thresholds
- **Compression level**: Aggressive compression has higher base threshold
- **Compression ratio**: Higher ratios increase the threshold

**Formula**:
```
survival_threshold = compression_base + (ratio_penalty × distance_factor)
```

Where:
- `compression_base`: light=0.1, moderate=0.3, aggressive=0.5
- `ratio_penalty`: compression_ratio / 100
- `distance_factor`: min(session_distance / 10, 1)

**Example**: A `##keepit0.80##` marker at session distance 10 with aggressive 30:1 compression:
```
threshold = 0.5 + (0.30 × 1.0) = 0.80
```
The content **barely survives** (weight equals threshold).

## Getting Started

### Access the Memory Browser

- Press **Ctrl+Shift+M** or click the **Memory** tab in the main interface

### Register a Session

1. Open the Memory Browser
2. Click **Register Session**
3. Select a session from your project
4. The session is now tracked in the manifest

### Create Compression Versions

1. Select a registered session
2. Click **Create Version**
3. Choose compression level:
   - **Light**: ~10% compression, preserves most detail
   - **Moderate**: ~30% compression, balanced
   - **Aggressive**: ~50% compression, essential content only
4. The AI summarizer creates the compressed version

### Build a Composition

1. Click **New Composition**
2. Set your token budget (e.g., 50,000 tokens)
3. Select which sessions to include
4. The system auto-selects optimal versions based on:
   - Session age (recent = less compressed)
   - Token budget constraints
   - Keepit marker weights
5. Export the composed context for your new session

### Add Keepit Markers

In your Claude conversations, mark important content:

```
The authentication system uses JWT tokens with 24-hour expiry.
##keepit0.90## Critical: API keys must be rotated every 90 days.
This was implemented in PR #142.
```

The Memory System detects these markers during compression and preserves high-weight content.

## Workflows

### Starting a New Project Session

1. Open Memory Browser
2. Review registered sessions from previous work
3. Create a composition with appropriate token budget
4. Export as JSONL or Markdown
5. Paste into new Claude session as context

### After Completing a Session

1. Register the session in Memory Browser
2. Add keepit markers to important decisions (if not done during session)
3. Create compression versions for future compositions
4. Optionally compose immediately for next session

### Reviewing Historical Context

1. Open Memory Browser
2. Browse sessions by project
3. View different compression versions
4. Use Version Comparison to see what was preserved vs. compressed

## Configuration

### Storage Location

Default: `~/.claude-memory/`

Override by setting `CLAUDE_MEMORY_DIR` environment variable.

### Compression Settings

Configure in Memory Settings dialog:

| Setting | Default | Description |
|---------|---------|-------------|
| Default light ratio | 10% | Target compression for light versions |
| Default moderate ratio | 30% | Target compression for moderate versions |
| Default aggressive ratio | 50% | Target compression for aggressive versions |
| Auto-create versions | Off | Automatically create versions on register |
| Decay enabled | On | Apply weight decay during composition |

### Keepit Marker Format

Standard format: `##keepit{weight}##`

Where `{weight}` is a decimal from 0.00 to 1.00 with exactly two decimal places.

Valid examples:
- `##keepit1.00##` - Pinned
- `##keepit0.75##` - High importance
- `##keepit0.50##` - Medium importance
- `##keepit0.25##` - Low importance

## API Reference

### Memory Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/memory/sessions` | GET | List registered sessions |
| `/api/memory/sessions` | POST | Register a session |
| `/api/memory/sessions/:id` | DELETE | Unregister a session |
| `/api/memory/sessions/:id/versions` | GET | List compression versions |
| `/api/memory/sessions/:id/versions` | POST | Create compression version |

### Composition

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/memory/compose` | POST | Create a composition |
| `/api/memory/compose/preview` | POST | Preview composition without creating |
| `/api/memory/compositions` | GET | List saved compositions |

### Statistics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/memory/stats` | GET | Overall memory statistics |
| `/api/memory/decay/preview` | POST | Preview decay effects |

## Troubleshooting

### Session not appearing in Memory Browser

- Verify the session exists in `~/.claude/projects/`
- Check that the JSONL file is valid (not corrupted)
- Ensure the project is accessible (no permission issues)

### Compression taking too long

- Large sessions (>100k tokens) may take several minutes
- The summarizer chunks large conversations automatically
- Check backend console for progress logs

### Keepit markers not detected

- Verify format: `##keepit{X.XX}##` with exactly two decimal places
- Markers must be on their own line or clearly separated
- Check that markers are in user or assistant messages (not tool results)

### Composition exceeds token budget

- The composer prioritizes high-weight content
- Try reducing the number of sessions included
- Use more aggressive compression for older sessions
- Increase token budget if possible

## Incremental Delta Compression

The Memory System supports incremental delta compression, which only compresses NEW messages since the last compression. This saves API tokens and time by avoiding re-compression of already compressed content.

### The Problem with Full Re-compression

Without incremental compression, each compression re-processes the entire session:

```
Session grows:     100 msgs -> 150 msgs -> 200 msgs

Traditional approach (wasteful):
compressed_v1:     [====================] 100 msgs compressed
compressed_v2:     [==============================] 150 msgs (re-compresses first 100!)
compressed_v3:     [========================================] 200 msgs (re-compresses all!)
```

### The Delta Compression Solution

Delta compression only processes new messages since the last compression:

```
Session grows:     100 msgs -> 150 msgs -> 200 msgs

Delta approach (efficient):
part1:             [====================] msgs 1-100
part2:                                  [==========] msgs 101-150 (delta only!)
part3:                                              [==========] msgs 151-200 (delta only!)
```

### Part Naming Convention

Compressed parts follow the naming pattern:

```
part{N}_v{M}_{mode}-{preset}_{tokens}k

Where:
- N = part number (1 = oldest, incrementing for newer message ranges)
- M = version number within that part
- mode = compression mode (tiered or uniform)
- preset = compression preset used
- tokens = approximate output tokens in thousands

Examples:
- part1_v001_tiered-standard_10k.jsonl  (messages 1-100, first version)
- part1_v002_tiered-aggressive_5k.jsonl (messages 1-100, more aggressive)
- part2_v001_tiered-standard_8k.jsonl   (messages 101-150, first version)
```

### Compression Levels

Each part can have multiple versions at different compression levels:

| Level | Name | Description |
|-------|------|-------------|
| 1 | Light | Gentle compression, preserves most detail |
| 2 | Moderate | Balanced compression for general use |
| 3 | Aggressive | Heavy compression, essential content only |

You can create multiple versions of the same part at different levels, then select the appropriate one when composing context based on your token budget.

### Using Delta Compression

#### Check for New Messages

The Session Details panel shows a "New Messages" section indicating:
- Whether new uncompressed messages exist
- How many new messages are available
- Which part number will be created next

#### Compress New Messages

1. Open a registered session in the Memory Browser
2. Look for the "New Messages" section
3. Click **Compress New Messages** to create a new part
4. Choose compression settings (level, mode)
5. The new part is created covering only the delta messages

#### Re-compress an Existing Part

To create a different compression level for an existing part:

1. View the session's compression versions
2. Find the part you want to re-compress
3. Click the **+** button next to the part header
4. Select a different compression level
5. A new version of that part is created

### Workflow Example

**Session lifecycle with delta compression:**

```
Day 1: Initial 100 messages
  -> Register session
  -> Create Part 1 (light compression)

Day 2: Session grows to 180 messages (+80 new)
  -> Sync session (detects 80 new messages)
  -> Create Part 2 from delta (light compression)

Day 3: Need to reduce token usage
  -> Re-compress Part 1 at aggressive level
  -> Re-compress Part 2 at moderate level

Day 4: Compose context for new session
  -> System selects Part 1 (aggressive) + Part 2 (moderate)
  -> Combined output fits token budget
```

### UI Elements

#### Session Details - Delta Section

Shows the sync status between your session and existing compressions:
- **New messages count**: Number of uncompressed messages
- **Compress New Messages button**: Creates the next part
- **Part number indicator**: Shows which part will be created

#### Version List - Part Grouping

Compression versions are grouped by part:
- **Part header**: Shows part number and message range
- **+ button**: Re-compress this part at a different level
- **Version rows**: Each compression level for that part

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/memory/projects/:id/sessions/:id/delta` | GET | Check delta status |
| `/api/memory/projects/:id/sessions/:id/delta` | POST | Create delta compression |
| `/api/memory/projects/:id/sessions/:id/parts` | GET | List all parts |
| `/api/memory/projects/:id/sessions/:id/parts/:n/recompress` | POST | Re-compress a part |

## Best Practices

1. **Mark decisions early**: Add keepit markers during your session, not after
2. **Use appropriate weights**: Reserve 1.00 for truly critical information
3. **Create versions incrementally**: Light first, then moderate, then aggressive
4. **Review before composing**: Check what will be included in the preview
5. **Keep compositions focused**: Include only sessions relevant to current work
6. **Use delta compression**: For growing sessions, compress new messages incrementally to save API tokens
7. **Re-compress strategically**: Create aggressive versions of older parts to reduce token usage while keeping recent parts at light compression

## Limitations

- Keepit markers in code blocks may not be detected
- Very long sessions (>500k tokens) may require manual chunking
- Cross-project compositions not yet supported
- Real-time collaboration not available

## Design Documentation

For implementation details and architecture, see:
- `docs/MEMORY_SYSTEM_DESIGN.md` - Comprehensive technical specification
- TypeScript interfaces, workflow diagrams, and implementation roadmap
