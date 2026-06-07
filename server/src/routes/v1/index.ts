import { Router } from 'express';
import { traceIdMiddleware } from '../../traceId';
import { v1ErrorHandler } from '../../errorEnvelope';
import { tieredLimiter } from '../../v1RateLimits';
import { optionalApiKey } from '../../apiKeyMiddleware';
import { v1HealthRouter } from './health';
import { v1UsersRouter } from './users';
import { v1StatsRouter } from './stats';
import { v1ChangesRouter } from './changes';
import { v1SlugsRouter } from './slugs';
import { v1KeyRouter } from './key';
import { v1OpenApiRouter } from './openapi';
import { v1CatalogRouter } from './catalog';

export function createV1Router(): Router {
  const router = Router();

  router.use(traceIdMiddleware);
  // Attach the key (if any) before the per-route limiters fire so they pick the right tier.
  router.use(optionalApiKey);

  const usersGetLimits = tieredLimiter({
    anonPerWindow: 60,
    anonWindowMs: 60 * 60_000,
    keyedPerWindow: 5,
    keyedWindowMs: 1_000,
  });
  const usersCountLimits = tieredLimiter({
    anonPerWindow: 120,
    anonWindowMs: 60 * 60_000,
    keyedPerWindow: 10,
    keyedWindowMs: 1_000,
  });
  const usersListLimits = tieredLimiter({
    anonPerWindow: 0,
    anonWindowMs: 60 * 60_000,
    keyedPerWindow: 1,
    keyedWindowMs: 1_000,
  });
  const statsLimits = tieredLimiter({
    anonPerWindow: 60,
    anonWindowMs: 60 * 60_000,
    keyedPerWindow: 5,
    keyedWindowMs: 1_000,
  });
  const changesLimits = tieredLimiter({
    anonPerWindow: 0,
    anonWindowMs: 60 * 60_000,
    keyedPerWindow: 5,
    keyedWindowMs: 1_000,
  });
  const slugCountLimits = tieredLimiter({
    anonPerWindow: 120,
    anonWindowMs: 60 * 60_000,
    keyedPerWindow: 10,
    keyedWindowMs: 1_000,
  });
  const slugSolversLimits = tieredLimiter({
    anonPerWindow: 0,
    anonWindowMs: 60 * 60_000,
    keyedPerWindow: 2,
    keyedWindowMs: 1_000,
  });

  router.use('/health', v1HealthRouter);
  router.use('/openapi.json', v1OpenApiRouter);

  router.use(
    '/users',
    (req, res, next) => {
      if (req.method !== 'GET') return next();
      const p = req.path;
      if (p === '/' || p === '') return usersListLimits(req, res, next);
      if (p.endsWith('/count')) return usersCountLimits(req, res, next);
      return usersGetLimits(req, res, next);
    },
    v1UsersRouter
  );

  router.use('/stats', statsLimits, v1StatsRouter);
  router.use('/changes', changesLimits, v1ChangesRouter);

  router.use(
    '/slugs',
    (req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.path.endsWith('/solvers')) return slugSolversLimits(req, res, next);
      return slugCountLimits(req, res, next);
    },
    v1SlugsRouter
  );

  router.use('/key', v1KeyRouter);

  const catalogLimits = tieredLimiter({
    anonPerWindow: 30,
    anonWindowMs: 60 * 60_000,
    keyedPerWindow: 2,
    keyedWindowMs: 1_000,
  });
  router.use('/catalog', catalogLimits, v1CatalogRouter);

  router.use(v1ErrorHandler);
  return router;
}
