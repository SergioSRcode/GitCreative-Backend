import { Router, Response } from 'express'
import { requireAuth, AuthRequest } from '../middleware/auth'

// router entry point /api/auth/
const router = Router()

// applies requireAuth to all routes in this file
router.use(requireAuth);

router.get('/', async (req: AuthRequest, res: Response) => {
  // req.userId is accessible due to requireAuth middleware
  res.json({ message: `fetching projects for user ${req.userId}` })
})

export default router