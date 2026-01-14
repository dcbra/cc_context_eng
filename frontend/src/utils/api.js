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
  if (!sessionId || !projectId) {
    throw new Error('sessionId and projectId are required');
  }
  const response = await fetch(`${API_BASE}/sessions/${sessionId}?projectId=${encodeURIComponent(projectId)}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch session (${response.status}): ${text}`);
  }
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

export async function findDuplicates(sessionId, projectId) {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/duplicates?projectId=${projectId}`);
  if (!response.ok) throw new Error('Failed to find duplicates');
  return response.json();
}

export async function removeDuplicates(sessionId, projectId) {
  const response = await fetch(`${API_BASE}/sanitize/${sessionId}/deduplicate?projectId=${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!response.ok) throw new Error('Failed to remove duplicates');
  return response.json();
}

export async function exportSessionToMarkdown(sessionId, projectId, format = 'markdown') {
  const response = await fetch(`${API_BASE}/export/${sessionId}/markdown?projectId=${encodeURIComponent(projectId)}&format=${format}`);
  if (!response.ok) throw new Error('Failed to export session');
  return response.json();
}

export async function exportBackupToMarkdown(sessionId, projectId, version, format = 'markdown') {
  const response = await fetch(`${API_BASE}/export/${sessionId}/backup/${version}/markdown?projectId=${encodeURIComponent(projectId)}&format=${format}`);
  if (!response.ok) throw new Error('Failed to export backup');
  return response.json();
}

export async function convertJsonlToMarkdown(file, format = 'markdown') {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('format', format);

  const response = await fetch(`${API_BASE}/export/convert`, {
    method: 'POST',
    body: formData
  });
  if (!response.ok) throw new Error('Failed to convert file');
  return response.json();
}
