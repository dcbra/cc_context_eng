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

**API Routes:**
- `/api/projects` - List projects and sessions
- `/api/sessions/:id` - Get parsed session with full analysis
- `/api/sanitize/:id` - Apply sanitization rules
- `/api/backup/:id/*` - Manage backups and restore

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
│   │   ├── services/    # Business logic
│   │   ├── routes/      # API endpoints
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

## Limitations & Future Improvements

### Current
- ✅ File content removal
- ✅ Message deletion with threading preservation
- ✅ Token tracking and metrics
- ✅ Backup versioning
- ✅ Subagent identification

### Planned
- [ ] Batch processing multiple sessions
- [ ] Advanced tokenizer integration (js-tiktoken)
- [ ] Diff viewer (before/after comparison)
- [ ] Search/filter messages by content or timestamp
- [ ] Auto-save and auto-backup features
- [ ] Conversation compression (summarize old sections)
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
