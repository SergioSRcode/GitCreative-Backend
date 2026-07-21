import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import { ensureBucket } from './storage';



const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'http://localhost:5173' }));
// raw binary parser for snapshot uploads - applied only to the commit route (binary can't go through express.json())
// app.use(`/api/projects/:id/commits`, (req, res, next) => {
//   if (req.method === 'POST') {
//     express.raw({ type: 'application/octet-stream', limit: '50mb' })(req, res, next);
//   } else {
//     next();
//   }
// });

// temp log
// app.use((req, res, next) => {
//   console.log(`${req.method} ${req.path} Content-Type: ${req.headers['content-type']} Content-Length: ${req.headers['content-length']}`)
//   next()
// })

app.use(express.raw({
  type: 'application/octet-stream',
  limit: '100mb',
}));

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);

// checking health
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, async () => {
  await ensureBucket();
  console.log(`GitCreative API running on http://localhost:${PORT}`);
});
