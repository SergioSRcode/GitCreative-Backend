import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

// Vitest calls this exported function once, before any test file runs,
// and waits for the returned promise to resolve
export async function setup() {
  // Dynamic import — only resolves AFTER dotenv.config() above has already run,
  // guaranteeing storage.ts reads the correct test env vars when it initializes
  const { ensureBucket } = await import('./storage');
  await ensureBucket();
}