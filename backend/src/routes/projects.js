import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

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
    const files = await fs.readdir(projectPath);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    // Decode project name (e.g., -home-dac-github-project -> /home/dac/github/project)
    const decodedName = decodeProjectPath(projectId);

    projects.push({
      id: projectId,
      name: decodedName,
      sessionCount: jsonlFiles.length,
      lastModified: stats.mtime,
      size: stats.size
    });
  }

  return projects.sort((a, b) => b.lastModified - a.lastModified);
}

/**
 * List sessions in a project
 */
async function listSessions(projectPath, projectId) {
  const files = await fs.readdir(projectPath);
  const sessions = [];

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;

    const filePath = path.join(projectPath, file);
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;

    // Count lines (approximate message count)
    const content = await fs.readFile(filePath, 'utf-8');
    const messageCount = (content.match(/\n/g) || []).length;

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

  return sessions.sort((a, b) => b.lastModified - a.lastModified);
}

/**
 * Decode project path from encoded name
 * e.g., -home-dac-github-project -> /home/dac/github/project
 * Normalizes backslashes (from Windows) to forward slashes for display
 */
function decodeProjectPath(projectId) {
  if (!projectId.startsWith('-')) return projectId;
  // Decode hyphens to slashes and normalize any backslashes to forward slashes
  return '/' + projectId.slice(1).replace(/-/g, '/').replace(/\\/g, '/');
}

export default router;
