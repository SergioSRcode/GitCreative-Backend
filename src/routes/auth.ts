import { Router } from 'express';

const router = Router();

// Placeholder
router.get('/ping', (_req, res) => {
  res.json({ message: 'auth router alive' });
});

export default router;