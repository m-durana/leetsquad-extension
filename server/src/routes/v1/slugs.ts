import { Router, Response, NextFunction } from 'express';
import { db } from '../../db';
import {
  isValidSlug,
  clampLimit,
  encodeCursor,
  decodeCursor,
} from '../../validation';
import { ApiError } from '../../errorEnvelope';
import { ApiKeyedRequest, optionalApiKey, requireApiKey } from '../../apiKeyMiddleware';

export const v1SlugsRouter = Router();

interface SolversCursor {
  lastUsername: string;
}

v1SlugsRouter.get('/:slug/count', optionalApiKey, (req: ApiKeyedRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug;
    if (!isValidSlug(slug)) throw new ApiError('bad_slug', 'malformed slug');

    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM solved_sets
         WHERE EXISTS (SELECT 1 FROM json_each(slugs_json) WHERE value = ?)`
      )
      .get(slug) as { c: number };

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ slug, solver_count: row.c, generated_at: Date.now() });
  } catch (e) {
    next(e);
  }
});

v1SlugsRouter.get('/:slug/solvers', requireApiKey, (req: ApiKeyedRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug;
    if (!isValidSlug(slug)) throw new ApiError('bad_slug', 'malformed slug');

    const limit = clampLimit(req.query.limit, 50, 200);
    const cursor = decodeCursor<SolversCursor>(req.query.cursor);
    if (req.query.cursor && !cursor) throw new ApiError('bad_cursor', 'malformed cursor');
    const after = cursor?.lastUsername ?? '';

    const rows = db
      .prepare(
        `SELECT lc_username AS username, updated_at FROM solved_sets
         WHERE EXISTS (SELECT 1 FROM json_each(slugs_json) WHERE value = ?)
           AND lc_username > ?
         ORDER BY lc_username ASC
         LIMIT ?`
      )
      .all(slug, after, limit) as Array<{ username: string; updated_at: number }>;

    const next_cursor =
      rows.length === limit
        ? encodeCursor({ lastUsername: rows[rows.length - 1].username })
        : null;

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ slug, solvers: rows, next_cursor });
  } catch (e) {
    next(e);
  }
});
