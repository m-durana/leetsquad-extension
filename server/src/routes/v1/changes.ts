import { Router, Response, NextFunction } from 'express';
import { db } from '../../db';
import { clampLimit, parseSince } from '../../validation';
import { ApiKeyedRequest, requireApiKey } from '../../apiKeyMiddleware';

export const v1ChangesRouter = Router();

v1ChangesRouter.get('/', requireApiKey, (req: ApiKeyedRequest, res: Response, next: NextFunction) => {
  try {
    const since = parseSince(req.query.since);
    const limit = clampLimit(req.query.limit, 50, 200);

    const rows = db
      .prepare(
        `SELECT lc_username AS username, updated_at FROM solved_sets
         WHERE updated_at > ?
         ORDER BY updated_at ASC, lc_username ASC
         LIMIT ?`
      )
      .all(since, limit) as Array<{ username: string; updated_at: number }>;

    const next_since = rows.length > 0 ? rows[rows.length - 1].updated_at : since;

    res.setHeader('Cache-Control', 'no-store');
    res.json({ changes: rows, next_since });
  } catch (e) {
    next(e);
  }
});
