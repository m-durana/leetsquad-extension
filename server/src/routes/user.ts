import { Router, Request, Response } from 'express';
import { stmts, db } from '../db';
import { isValidUsername } from '../nonce';
import { requireAuth, AuthedRequest } from '../authMiddleware';

export const userRouter = Router();

userRouter.get('/:username', (req: Request, res: Response) => {
  const username = req.params.username;
  if (!isValidUsername(username)) return res.status(400).json({ error: 'invalid_username' });

  const row = stmts.getSolvedSet.get(username) as
    | { slugs_json: string; schema_version: number; updated_at: number }
    | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });

  let slugs: string[];
  try {
    slugs = JSON.parse(row.slugs_json);
  } catch {
    return res.status(500).json({ error: 'corrupt_record' });
  }

  const cc = stmts.countContributorsForTarget.get(username) as { c: number };

  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.json({
    slugs,
    updated_at: row.updated_at,
    schema_version: row.schema_version,
    contributors_count: cc.c,
  });
});

userRouter.delete('/:username', requireAuth, (req: AuthedRequest, res: Response) => {
  const username = req.params.username;
  if (!isValidUsername(username)) return res.status(400).json({ error: 'invalid_username' });
  if (req.auth!.lc_username.toLowerCase() !== username.toLowerCase()) {
    return res.status(403).json({ error: 'not_owner' });
  }
  // Find every target this user has contributed to (other than themselves);
  // after we strip their contributions, those targets' derived solved_sets
  // need to be recomputed (or removed if they had no other contributors).
  const affectedTargets = (db
    .prepare(
      'SELECT DISTINCT target_username FROM contributions ' +
        'WHERE contributor_username = ? AND target_username != ?'
    )
    .all(username, username) as Array<{ target_username: string }>).map((r) => r.target_username);

  const tx = db.transaction(() => {
    stmts.deleteContributionsForTarget.run(username);
    stmts.deleteContributionsByContributor.run(username);
    stmts.deleteSolvedSet.run(username);
    stmts.deleteUser.run(username);

    for (const target of affectedTargets) {
      const rows = stmts.getContributionsForTarget.all(target) as Array<{
        contributor_username: string;
        slugs_json: string;
      }>;
      const union = new Set<string>();
      for (const row of rows) {
        try {
          for (const s of JSON.parse(row.slugs_json) as string[]) union.add(s);
        } catch {}
      }
      if (union.size === 0) {
        stmts.deleteSolvedSet.run(target);
      } else {
        stmts.upsertCrowdsourcedSet.run(target, JSON.stringify(Array.from(union)), 1, Date.now());
      }
    }
  });
  tx();

  res.status(204).end();
});
