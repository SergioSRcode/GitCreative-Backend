import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';
import { ensureBucket } from './storage';

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  await ensureBucket();
  console.log(`GitCreative API running on http://localhost:${PORT}`);
});
