import rateLimit from 'express-rate-limit';

const isTestEnv = process.env.NODE_ENV === 'test';

// Registration: strict — signups should be rare relative to normal traffic
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour window
  max: 5,                     // 5 registration attempts per IP per hour
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,      // adds RateLimit-* headers so clients can see their remaining quota
  legacyHeaders: false,       // disables the older X-RateLimit-* headers, standardHeaders is the modern replacement
  skip: () => isTestEnv,  // bypass entirely when running tests
});

// Login: slightly more lenient as actual humans mistype passwords sometimes
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minute window
  max: 10,                    // 10 login attempts per IP per 15 minutes
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv,  // bypass entirely when running tests
});

export const commitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,  // 30 commits per minute per IP — generous for real use, blocks scripted abuse
  message: { error: 'Too many commits — please slow down.' },
  standardHeaders: true, legacyHeaders: false,
  skip: () => isTestEnv,
});

export const projectCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,  // generous — 20 new projects per hour is plenty for real use
  message: { error: 'Too many projects created — please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv,
});