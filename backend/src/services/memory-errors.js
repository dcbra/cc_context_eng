/**
 * Memory System Error Classes
 *
 * Standardized error handling for all memory system operations.
 * All errors follow the format: { error: { code, message, details? } }
 *
 * Phase 5 - Task 5.1: Error Handling Middleware
 */

/**
 * Base error class for all memory system errors
 * Provides standardized response format and HTTP status codes
 */
export class MemoryError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {string} code - Machine-readable error code
   * @param {number} statusCode - HTTP status code (default: 500)
   * @param {Object} details - Additional error details
   */
  constructor(message, code, statusCode = 500, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to standardized response format
   * @returns {Object} Error response object
   */
  toResponse() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(Object.keys(this.details).length > 0 && { details: this.details })
      }
    };
  }
}

// ============================================
// 404 Not Found Errors
// ============================================

/**
 * Thrown when a requested session cannot be found
 */
export class SessionNotFoundError extends MemoryError {
  constructor(sessionId, projectId = null) {
    super(
      `Session ${sessionId} not found${projectId ? ` in project ${projectId}` : ''}`,
      'SESSION_NOT_FOUND',
      404,
      { sessionId, ...(projectId && { projectId }) }
    );
  }
}

/**
 * Thrown when a requested project cannot be found
 */
export class ProjectNotFoundError extends MemoryError {
  constructor(projectId) {
    super(
      `Project not found: ${projectId}`,
      'PROJECT_NOT_FOUND',
      404,
      { projectId }
    );
  }
}

/**
 * Thrown when a compression version cannot be found
 */
export class VersionNotFoundError extends MemoryError {
  constructor(sessionId, versionId) {
    super(
      `Version ${versionId} not found for session ${sessionId}`,
      'VERSION_NOT_FOUND',
      404,
      { sessionId, versionId }
    );
  }
}

/**
 * Thrown when a keepit marker cannot be found
 */
export class KeepitNotFoundError extends MemoryError {
  constructor(markerId, sessionId = null) {
    super(
      `Keepit marker ${markerId} not found${sessionId ? ` in session ${sessionId}` : ''}`,
      'KEEPIT_NOT_FOUND',
      404,
      { markerId, ...(sessionId && { sessionId }) }
    );
  }
}

/**
 * Thrown when a composition cannot be found
 */
export class CompositionNotFoundError extends MemoryError {
  constructor(compositionId, projectId = null) {
    super(
      `Composition ${compositionId} not found${projectId ? ` in project ${projectId}` : ''}`,
      'COMPOSITION_NOT_FOUND',
      404,
      { compositionId, ...(projectId && { projectId }) }
    );
  }
}

/**
 * Thrown when an original session file cannot be found on disk
 */
export class OriginalFileNotFoundError extends MemoryError {
  constructor(filePath, sessionId = null) {
    super(
      `Original session file not found: ${filePath}`,
      'ORIGINAL_FILE_NOT_FOUND',
      404,
      { filePath, ...(sessionId && { sessionId }) }
    );
  }
}

/**
 * Thrown when a version file cannot be found on disk
 */
export class VersionFileNotFoundError extends MemoryError {
  constructor(versionId, format = null) {
    super(
      `Version file not found: ${versionId}${format ? ` (${format})` : ''}`,
      'VERSION_FILE_NOT_FOUND',
      404,
      { versionId, ...(format && { format }) }
    );
  }
}

/**
 * Thrown when a composition output file cannot be found
 */
export class CompositionFileNotFoundError extends MemoryError {
  constructor(compositionId, format = null) {
    super(
      `Composition file not found: ${compositionId}${format ? ` (${format})` : ''}`,
      'COMPOSITION_FILE_NOT_FOUND',
      404,
      { compositionId, ...(format && { format }) }
    );
  }
}

// ============================================
// 409 Conflict Errors
// ============================================

/**
 * Thrown when trying to register a session that's already registered
 */
export class SessionAlreadyRegisteredError extends MemoryError {
  constructor(sessionId, projectId = null) {
    super(
      `Session ${sessionId} is already registered${projectId ? ` in project ${projectId}` : ''}`,
      'SESSION_ALREADY_REGISTERED',
      409,
      { sessionId, ...(projectId && { projectId }) }
    );
  }
}

/**
 * Thrown when a compression operation is already in progress for a session
 */
export class CompressionInProgressError extends MemoryError {
  constructor(sessionId, operationType = 'compression') {
    super(
      `${operationType} already in progress for session ${sessionId}`,
      'COMPRESSION_IN_PROGRESS',
      409,
      { sessionId, operationType }
    );
  }
}

/**
 * Thrown when trying to delete a version that's used in a composition
 */
export class VersionInUseError extends MemoryError {
  constructor(versionId, sessionId, compositionIds = []) {
    super(
      `Version ${versionId} is used in ${compositionIds.length} composition(s). Use force=true to delete anyway.`,
      'VERSION_IN_USE',
      409,
      { versionId, sessionId, compositionIds }
    );
  }
}

/**
 * Thrown when a resource is locked by another process
 */
export class LockError extends MemoryError {
  constructor(resource, message = null) {
    super(
      message || `Resource is locked: ${resource}`,
      'RESOURCE_LOCKED',
      409,
      { resource }
    );
  }
}

/**
 * Thrown when a lock acquisition times out
 */
export class LockTimeoutError extends MemoryError {
  constructor(resource, timeoutMs) {
    super(
      `Lock acquisition timed out after ${timeoutMs}ms for: ${resource}`,
      'LOCK_TIMEOUT',
      409,
      { resource, timeoutMs }
    );
  }
}

// ============================================
// 400 Bad Request Errors
// ============================================

/**
 * Thrown when compression settings are invalid
 */
export class InvalidSettingsError extends MemoryError {
  constructor(message, validationErrors = []) {
    super(
      message || 'Invalid compression settings',
      'INVALID_SETTINGS',
      400,
      { validationErrors }
    );
  }
}

/**
 * Thrown when request validation fails
 */
export class ValidationError extends MemoryError {
  constructor(message, field = null, validationErrors = []) {
    super(
      message,
      'VALIDATION_ERROR',
      400,
      {
        ...(field && { field }),
        ...(validationErrors.length > 0 && { validationErrors })
      }
    );
  }
}

/**
 * Thrown when a session doesn't have enough messages to compress
 */
export class InsufficientMessagesError extends MemoryError {
  constructor(sessionId, messageCount, requiredCount = 2) {
    super(
      `Session ${sessionId} has ${messageCount} messages, but at least ${requiredCount} are required for compression`,
      'INSUFFICIENT_MESSAGES',
      400,
      { sessionId, messageCount, requiredCount }
    );
  }
}

/**
 * Thrown when trying to delete the original pseudo-version
 */
export class CannotDeleteOriginalError extends MemoryError {
  constructor(sessionId) {
    super(
      'Cannot delete the original session version',
      'CANNOT_DELETE_ORIGINAL',
      400,
      { sessionId }
    );
  }
}

/**
 * Thrown when a session file cannot be parsed
 */
export class SessionParseError extends MemoryError {
  constructor(sessionId, reason) {
    super(
      `Failed to parse session file for ${sessionId}: ${reason}`,
      'SESSION_PARSE_ERROR',
      400,
      { sessionId, reason }
    );
  }
}

/**
 * Thrown when import data is invalid
 */
export class InvalidImportError extends MemoryError {
  constructor(message, validationErrors = []) {
    super(
      message || 'Invalid import data',
      'INVALID_IMPORT',
      400,
      { validationErrors }
    );
  }
}

/**
 * Thrown when an invalid format is requested
 */
export class InvalidFormatError extends MemoryError {
  constructor(format, validFormats = ['md', 'jsonl']) {
    super(
      `Invalid format: ${format}. Must be one of: ${validFormats.join(', ')}`,
      'INVALID_FORMAT',
      400,
      { format, validFormats }
    );
  }
}

// ============================================
// 500 Server Errors
// ============================================

/**
 * Thrown when compression fails during processing
 */
export class CompressionFailedError extends MemoryError {
  constructor(sessionId, reason) {
    super(
      `Compression failed for session ${sessionId}: ${reason}`,
      'COMPRESSION_FAILED',
      500,
      { sessionId, reason }
    );
  }
}

/**
 * Thrown when the manifest file is corrupted
 */
export class ManifestCorruptionError extends MemoryError {
  constructor(projectId, reason) {
    super(
      `Manifest corruption detected for project ${projectId}: ${reason}`,
      'MANIFEST_CORRUPTION',
      500,
      { projectId, reason }
    );
  }
}

/**
 * Thrown when a file system operation fails
 */
export class FileSystemError extends MemoryError {
  constructor(operation, path, reason) {
    super(
      `File system error during ${operation}: ${reason}`,
      'FILESYSTEM_ERROR',
      500,
      { operation, path, reason }
    );
  }
}

// ============================================
// 507 Insufficient Storage Errors
// ============================================

/**
 * Thrown when there's not enough disk space
 */
export class DiskSpaceError extends MemoryError {
  constructor(requiredBytes, availableBytes) {
    super(
      `Insufficient disk space. Required: ${formatBytes(requiredBytes)}, Available: ${formatBytes(availableBytes)}`,
      'DISK_SPACE_EXHAUSTED',
      507,
      { requiredBytes, availableBytes }
    );
  }
}

// ============================================
// 429 Rate Limit Errors
// ============================================

/**
 * Thrown when the model API rate limit is exceeded
 */
export class ModelRateLimitError extends MemoryError {
  constructor(retryAfter = null) {
    super(
      'Model API rate limit exceeded',
      'MODEL_RATE_LIMIT',
      429,
      { ...(retryAfter && { retryAfter }) }
    );
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Error handling middleware for Express
 * Converts MemoryError instances to proper responses
 *
 * @param {Error} err - The error
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next function
 */
export function memoryErrorHandler(err, req, res, next) {
  // Handle MemoryError instances
  if (err instanceof MemoryError) {
    const response = err.toResponse();

    // Add stack trace in development mode
    if (process.env.NODE_ENV === 'development') {
      response.error.stack = err.stack;
    }

    return res.status(err.statusCode).json(response);
  }

  // Handle errors with code property (legacy format)
  if (err.code && typeof err.code === 'string') {
    const statusCode = err.status || err.statusCode || 500;
    const response = {
      error: {
        code: err.code,
        message: err.message
      }
    };

    if (process.env.NODE_ENV === 'development') {
      response.error.stack = err.stack;
    }

    return res.status(statusCode).json(response);
  }

  // Handle generic errors
  const statusCode = err.status || err.statusCode || 500;
  const response = {
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'development'
        ? err.message
        : 'An internal error occurred'
    }
  };

  if (process.env.NODE_ENV === 'development') {
    response.error.stack = err.stack;
  }

  console.error('Unhandled error:', err);
  return res.status(statusCode).json(response);
}

/**
 * Wrap an async route handler to catch errors
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
