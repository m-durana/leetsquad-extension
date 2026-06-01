import { Router } from 'express';

export const v1HealthRouter = Router();

v1HealthRouter.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});
