import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { stmts, db } from '../db';
import { requireAuth, AuthedRequest } from '../authMiddleware';
import { getCachedPublicSolvedCount } from '../publicCount';

export const syncRouter = Router();

const MAX_SLUGS_PER_USER = 10_000;
const MAX_FRIENDS_PER_UPLOAD = 250;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const USERNAME_RE = /^[a-zA-Z0-9_-]{1,30}$/;
const SLUG_COUNT_GRACE = 50;

const limitsDisabled = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMITS === '1';

const syncLimiter = limitsDisabled
  ? (_req: AuthedRequest, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60 * 60_000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });

const syncBody = z.object({
  slugs: z.array(z.string()).max(MAX_SLUGS_PER_USER),
  friend_sets: z.record(z.array(z.string()).max(MAX_SLUGS_PER_USER)).optional(),
  updated_at: z.number().int().positive(),
  schema_version: z.number().int().positive(),
});

function cleanSlugs(slugs: string[]): string[] {
  return Array.from(new Set(slugs.filter((s) => SLUG_RE.test(s))));
}

type ApplyResult = 'ok' | 'count_exceeded' | 'leetcode_unreachable' | 'user_not_found';

// Apply a single contribution (target=who is being described, contributor=who
// is doing the describing). Recomputes solved_sets[target] as the union
// across all contributors after the write. The public-count guard is checked
// against that final union, not the individual contribution, so collusion
// across N contributors cannot inflate a target past their public solved
// count plus grace.
async function applyContribution(
  target: string,
  contributor: string,
  incoming: string[],
  options: { isSelf: boolean; schemaVersion: number; updatedAt: number }
): Promise<{ accepted: number; result: ApplyResult; contributorsCount?: number }> {
  const cleaned = cleanSlugs(incoming);

  // Compute what this contributor's row would become.
  const prev = stmts.getContribution.get(target, contributor) as { slugs_json: string } | undefined;
  const contribSlugs = new Set<string>();
  if (prev?.slugs_json) {
    try {
      const arr: string[] = JSON.parse(prev.slugs_json);
      for (const s of arr) contribSlugs.add(s);
    } catch {}
  }
  for (const s of cleaned) contribSlugs.add(s);

  // Compute the proposed union across all contributors for this target.
  const otherRows = stmts.getContributionsForTarget.all(target) as Array<{
    contributor_username: string;
    slugs_json: string;
  }>;
  const proposedUnion = new Set<string>(contribSlugs);
  for (const row of otherRows) {
    if (row.contributor_username === contributor) continue; // we're replacing this row
    try {
      const arr: string[] = JSON.parse(row.slugs_json);
      for (const s of arr) proposedUnion.add(s);
    } catch {}
  }

  // Public-count guard fires against the union, not the contribution.
  let publicCount: number | null;
  try {
    publicCount = await getCachedPublicSolvedCount(target);
  } catch {
    return { accepted: 0, result: 'leetcode_unreachable' };
  }
  if (publicCount === null) return { accepted: 0, result: 'user_not_found' };
  if (proposedUnion.size > publicCount + SLUG_COUNT_GRACE) {
    return { accepted: 0, result: 'count_exceeded' };
  }

  // Persist contributor row + recomputed solved_sets row atomically.
  const contribArr = Array.from(contribSlugs);
  const unionArr = Array.from(proposedUnion);

  const tx = db.transaction(() => {
    stmts.upsertContribution.run(target, contributor, JSON.stringify(contribArr), options.updatedAt);
    if (options.isSelf) {
      stmts.upsertSelfSolvedSet.run(
        target,
        JSON.stringify(unionArr),
        options.schemaVersion,
        options.updatedAt,
        Date.now()
      );
    } else {
      stmts.upsertCrowdsourcedSet.run(
        target,
        JSON.stringify(unionArr),
        options.schemaVersion,
        options.updatedAt
      );
    }
  });
  tx();

  const cc = stmts.countContributorsForTarget.get(target) as { c: number };
  return { accepted: contribArr.length, result: 'ok', contributorsCount: cc.c };
}

syncRouter.post('/', syncLimiter, requireAuth, async (req: AuthedRequest, res: Response) => {
  const parsed = syncBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_body' });
  const { slugs, friend_sets, updated_at, schema_version } = parsed.data;
  const me = req.auth!.lc_username;

  const friendEntries = Object.entries(friend_sets ?? {});
  if (friendEntries.length > MAX_FRIENDS_PER_UPLOAD) {
    return res.status(400).json({ error: 'too_many_friends' });
  }
  for (const [u] of friendEntries) {
    if (!USERNAME_RE.test(u)) {
      return res.status(400).json({ error: 'invalid_friend_username', username: u });
    }
    if (u.toLowerCase() === me.toLowerCase()) {
      return res.status(400).json({ error: 'friend_collides_with_self' });
    }
  }

  const selfResult = await applyContribution(me, me, slugs, {
    isSelf: true,
    schemaVersion: schema_version,
    updatedAt: updated_at,
  });
  if (selfResult.result === 'leetcode_unreachable') return res.status(502).json({ error: 'leetcode_unreachable' });
  if (selfResult.result === 'user_not_found') return res.status(404).json({ error: 'user_not_found' });
  if (selfResult.result === 'count_exceeded') {
    return res.status(400).json({ error: 'slug_count_exceeds_public_solved' });
  }
  stmts.touchLastSync.run(Date.now(), me);

  const friendsAccepted: Record<string, number> = {};
  const friendsRejected: Record<string, string> = {};
  for (const [username, friendSlugs] of friendEntries) {
    const r = await applyContribution(username, me, friendSlugs, {
      isSelf: false,
      schemaVersion: schema_version,
      updatedAt: updated_at,
    });
    if (r.result === 'ok') friendsAccepted[username] = r.accepted;
    else friendsRejected[username] = r.result;
  }

  res.json({
    ok: true,
    accepted: selfResult.accepted,
    friends_accepted: friendsAccepted,
    friends_rejected: friendsRejected,
  });
});
