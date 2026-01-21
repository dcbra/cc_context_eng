/**
 * Memory System Lock Manager
 *
 * Handles concurrent operation locking for the memory system.
 * Provides both file-level locks (for manifest operations) and
 * session-level locks (for compression operations).
 *
 * Phase 5 - Task 5.0: Concurrent Operation Handling
 */

import lockfile from 'proper-lockfile';
import fs from 'fs-extra';
import { getManifestPath, getProjectDir } from './memory-storage.js';
import {
  CompressionInProgressError,
  LockError,
  LockTimeoutError
} from './memory-errors.js';

// ============================================
// Session-Level Operation Locks (In-Memory)
// ============================================

/**
 * In-memory map tracking active operations per session
 * Key format: `${projectId}:${sessionId}:${operation}`
 */
const operationLocks = new Map();

/**
 * Operation types that can be locked
 */
export const OperationType = {
  COMPRESSION: 'compression',
  IMPORT: 'import',
  EXPORT: 'export',
  COMPOSITION: 'composition'
};

/**
 * Acquire a session-level lock for an operation
 * Prevents concurrent operations on the same session
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {string} operation - Operation type (from OperationType)
 * @returns {Promise<Object>} Lock handle with release method
 * @throws {CompressionInProgressError} If operation is already in progress
 */
export async function acquireSessionLock(projectId, sessionId, operation = OperationType.COMPRESSION) {
  const lockKey = `${projectId}:${sessionId}:${operation}`;

  if (operationLocks.has(lockKey)) {
    const existing = operationLocks.get(lockKey);

    // Check if lock is stale (over 5 minutes old)
    const ageMs = Date.now() - new Date(existing.startedAt).getTime();
    if (ageMs > 5 * 60 * 1000) {
      // Auto-release stale lock
      operationLocks.delete(lockKey);
    } else {
      throw new CompressionInProgressError(sessionId, operation);
    }
  }

  const lockInfo = {
    projectId,
    sessionId,
    operation,
    startedAt: new Date().toISOString(),
    pid: process.pid
  };

  operationLocks.set(lockKey, lockInfo);

  return {
    lockKey,
    lockInfo,
    release: () => {
      operationLocks.delete(lockKey);
      return true;
    }
  };
}

/**
 * Check if a session has an active operation lock
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {string} operation - Operation type (optional, checks all if not provided)
 * @returns {boolean} True if locked
 */
export function isSessionLocked(projectId, sessionId, operation = null) {
  if (operation) {
    const lockKey = `${projectId}:${sessionId}:${operation}`;
    return operationLocks.has(lockKey);
  }

  // Check all operations
  for (const key of operationLocks.keys()) {
    if (key.startsWith(`${projectId}:${sessionId}:`)) {
      return true;
    }
  }

  return false;
}

/**
 * Get all active operations for a session
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @returns {Array<Object>} Active operations
 */
export function getActiveOperations(projectId, sessionId) {
  const active = [];

  for (const [key, value] of operationLocks) {
    if (key.startsWith(`${projectId}:${sessionId}:`)) {
      active.push({
        ...value,
        lockKey: key
      });
    }
  }

  return active;
}

/**
 * Get all active operations across all sessions
 *
 * @returns {Array<Object>} All active operations
 */
export function getAllActiveOperations() {
  const active = [];

  for (const [key, value] of operationLocks) {
    active.push({
      ...value,
      lockKey: key
    });
  }

  return active;
}

/**
 * Release all stale locks (older than specified age)
 *
 * @param {number} maxAgeMs - Maximum lock age in milliseconds (default: 5 minutes)
 * @returns {number} Number of locks released
 */
export function releaseStaleSessionLocks(maxAgeMs = 5 * 60 * 1000) {
  const now = Date.now();
  let released = 0;

  for (const [key, value] of operationLocks) {
    const ageMs = now - new Date(value.startedAt).getTime();
    if (ageMs > maxAgeMs) {
      operationLocks.delete(key);
      released++;
    }
  }

  return released;
}

/**
 * Force release a specific lock (use with caution)
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {string} operation - Operation type
 * @returns {boolean} True if lock was released
 */
export function forceReleaseSessionLock(projectId, sessionId, operation) {
  const lockKey = `${projectId}:${sessionId}:${operation}`;
  return operationLocks.delete(lockKey);
}

// ============================================
// File-Level Locks (proper-lockfile)
// ============================================

/**
 * Default lock options for file operations
 */
const DEFAULT_LOCK_OPTIONS = {
  stale: 30000, // Consider lock stale after 30 seconds
  retries: {
    retries: 5,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 1000
  }
};

/**
 * Acquire a file lock for manifest operations
 * Uses proper-lockfile for cross-process safety
 *
 * @param {string} projectId - Project ID
 * @param {Object} options - Lock options (optional)
 * @returns {Promise<Function>} Release function
 * @throws {LockError} If lock cannot be acquired
 */
export async function acquireManifestLock(projectId, options = {}) {
  const manifestPath = getManifestPath(projectId);
  const lockOptions = { ...DEFAULT_LOCK_OPTIONS, ...options };

  try {
    // Check if manifest exists, if not lock the project directory
    const lockTarget = await fs.pathExists(manifestPath)
      ? manifestPath
      : getProjectDir(projectId);

    // Ensure lock target exists
    if (!await fs.pathExists(lockTarget)) {
      await fs.ensureDir(lockTarget);
    }

    const release = await lockfile.lock(lockTarget, lockOptions);

    return release;
  } catch (error) {
    if (error.code === 'ELOCKED') {
      throw new LockError(
        `manifest:${projectId}`,
        `Manifest for project ${projectId} is locked by another process`
      );
    }
    if (error.code === 'ENOENT') {
      throw new LockError(
        `manifest:${projectId}`,
        `Project directory not found: ${projectId}`
      );
    }
    throw error;
  }
}

/**
 * Check if a manifest file is locked
 *
 * @param {string} projectId - Project ID
 * @returns {Promise<boolean>} True if locked
 */
export async function isManifestLocked(projectId) {
  const manifestPath = getManifestPath(projectId);

  try {
    if (await fs.pathExists(manifestPath)) {
      return lockfile.check(manifestPath);
    }
    return lockfile.check(getProjectDir(projectId));
  } catch (error) {
    // If we can't check, assume not locked
    return false;
  }
}

/**
 * Execute a function with manifest lock
 * Automatically acquires and releases lock
 *
 * @param {string} projectId - Project ID
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Lock options
 * @returns {Promise<any>} Result of function
 */
export async function withManifestLock(projectId, fn, options = {}) {
  let release = null;

  try {
    release = await acquireManifestLock(projectId, options);
    const result = await fn();
    return result;
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * Execute a function with session lock
 * Automatically acquires and releases lock
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {string} operation - Operation type
 * @param {Function} fn - Async function to execute
 * @returns {Promise<any>} Result of function
 */
export async function withSessionLock(projectId, sessionId, operation, fn) {
  const lock = await acquireSessionLock(projectId, sessionId, operation);

  try {
    const result = await fn();
    return result;
  } finally {
    lock.release();
  }
}

// ============================================
// Combined Lock Management
// ============================================

/**
 * Lock info for status reporting
 */
export function getLockStatus() {
  const sessionLocks = [];
  const staleLocks = [];
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000; // 5 minutes

  for (const [key, value] of operationLocks) {
    const ageMs = now - new Date(value.startedAt).getTime();
    const lockInfo = {
      ...value,
      lockKey: key,
      ageMs,
      isStale: ageMs > staleThreshold
    };

    if (lockInfo.isStale) {
      staleLocks.push(lockInfo);
    } else {
      sessionLocks.push(lockInfo);
    }
  }

  return {
    sessionLocks,
    staleLocks,
    totalActive: sessionLocks.length,
    totalStale: staleLocks.length
  };
}

/**
 * Clean up stale locks (call periodically)
 *
 * @returns {Object} Cleanup summary
 */
export function cleanupStaleLocks() {
  const releasedCount = releaseStaleSessionLocks();

  return {
    releasedSessionLocks: releasedCount,
    timestamp: new Date().toISOString()
  };
}

// ============================================
// Lock with Timeout Wrapper
// ============================================

/**
 * Acquire session lock with timeout
 * Retries with exponential backoff until timeout
 *
 * @param {string} projectId - Project ID
 * @param {string} sessionId - Session ID
 * @param {string} operation - Operation type
 * @param {number} timeoutMs - Maximum wait time in milliseconds
 * @returns {Promise<Object>} Lock handle
 * @throws {LockTimeoutError} If timeout exceeded
 */
export async function acquireSessionLockWithTimeout(
  projectId,
  sessionId,
  operation,
  timeoutMs = 30000
) {
  const startTime = Date.now();
  let delay = 100; // Start with 100ms delay
  const maxDelay = 2000; // Max 2 second delay between retries

  while (Date.now() - startTime < timeoutMs) {
    try {
      return await acquireSessionLock(projectId, sessionId, operation);
    } catch (error) {
      if (error instanceof CompressionInProgressError) {
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, maxDelay);
      } else {
        throw error;
      }
    }
  }

  throw new LockTimeoutError(`${projectId}:${sessionId}:${operation}`, timeoutMs);
}

// ============================================
// Export all functions
// ============================================

export default {
  // Session locks
  acquireSessionLock,
  acquireSessionLockWithTimeout,
  isSessionLocked,
  getActiveOperations,
  getAllActiveOperations,
  releaseStaleSessionLocks,
  forceReleaseSessionLock,

  // File locks
  acquireManifestLock,
  isManifestLocked,
  withManifestLock,
  withSessionLock,

  // Status and cleanup
  getLockStatus,
  cleanupStaleLocks,

  // Constants
  OperationType
};
