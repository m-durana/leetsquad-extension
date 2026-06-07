import { Router, Request, Response } from 'express';
import { stmts, db, parseSlugsJson, serializeSlugMap, unionSlugMaps } from '../db';
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

  const map = parseSlugsJson(row.slugs_json);
  const slugs = Object.keys(map);

  const cc = stmts.countContributorsForTarget.get(username) as { c: number };

  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.json({
    slugs,
    solved_slug_details: map,
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
  // Targets this user contributed to need their solved_sets recomputed after stripping our rows.
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
        updated_at: number;
      }>;
      const sorted = rows.slice().sort((a, b) => a.updated_at - b.updated_at);
      const union = unionSlugMaps(sorted.map((r) => parseSlugsJson(r.slugs_json)));
      if (Object.keys(union).length === 0) {
        stmts.deleteSolvedSet.run(target);
      } else {
        stmts.upsertCrowdsourcedSet.run(target, serializeSlugMap(union), 2, Date.now());
      }
    }
  });
  tx();

  res.status(204).end();
});
