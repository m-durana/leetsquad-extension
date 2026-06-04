import { Router, Response, NextFunction } from 'express';
import { stmts, db } from '../../db';
import { isValidUsername, clampLimit, encodeCursor, decodeCursor } from '../../validation';
import { ApiError } from '../../errorEnvelope';
import { requireApiKey, ApiKeyedRequest, optionalApiKey } from '../../apiKeyMiddleware';
import { requireAuth, AuthedRequest } from '../../authMiddleware';
import { fixedLimiter } from '../../v1RateLimits';

export const v1UsersRouter = Router();

const deleteMeLimiter = fixedLimiter({ perWindow: 3, windowMs: 24 * 60 * 60_000, bucket: 'v1users_delete_me', by: 'jwt' });

// Keeps followers' friend lists and contributions this user made about others intact.
v1UsersRouter.delete('/me', deleteMeLimiter, requireAuth, (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const username = req.auth!.lc_username;
    const tx = db.transaction(() => {
      stmts.deleteContributionsForTarget.run(username);
      stmts.deleteSolvedSet.run(username);
      stmts.deleteFriendsForUser.run(username);
      stmts.deleteDailyGoalsForUser.run(username);
      stmts.deleteApiKeysForUser.run(username);
      db.prepare('DELETE FROM public_solved_counts WHERE lc_username = ?').run(username);
      stmts.deleteNoncesForUser.run(username);
      stmts.deleteUser.run(username);
    });
    tx();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, deleted: username });
  } catch (e) {
    next(e);
  }
});

interface UserListCursor {
  lastUsername: string;
  lastUpdatedAt: number;
}

v1UsersRouter.get('/', requireApiKey, (req: ApiKeyedRequest, res: Response, next: NextFunction) => {
  try {
    const limit = clampLimit(req.query.limit, 50, 200);
    const cursor = decodeCursor<UserListCursor>(req.query.cursor);
    if (req.query.cursor && !cursor) throw new ApiError('bad_cursor', 'malformed cursor');

    const rows = (cursor
      ? db
          .prepare(
            `SELECT lc_username AS username, updated_at, slugs_json
             FROM solved_sets
             WHERE (updated_at, lc_username) < (?, ?)
             ORDER BY updated_at DESC, lc_username DESC
             LIMIT ?`
          )
          .all(cursor.lastUpdatedAt, cursor.lastUsername, limit)
      : db
          .prepare(
            `SELECT lc_username AS username, updated_at, slugs_json
             FROM solved_sets
             ORDER BY updated_at DESC, lc_username DESC
             LIMIT ?`
          )
          .all(limit)) as Array<{ username: string; updated_at: number; slugs_json: string }>;

    const users = rows.map((r) => {
      let solved_count = 0;
      try {
        solved_count = (JSON.parse(r.slugs_json) as string[]).length;
      } catch {}
      return { username: r.username, solved_count, updated_at: r.updated_at };
    });

    const nextCursor =
      users.length === limit
        ? encodeCursor({
            lastUsername: rows[rows.length - 1].username,
            lastUpdatedAt: rows[rows.length - 1].updated_at,
          })
        : null;

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ users, next_cursor: nextCursor });
  } catch (e) {
    next(e);
  }
});

v1UsersRouter.get('/:username/count', optionalApiKey, (req: ApiKeyedRequest, res: Response, next: NextFunction) => {
  try {
    const username = req.params.username;
    if (!isValidUsername(username)) throw new ApiError('invalid_username', 'malformed username');

    const row = stmts.getSolvedSet.get(username) as
      | { slugs_json: string; updated_at: number }
      | undefined;

    if (!row) throw new ApiError('not_found', 'user is not published');

    let solved_count = 0;
    try {
      solved_count = (JSON.parse(row.slugs_json) as string[]).length;
    } catch {}

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ username, solved_count, updated_at: row.updated_at });
  } catch (e) {
    next(e);
  }
});

v1UsersRouter.get('/:username', optionalApiKey, (req: ApiKeyedRequest, res: Response, next: NextFunction) => {
  try {
    const username = req.params.username;
    if (!isValidUsername(username)) throw new ApiError('invalid_username', 'malformed username');

    const row = stmts.getSolvedSet.get(username) as
      | { slugs_json: string; schema_version: number; updated_at: number }
      | undefined;
    if (!row) throw new ApiError('not_found', 'user is not published');

    let slugs: string[];
    try {
      slugs = JSON.parse(row.slugs_json) as string[];
    } catch {
      throw new ApiError('internal', 'corrupt record');
    }

    const cc = stmts.countContributorsForTarget.get(username) as { c: number };

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({
      username,
      solved_slugs: slugs,
      solved_count: slugs.length,
      contributors_count: cc.c,
      updated_at: row.updated_at,
      schema_version: row.schema_version,
    });
  } catch (e) {
    next(e);
  }
});
