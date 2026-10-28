import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';
import {
  createApiRouter,
  loadFirebaseWebConfig,
  sendFirebaseMessagingServiceWorker,
} from './api/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Runtime Public Firebase Web SDK Config Script
  app.get('/runtime-firebase-config.js', (_req: Request, res: Response) => {
    const activeConfig = loadFirebaseWebConfig();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(`window.__FIREBASE_RUNTIME_CONFIG__ = ${JSON.stringify(activeConfig)};\n`);
  });

  // Dynamic Firebase Cloud Messaging Service Worker
  app.get('/firebase-messaging-sw.js', sendFirebaseMessagingServiceWorker);

  // Mount shared backend API routes
  app.use('/api', createApiRouter());

  // Mount Vite middleware in development or static dist in production
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'dist'));
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Finesteride Recur 1Mg Shop Bd Admin Server listening on http://0.0.0.0:${port}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
