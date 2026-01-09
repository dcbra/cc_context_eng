import express from 'express';

const router = express.Router();

/**
 * POST /api/sanitize/:sessionId
 * Apply sanitization rules
 */
router.post('/:sessionId', async (req, res, next) => {
  try {
    // Placeholder - implemented in Phase 3
    res.status(501).json({ error: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

export default router;
