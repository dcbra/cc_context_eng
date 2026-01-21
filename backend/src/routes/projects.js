import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { countMessages } from '../utils/streaming-jsonl.js';

const router = express.Router();

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * GET /api/projects
 * List all projects in ~/.claude/projects
 */
router.get('/', async (req, res, next) => {
  try {
    const projects = await listProjects();
    res.json(projects);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/projects/:projectId/sessions
 * List all sessions in a specific project
 */
router.get('/:projectId/sessions', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const projectPath = path.join(PROJECTS_DIR, projectId);

    // Validate project exists
    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const sessions = await listSessions(projectPath, projectId);
    res.json(sessions);
  } catch (error) {
    next(error);
  }
});

/**
 * List all projects
 */
async function listProjects() {
  if (!await fs.pathExists(PROJECTS_DIR)) {
    return [];
  }

  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectId = entry.name;
    const projectPath = path.join(PROJECTS_DIR, projectId);
    const stats = await fs.stat(projectPath);
    const projectEntries = await fs.readdir(projectPath, { withFileTypes: true });

    // Count JSONL files at root level
    let sessionCount = projectEntries.filter(e => e.isFile() && e.name.endsWith('.jsonl')).length;

    // Also count subagents in session subdirectories (new structure)
    for (const projectEntry of projectEntries) {
      if (projectEntry.isDirectory()) {
        const subagentsPath = path.join(projectPath, projectEntry.name, 'subagents');
        if (await fs.pathExists(subagentsPath)) {
          try {
            const subagentFiles = await fs.readdir(subagentsPath);
            sessionCount += subagentFiles.filter(f => f.endsWith('.jsonl')).length;
          } catch (error) {
            // Ignore errors reading subagent directories
          }
        }
      }
    }

    // Decode project name (e.g., -home-user-github-project -> /home/user/github/project)
    const decodedName = decodeProjectPath(projectId);

    projects.push({
      id: projectId,
      name: decodedName,
      sessionCount,
      lastModified: stats.mtime,
      size: stats.size
    });
  }

  return projects.sort((a, b) => b.lastModified - a.lastModified);
}

/**
 * List sessions in a project
 * Supports both old structure (agent-*.jsonl at project root) and
 * new structure (session-id/subagents/agent-*.jsonl)
 */
async function listSessions(projectPath, projectId) {
  const entries = await fs.readdir(projectPath, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    // Handle JSONL files at project root (both sessions and old-style subagents)
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const file = entry.name;
      const filePath = path.join(projectPath, file);
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;

      // Count actual messages using streaming (handles large files)
      const messageCount = await countMessages(filePath);

      // Determine if this is a main session or subagent
      const isSubagent = file.startsWith('agent-');
      const sessionId = file.replace('.jsonl', '');

      sessions.push({
        id: sessionId,
        projectId,
        fileName: file,
        filePath,
        size: fileSize,
        messageCount,
        isSubagent,
        type: isSubagent ? 'subagent' : 'session',
        lastModified: stats.mtime
      });
    }

    // Handle session directories with subagents subdirectory (new structure)
    if (entry.isDirectory()) {
      const sessionDirPath = path.join(projectPath, entry.name);
      const subagentsPath = path.join(sessionDirPath, 'subagents');

      // Check if this directory has a subagents subdirectory
      if (await fs.pathExists(subagentsPath)) {
        try {
          const subagentFiles = await fs.readdir(subagentsPath);

          for (const subagentFile of subagentFiles) {
            if (!subagentFile.endsWith('.jsonl')) continue;

            const filePath = path.join(subagentsPath, subagentFile);
            const stats = await fs.stat(filePath);
            const fileSize = stats.size;

            // Count actual messages using streaming (handles large files)
            const messageCount = await countMessages(filePath);

            const sessionId = subagentFile.replace('.jsonl', '');

            sessions.push({
              id: sessionId,
              projectId,
              fileName: subagentFile,
              filePath,
              size: fileSize,
              messageCount,
              isSubagent: true,
              type: 'subagent',
              parentSessionId: entry.name, // Reference to parent session directory
              lastModified: stats.mtime
            });
          }
        } catch (error) {
          console.warn(`Failed to read subagents in ${entry.name}:`, error.message);
        }
      }
    }
  }

  return sessions.sort((a, b) => b.lastModified - a.lastModified);
}

/**
 * Decode project path from encoded name
 * e.g., -home-user-github-project -> /home/user/github/project
 * Normalizes backslashes (from Windows) to forward slashes for display
 */
function decodeProjectPath(projectId) {
  if (!projectId.startsWith('-')) return projectId;
  // Decode hyphens to slashes and normalize any backslashes to forward slashes
  return '/' + projectId.slice(1).replace(/-/g, '/').replace(/\\/g, '/');
}

export default router;
