import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  stmts,
  db,
  parseSlugsJson,
  serializeSlugMap,
  mergeSlugRecord,
  unionSlugMaps,
  SlugMap,
  SlugRecord,
} from '../db';
import { requireAuth, AuthedRequest } from '../authMiddleware';
import { getCachedPublicSolvedCount } from '../publicCount';
import { canonicalUsername } from '../validation';

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

// Accepts three upload shapes:
//   string[]                                  (legacy v1: slug-only)
//   Record<slug, number>                      (interim: slug -> ts)
//   Record<slug, { ts?, id?, lang?, rt?, mem? }> (v2 rich)
const slugRecordSchema = z.object({
  ts: z.number().int().nonnegative().optional(),
  id: z.string().max(64).optional(),
  lang: z.string().max(32).optional(),
  rt: z.string().max(32).optional(),
  mem: z.string().max(32).optional(),
});
const slugPayload = z.union([
  z.array(z.string()),
  z.record(z.union([z.number(), slugRecordSchema])),
]);

const syncBody = z.object({
  slugs: slugPayload,
  friend_sets: z.record(slugPayload).optional(),
  updated_at: z.number().int().positive(),
  schema_version: z.number().int().positive(),
});

type IncomingSlugs = z.infer<typeof slugPayload>;

function normalizeIncoming(input: IncomingSlugs): SlugMap {
  const out: SlugMap = {};
  if (Array.isArray(input)) {
    for (const s of input) {
      if (typeof s === 'string' && SLUG_RE.test(s)) out[s] = {};
    }
    return out;
  }
  for (const [slug, val] of Object.entries(input)) {
    if (!SLUG_RE.test(slug)) continue;
    if (typeof val === 'number') {
      out[slug] = Number.isFinite(val) && val >= 0 ? { ts: Math.floor(val) } : {};
      continue;
    }
    const rec: SlugRecord = {};
    if (typeof val.ts === 'number' && val.ts >= 0) rec.ts = Math.floor(val.ts);
    if (val.id) rec.id = val.id;
    if (val.lang) rec.lang = val.lang;
    if (val.rt) rec.rt = val.rt;
    if (val.mem) rec.mem = val.mem;
    out[slug] = rec;
  }
  return out;
}

function mapSize(m: SlugMap): number {
  return Object.keys(m).length;
}

type ApplyResult = 'ok' | 'count_exceeded' | 'leetcode_unreachable' | 'user_not_found' | 'too_many_slugs';

// Public-count guard fires against the recomputed union, not the contribution, so collusion can't inflate a target.
async function applyContribution(
  target: string,
  contributor: string,
  incoming: IncomingSlugs,
  options: { isSelf: boolean; schemaVersion: number; updatedAt: number }
): Promise<{ accepted: number; result: ApplyResult; contributorsCount?: number }> {
  const incomingMap = normalizeIncoming(incoming);
  if (mapSize(incomingMap) > MAX_SLUGS_PER_USER) {
    return { accepted: 0, result: 'too_many_slugs' };
  }

  const prevRow = stmts.getContribution.get(target, contributor) as { slugs_json: string } | undefined;
  const prevContrib = parseSlugsJson(prevRow?.slugs_json);
  const mergedContrib: SlugMap = { ...prevContrib };
  for (const [slug, rec] of Object.entries(incomingMap)) {
    mergedContrib[slug] = mergeSlugRecord(mergedContrib[slug] || {}, rec);
  }

  const otherRows = stmts.getContributionsForTarget.all(target) as Array<{
    contributor_username: string;
    slugs_json: string;
    updated_at: number;
  }>;
  // Order union iteration so newer contributions overwrite older ones for
  // id/lang/rt/mem. This contributor's just-updated map is treated as newest.
  const otherSorted = otherRows
    .filter((row) => row.contributor_username !== contributor)
    .sort((a, b) => a.updated_at - b.updated_at)
    .map((row) => parseSlugsJson(row.slugs_json));
  const proposedUnion = unionSlugMaps([...otherSorted, mergedContrib]);

  let publicCount: number | null;
  try {
    publicCount = await getCachedPublicSolvedCount(target);
  } catch {
    return { accepted: 0, result: 'leetcode_unreachable' };
  }
  if (publicCount === null) return { accepted: 0, result: 'user_not_found' };
  if (mapSize(proposedUnion) > publicCount + SLUG_COUNT_GRACE) {
    return { accepted: 0, result: 'count_exceeded' };
  }

  const contribJson = serializeSlugMap(mergedContrib);
  const unionJson = serializeSlugMap(proposedUnion);

  const tx = db.transaction(() => {
    stmts.upsertContribution.run(target, contributor, contribJson, options.updatedAt);
    if (options.isSelf) {
      stmts.upsertSelfSolvedSet.run(
        target,
        unionJson,
        options.schemaVersion,
        options.updatedAt,
        Date.now()
      );
    } else {
      stmts.upsertCrowdsourcedSet.run(
        target,
        unionJson,
        options.schemaVersion,
        options.updatedAt
      );
    }
  });
  tx();

  const cc = stmts.countContributorsForTarget.get(target) as { c: number };
  return { accepted: mapSize(mergedContrib), result: 'ok', contributorsCount: cc.c };
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
    if (canonicalUsername(u) === me) {
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
  if (selfResult.result === 'too_many_slugs') return res.status(400).json({ error: 'too_many_slugs' });
  stmts.touchLastSync.run(Date.now(), me);

  const friendsAccepted: Record<string, number> = {};
  const friendsRejected: Record<string, string> = {};
  for (const [username, friendSlugs] of friendEntries) {
    const target = canonicalUsername(username);
    const r = await applyContribution(target, me, friendSlugs, {
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
