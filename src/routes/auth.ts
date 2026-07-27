import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { registerLimiter, loginLimiter } from '../middleware/rateLimit';

// router entry point /api/auth/
const router = Router();
// controls how slow bcrypt runs; 12 is default
const SALT_ROUNDS = 12;

function signToken(userId: string): string {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' }
  )
}

router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  const { email, password, displayName, website } =  req.body;  // website === HP, must be falsy

  if (website) {
    // Silently pretend success
    res.status(201).json({
      token: 'fake-token-for-bots',
      user: { id: 'fake', email, displayName },
    });

    return;
  }
  
  // input validation
  if (!email || !password || !displayName) {
    res.status(400).json({ error: 'email, password and displayName are required'});
    return;
  } 

  if (password.length < 8) {
    res.status(400).json({ error: 'password must have at least 8 characters' });
    return;
  }

  try {
    // Check if email is already registered
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1', [email]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'email already in use' });
      return;
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert new user; 
    // Returns inserted row immediately (avoids second query for fetching the created data)
    const result = await pool.query(
      `INSERT INTO users (email, password, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
       [email, hashedPassword, displayName]
    );

    const user = result.rows[0];

    // Seed default user settings
    await pool.query(
      `INSERT INTO user_settings (user_id, settings)
       VALUES ($1, $2)`,
       [user.id, JSON.stringify({
        theme: 'light',
        language: 'en',
        pressure_sensitivity: 1.0,
        default_canvas_size: { width: 1920, height: 1080 }
       })]
    );

    // Issue JWT
    const token = signToken(user.id);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name
      }
    });
  } catch (err) {
    console.error('Registration error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required'});
    return;
  }

  try {
    // lookup user by email
    const result = await pool.query(
      'SELECT id, email, display_name, password FROM users WHERE email = $1',
      [email]
    );

    // if user/email doesn't exist, throw error
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const user = result.rows[0];

    // Compare password against hash version
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const token = signToken(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name
      }
    });
  } catch (err) {
    console.error('Login error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;