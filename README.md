# Claude Code Context Manager

A web application for managing, analyzing, and sanitizing Claude Code context files. Distill complex sessions by removing unnecessary content while preserving conversation threading and essential information.

## Features

### 📊 Context Analysis
- **File Tracking**: Identify all files read during a session with read counts, content sizes, and timestamps
- **Token Metrics**: Detailed token usage breakdown (input, output, cache read, cache creation)
- **Subagent Analysis**: Track token usage and messages across main agent and spawned subagents
- **Context Window Usage**: Visual representation of context window utilization (200k tokens for Claude)

### ✂️ Context Sanitization
- **Selective Message Removal**: Choose specific messages to remove while maintaining conversation threading
- **File Content Removal**: Remove file content from tool results with options to keep first/last read
- **Smart Criteria**:
  - Remove error tool results
  - Shorten verbose explanations
  - Remove duplicate file reads
- **Impact Preview**: See token savings before applying changes

### 🤖 AI-Powered Summarization
- **Conversation Compression**: Use Claude CLI to intelligently summarize conversation ranges
- **Tiered Compaction**: Apply different compression ratios to different parts of the conversation
  - Aggressive compression (35-50x) for old messages
  - Moderate compression (5-20x) for middle sections
  - Minimal compression (2-3x) for recent context
- **Uniform Mode**: Apply single compression ratio across selected range
- **Configurable Ratios**: Choose from 2x to 50x compression
- **Smart Chunking**: Automatically chunks large conversations to avoid timeouts
- **Export Options**: Modify in place, export as JSONL, or export as Markdown

### 💾 Backup & Restore
- **Automatic Versioning**: Keep last 10 versions of your sanitized sessions
- **Version Comparison**: Compare before/after metrics
- **Backup Verification**: Validate JSONL integrity
- **One-click Restore**: Revert to any previous version

### 📄 Export Options
- **Markdown Export**: Readable conversation transcripts with metadata
- **Plain Text Export**: Simple conversation timeline
- **JSON Reports**: Token metrics and session analysis

### 🔄 Project Management
- **Multi-project Support**: Browse all projects in `~/.claude/projects`
- **Session Organization**: View all sessions with size, message count, and type badges
- **Batch Operations**: Select and process multiple sessions

## Architecture

### Backend (Node.js + Express)

**Services:**
- `jsonl-parser.js` - Parse JSONL files with conversation threading
- `file-tracker.js` - Track files read and calculate removal impact
- `token-calculator.js` - Accurate token counting with Claude model context limits
- `subagent-analyzer.js` - Identify and link subagent sessions
- `sanitizer.js` - Apply sanitization rules while preserving integrity
- `backup-manager.js` - Version control with rotation and restore
- `markdown-export.js` - Convert sessions to readable formats
- `summarizer.js` - AI-powered conversation summarization via Claude CLI

**API Routes:**
- `/api/projects` - List projects and sessions
- `/api/sessions/:id` - Get parsed session with full analysis
- `/api/sanitize/:id` - Apply sanitization rules
- `/api/backup/:id/*` - Manage backups and restore
- `/api/summarize/:id/*` - AI-powered conversation summarization

### Frontend (Vue 3 + Pinia)

**Stores:**
- `session.js` - Current session state
- `selection.js` - Message/file selection state
- `history.js` - Undo/redo operations

**Components:**
- `ProjectBrowser.vue` - Project/session discovery and selection
- `SessionEditor.vue` - Main editor with tabbed interface
- `SessionViewer.vue` - Display and select messages
- `FileTracker.vue` - Visualize files read with removal options
- `SanitizationPanel.vue` - Configure and preview sanitization
- `TokenCalculator.vue` - Token analysis and metrics
- `BackupManager.vue` - Version control UI

## Installation & Setup

### Prerequisites
- Node.js 16+ (for ES modules support)
- npm or yarn

### Install Dependencies

```bash
# Root level (optional, if using workspace)
npm install

# Backend
cd backend
npm install

# Frontend
cd frontend
npm install
```

## Running the Application

### Development Mode

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
# Server runs on http://localhost:3001
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# Dev server runs on http://localhost:3000
```

Or run both in parallel from root:
```bash
npm run dev
```

### Production Build

```bash
# Build backend and frontend
npm run build

# Or individually
npm run backend:build
npm run frontend:build
```

## Usage Guide

### 1. Browse Projects
- Open the app at `http://localhost:3000`
- Projects from `~/.claude/projects` are automatically discovered
- Sessions are displayed with metadata (size, message count, type)

### 2. Select a Session
- Click on a session to open it in the editor
- Choose a tab to view different aspects

### 3. Analyze Tokens
- **Tokens Tab** shows:
  - Input/Output/Cache token breakdown
  - Subagent token usage
  - Context window usage percentage
  - Message metrics (avg tokens per message)

### 4. Review Files
- **Files Tab** lists all files accessed
- Shows read count, total content size, first/last read
- Select files to remove from context
- See list of read instances

### 5. Sanitize Context
- **Sanitize Tab** lets you:
  - Select specific messages to remove
  - Select files to remove content from
  - Apply criteria (remove errors, verbose text, duplicates)
  - Preview impact (messages/tokens freed)
  - Apply changes

### 6. Manage Backups
- **Backups Tab** shows:
  - All saved versions (up to 10)
  - Timestamp and message count
  - Restore any previous version
  - Verify backup integrity
  - Delete old versions

### 7. AI Summarization
- **Sanitize Tab** has an AI Summarization section
- **Select Range**: Use slider to choose what percentage of messages to summarize (0-100%)
- **Choose Mode**:
  - **Uniform**: Single compression ratio across all selected messages
  - **Tiered**: Different ratios for different age ranges (recommended)
- **Configure Tiers** (for tiered mode):
  - Select from presets (Conservative, Moderate, Aggressive)
  - Or customize each tier's compression ratio
- **Select Output**:
  - **Modify Current**: Updates the session file in place
  - **Export JSONL**: Creates new summarized JSONL file
  - **Export Markdown**: Creates readable markdown transcript
- **Requirements**: Claude CLI must be installed and authenticated

## Key Concepts

### Message Threading
Messages are connected via `parentUuid`. When you delete a message, the system automatically updates child messages to point to the parent of the deleted message, maintaining conversation flow.

### Token Counting
- **Accurate**: Uses `usage` field from Claude messages
- **Estimation**: Falls back to character count when needed
- **Context Limits**: Supports all Claude models (200k max for current models)

### File Removal
When you remove a file:
1. All tool_result content for that file is replaced with a placeholder
2. Tool_use references are preserved (for traceability)
3. You can choose to keep first/last read only
4. Duplicates can be auto-removed

### Message Range & Selection

The **Message Range slider** (0-100%) determines which messages are affected by operations. Messages are ordered chronologically, so:
- **0% or 100%** = Full range (all messages)
- **50%** = First half of messages (older messages)
- **25%** = First quarter (oldest messages)

**How each feature uses the range:**

| Feature | Range Behavior |
|---------|----------------|
| **Sanitization** | Criteria (remove errors, verbose, message types) apply only to messages within the selected range. Messages outside the range are untouched. |
| **AI Summarization** | Summarizes messages within the selected range. Useful for compressing old context while keeping recent messages intact. |
| **Duplicate Detection** | **Independent** - Scans ALL messages regardless of range. Duplicates are detected globally. |

**Manual Selection Override:**
If you manually select messages in the Messages tab, those exact messages are used and the percentage range slider is ignored. It's either/or:
- **With manual selection**: Operations apply to exactly the messages you selected
- **Without manual selection**: Operations apply to messages within the percentage range

### Subagent Tracking
- Subagents are identified by `isSidechain: true` and unique agentId
- Token usage is tracked separately per subagent
- Main agent session can reference subagent files
- Backups preserve subagent integrity

### Backup System
- Backups are stored in `./backups/[projectId]/[sessionId]/`
- Up to 10 versions per session (v1 = most recent)
- Automatic rotation: v10 is deleted, v9 → v10, etc.
- Each backup has metadata (timestamp, description, message count)

## File Structure

```
cc_context_eng/
├── backend/
│   ├── src/
│   │   ├── services/    # Business logic (including summarizer.js)
│   │   ├── routes/      # API endpoints (including summarize.js)
│   │   ├── utils/       # Export and utilities
│   │   └── server.js    # Express setup
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/  # Vue components
│   │   ├── stores/      # Pinia stores
│   │   ├── utils/       # Helpers
│   │   ├── App.vue
│   │   └── main.js
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── backups/             # Version control directory
└── README.md
```

## Data Model

### Parsed Session
```javascript
{
  sessionId: "uuid",
  filePath: "/path/to/.jsonl",
  metadata: {
    cwd: "/home/user/project",
    gitBranch: "main",
    version: "2.0.76",
    projectName: "project"
  },
  messages: [
    {
      uuid: "msg-uuid",
      parentUuid: "parent-uuid",
      type: "user" | "assistant",
      agentId: "a34641f",
      isSidechain: false,
      timestamp: "2026-01-09T12:17:39.997Z",
      content: [...],
      filesReferenced: ["file.ts", "..."],
      tokens: {
        input: 100,
        output: 50,
        cacheRead: 1000,
        cacheCreation: 500,
        total: 1650
      }
    }
  ],
  filesRead: [...],
  subagents: [...],
  totalTokens: {...}
}
```

## API Endpoints

### Projects & Sessions
- `GET /api/projects` - List all projects
- `GET /api/projects/:projectId/sessions` - List sessions in project
- `GET /api/sessions/:sessionId?projectId=X` - Get full session analysis

### Sanitization
- `POST /api/sanitize/:sessionId` - Calculate sanitization impact
- `POST /api/sanitize/:sessionId/apply` - Apply sanitization

### Backup & Restore
- `POST /api/backup/:sessionId/save` - Create backup
- `GET /api/backup/:sessionId/versions` - List versions
- `POST /api/backup/:sessionId/restore/:version` - Restore version
- `DELETE /api/backup/:sessionId/versions/:version` - Delete version
- `POST /api/backup/:sessionId/compare` - Compare versions
- `GET /api/backup/:sessionId/verify/:version` - Verify integrity

### Summarization
- `POST /api/summarize/:sessionId/preview` - Preview summarization impact
- `POST /api/summarize/:sessionId/apply` - Apply summarization
- `GET /api/summarize/presets` - Get tier presets
- `GET /api/summarize/status` - Check Claude CLI availability

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend server port |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Path to Claude CLI config directory |

## Development Notes

### Extending File Tracking
To track files from new tool types, update `file-tracker.js`:
1. Add new tool name to `extractFilesFromBashCommand()` or similar
2. Update file path extraction regex
3. Test with real JSONL files

### Adding New Sanitization Criteria
In `sanitizer.js` `applySanitizationCriteria()`:
1. Add new criterion to `criteria` object
2. Implement filter/transformation logic
3. Test impact calculation

### Token Estimation Improvements
Currently uses character count (1 token ≈ 4 chars). To integrate actual tokenizer:
1. Install `js-tiktoken` or `@anthropic-ai/tokenizer`
2. Update `token-calculator.js` `estimateTokensByCharCount()`
3. Add tokenizer call for non-assistant messages

## Important Notes

### Claude Code Context Limits (v2.1.12+)

Starting with Claude Code v2.1.12, once the `/compact` prompt appears, the session becomes locked - you cannot continue without running `/compact`, even if you sanitize the conversation file and free up context space.

**Workarounds:**
1. **Sanitize proactively** - Monitor your context usage and sanitize *before* hitting the limit
2. **Export and restart** - Export to Markdown (or AI-summarized Markdown), start a new session, and paste the summary as context
3. **Use AI summarization early** - Compress old conversation sections before reaching limits

This tool helps you manage context more effectively, but be aware that once Claude Code triggers its compaction prompt, external sanitization won't bypass it.

## Limitations & Future Improvements

### Current
- ✅ File content removal
- ✅ Message deletion with threading preservation
- ✅ Token tracking and metrics
- ✅ Backup versioning
- ✅ Subagent identification
- ✅ AI-powered conversation compression (tiered summarization)

### Planned
- [ ] Batch processing multiple sessions
- [ ] Advanced tokenizer integration (js-tiktoken)
- [ ] Diff viewer (before/after comparison)
- [ ] Search/filter messages by content or timestamp
- [ ] Auto-save and auto-backup features
- [ ] Export to different formats (CSV, Excel)
- [ ] Undo/redo in UI

## Troubleshooting

### Backend not connecting
- Check if backend is running on port 3001
- Verify CORS is enabled (`cors` middleware in server.js)

### Session loading fails
- Check if sessionId is valid
- Verify file exists in `~/.claude/projects/:projectId/`
- Check console logs for JSON parse errors

### File content not removed
- Ensure file path matches exactly
- Check that file appears in Files tab
- Verify tool_use name matches expected (Read, Grep, Edit, etc.)

### Backup not loading
- Check `./backups` directory exists
- Verify version number is valid
- Run verification to check integrity

### AI Summarization not working
- Ensure Claude CLI is installed: `npm install -g @anthropic-ai/claude-code`
- Verify authentication: `claude --version`
- Check `CLAUDE_CONFIG_DIR` environment variable if using custom config location
- Large conversations may take several minutes - the system chunks messages automatically
- Check backend console logs for detailed error messages

## Security Considerations

- File access restricted to `~/.claude/projects`
- CORS enabled for localhost only in development
- No authentication in this MVP
- Backups stored locally in project directory
- Always validate file paths (prevent directory traversal)

## License

MIT

## Contributing

This project was built following a detailed implementation plan. See `/claude_b/plans/fluffy-churning-aho.md` for architecture details.

For local development:
1. Ensure Node.js 16+ is installed
2. Install dependencies: `npm install`
3. Run development servers: `npm run dev`
4. Test with actual JSONL files from `~/.claude/projects`
