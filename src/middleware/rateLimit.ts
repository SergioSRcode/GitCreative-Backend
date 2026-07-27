import rateLimit from 'express-rate-limit';

// Registration: strict — signups should be rare relative to normal traffic
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour window
  max: 5,                     // 5 registration attempts per IP per hour
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,      // adds RateLimit-* headers so clients can see their remaining quota
  legacyHeaders: false,       // disables the older X-RateLimit-* headers, standardHeaders is the modern replacement
});

// Login: slightly more lenient as actual humans mistype passwords sometimes
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minute window
  max: 10,                    // 10 login attempts per IP per 15 minutes
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});