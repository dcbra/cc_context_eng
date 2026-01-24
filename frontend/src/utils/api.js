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

export async function exportSessionToMarkdown(sessionId, projectId, format = 'markdown', full = false, sanitizeTypes = []) {
  const sanitizeParam = sanitizeTypes.length > 0 ? `&sanitize=${sanitizeTypes.join(',')}` : '';
  const response = await fetch(`${API_BASE}/export/${sessionId}/markdown?projectId=${encodeURIComponent(projectId)}&format=${format}&full=${full}${sanitizeParam}`);
  if (!response.ok) throw new Error('Failed to export session');
  return response.json();
}

export async function exportBackupToMarkdown(sessionId, projectId, version, format = 'markdown', full = false, sanitizeTypes = []) {
  const sanitizeParam = sanitizeTypes.length > 0 ? `&sanitize=${sanitizeTypes.join(',')}` : '';
  const response = await fetch(`${API_BASE}/export/${sessionId}/backup/${version}/markdown?projectId=${encodeURIComponent(projectId)}&format=${format}&full=${full}${sanitizeParam}`);
  if (!response.ok) throw new Error('Failed to export backup');
  return response.json();
}

export async function convertJsonlToMarkdown(file, format = 'markdown', full = false) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('format', format);
  formData.append('full', full.toString());

  const response = await fetch(`${API_BASE}/export/convert`, {
    method: 'POST',
    body: formData
  });
  if (!response.ok) throw new Error('Failed to convert file');
  return response.json();
}

// Summarization API functions

export async function checkSummarizationStatus() {
  const response = await fetch(`${API_BASE}/summarize/status`);
  if (!response.ok) throw new Error('Failed to check summarization status');
  return response.json();
}

export async function getSummarizationPresets() {
  const response = await fetch(`${API_BASE}/summarize/presets`);
  if (!response.ok) throw new Error('Failed to get summarization presets');
  return response.json();
}

export async function previewSummarization(sessionId, projectId, options) {
  const response = await fetch(`${API_BASE}/summarize/${sessionId}/preview?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to preview summarization' }));
    throw new Error(error.error || error.details || 'Failed to preview summarization');
  }
  return response.json();
}

export async function applySummarization(sessionId, projectId, options) {
  const response = await fetch(`${API_BASE}/summarize/${sessionId}/apply?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  // Return the full error object for better UI feedback
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to apply summarization' }));
    return errorData; // Return error object instead of throwing
  }
  return response.json();
}

// Image extraction API function

export async function extractImages(sessionId, projectId) {
  const response = await fetch(`${API_BASE}/sanitize/${sessionId}/extract-images?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to extract images' }));
    throw new Error(errorData.error || errorData.message || 'Failed to extract images');
  }
  return response.json();
}
