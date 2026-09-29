import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { syncRouter } from './routes/sync';
import { userRouter } from './routes/user';
import { friendsRouter } from './routes/friends';
import { dailyGoalsRouter } from './routes/daily-goals';
import { profileRouter } from './routes/profile';
import { createV1Router } from './routes/v1';
import { config } from './config';

export function createApp() {
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '256kb' }));

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowed = config.allowedOrigins.some((pattern) => {
          if (pattern === '*') return true;
          if (pattern.endsWith('/*')) return origin.startsWith(pattern.slice(0, -1));
          if (pattern.includes('*')) {
            const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return re.test(origin);
          }
          return origin === pattern;
        });
        cb(allowed ? null : new Error('cors_blocked'), allowed);
      },
    })
  );

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/sync', syncRouter);
  app.use('/user', userRouter);
  app.use('/friends', friendsRouter);
  app.use('/daily-goals', dailyGoalsRouter);
  app.use('/profile', profileRouter);
  app.use('/api/v1', createV1Router());

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.message === 'cors_blocked') return res.status(403).json({ error: 'cors_blocked' });
    console.error(err);
    res.status(500).json({ error: 'internal' });
  });

  return app;
}
