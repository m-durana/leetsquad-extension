import { Router } from 'express';
import { stmts } from '../../db';

export const v1HealthRouter = Router();

const STALE_AFTER_SECONDS = 25 * 60 * 60; // 24h refresh + 1h grace

v1HealthRouter.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const row = stmts.getProblemCatalog.get() as { updated_at: number } | undefined;
  const catalogAgeSeconds = row ? Math.floor((Date.now() - row.updated_at) / 1000) : null;
  res.json({
    ok: true,
    catalog_age_seconds: catalogAgeSeconds,
    catalog_stale: catalogAgeSeconds === null || catalogAgeSeconds > STALE_AFTER_SECONDS,
  });
});
