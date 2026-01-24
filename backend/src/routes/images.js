import express from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const router = express.Router();

// Valid image directories - all served images must be under one of these paths
const ALLOWED_IMAGE_DIRS = [
  path.join(os.homedir(), '.claude', 'images'),
  path.join(os.homedir(), 'Pictures'),
  path.join(os.homedir(), '.claude')  // For any other claude-related images
];

// Map of file extensions to MIME types
const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
};

/**
 * GET /api/images
 * Serve an extracted image file
 * Query params:
 *   - path: Full file path to the image (must be under ~/.claude/images/)
 *
 * Security: Validates that the requested path is under the allowed images directory
 */
router.get('/', async (req, res, next) => {
  try {
    const { path: imagePath } = req.query;

    if (!imagePath) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PATH',
          message: 'Missing required query parameter: path'
        }
      });
    }

    // Normalize the path to prevent directory traversal attacks
    const normalizedPath = path.normalize(imagePath);

    // Resolve to absolute path
    const absolutePath = path.isAbsolute(normalizedPath)
      ? normalizedPath
      : path.resolve(normalizedPath);

    // Security check: Ensure the path is under one of the allowed directories
    const isAllowed = ALLOWED_IMAGE_DIRS.some(allowedDir => {
      const resolvedBase = path.resolve(allowedDir);
      return absolutePath.startsWith(resolvedBase + path.sep) || absolutePath === resolvedBase;
    });

    if (!isAllowed) {
      console.warn(`[images] Blocked access to path outside allowed directories: ${absolutePath}`);
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied: Path is not within the allowed images directory'
        }
      });
    }

    // Check if file exists
    try {
      await fs.access(absolutePath);
    } catch (err) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Image file not found'
        }
      });
    }

    // Get file stats
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      return res.status(400).json({
        error: {
          code: 'NOT_A_FILE',
          message: 'Path is not a file'
        }
      });
    }

    // Determine content type from extension
    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Read and send the file
    const fileBuffer = await fs.readFile(absolutePath);

    res.set({
      'Content-Type': contentType,
      'Content-Length': fileBuffer.length,
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year (images don't change)
    });

    res.send(fileBuffer);
  } catch (error) {
    console.error('[images] Error serving image:', error);
    next(error);
  }
});

export default router;
