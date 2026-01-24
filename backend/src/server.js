import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Route imports
import projectRoutes from './routes/projects.js';
import sessionRoutes from './routes/sessions.js';
import sanitizeRoutes from './routes/sanitize.js';
import backupRoutes from './routes/backup.js';
import exportRoutes from './routes/export.js';
import summarizeRoutes from './routes/summarize.js';
import memoryRoutes from './routes/memory.js';
import imagesRoutes from './routes/images.js';

// Error handling imports
import { memoryErrorHandler, MemoryError } from './services/memory-errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API Routes
app.use('/api/projects', projectRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/sanitize', sanitizeRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/summarize', summarizeRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/images', imagesRoutes);

// Global error handling middleware
// Handles both MemoryError instances and generic errors
app.use((err, req, res, next) => {
  // Log error for debugging
  console.error('Error:', err);

  // Handle MemoryError instances with standardized format
  if (err instanceof MemoryError) {
    const response = err.toResponse();

    // Add stack trace in development mode
    if (process.env.NODE_ENV === 'development') {
      response.error.stack = err.stack;
    }

    return res.status(err.statusCode).json(response);
  }

  // Handle errors with code property (legacy format from services)
  if (err.code && typeof err.code === 'string' && !err.code.startsWith('E')) {
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

  // Handle multer file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'File size exceeds maximum allowed limit'
      }
    });
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

  res.status(statusCode).json(response);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.path}`
    }
  });
});

app.listen(PORT, () => {
  console.log(`CC Context Manager backend listening on http://localhost:${PORT}`);
});
