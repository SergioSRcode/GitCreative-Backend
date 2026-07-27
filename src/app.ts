import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth'
import projectRoutes from './routes/projects'

export function createApp() {
  const app = express();

  app.use(cors({ origin: 'http://localhost:5173' }));

  app.use(express.raw({
    type: 'application/octet-stream',
    limit: '100mb',
  }));
  app.use(express.json());

  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}