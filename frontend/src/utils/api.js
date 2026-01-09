const API_BASE = '/api';

export async function getProjects() {
  const response = await fetch(`${API_BASE}/projects`);
  if (!response.ok) throw new Error('Failed to fetch projects');
  return response.json();
}

export async function getProjectSessions(projectId) {
  const response = await fetch(`${API_BASE}/projects/${projectId}/sessions`);
  if (!response.ok) throw new Error('Failed to fetch sessions');
  return response.json();
}

export async function getSession(sessionId, projectId) {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}?projectId=${projectId}`);
  if (!response.ok) throw new Error('Failed to fetch session');
  return response.json();
}

export async function previewSanitization(sessionId, projectId, options) {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/preview?projectId=${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  if (!response.ok) throw new Error('Failed to preview sanitization');
  return response.json();
}

export async function saveSession(sessionId, projectId, messages) {
  const response = await fetch(`${API_BASE}/backup/${sessionId}/save?projectId=${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  });
  if (!response.ok) throw new Error('Failed to save session');
  return response.json();
}

export async function getBackupVersions(sessionId, projectId) {
  const response = await fetch(`${API_BASE}/backup/${sessionId}/versions?projectId=${projectId}`);
  if (!response.ok) throw new Error('Failed to fetch backups');
  return response.json();
}

export async function restoreBackup(sessionId, projectId, version) {
  const response = await fetch(`${API_BASE}/backup/${sessionId}/restore/${version}?projectId=${projectId}`, {
    method: 'POST'
  });
  if (!response.ok) throw new Error('Failed to restore backup');
  return response.json();
}
