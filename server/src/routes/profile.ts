import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, stmts } from '../db';
import { requireAuth, AuthedRequest } from '../authMiddleware';
import { isValidUsername, canonicalUsername } from '../validation';
import { computeStreak, utcToday } from '../streak';

export const profileRouter = Router();

const MAX_LOOKUP = 500;
const limitsDisabled = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMITS === '1';
const passthrough = (_req: AuthedRequest, _res: Response, next: () => void) => next();

const getLimiter = limitsDisabled
  ? passthrough
  : rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const postLimiter = limitsDisabled
  ? passthrough
  : rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const putLimiter = limitsDisabled
  ? passthrough
  : rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });

profileRouter.get('/me', getLimiter, requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.auth!.lc_username;
  const row = stmts.getShareProfile.get(me) as { share_profile: number } | undefined;
  res.json({ share_profile: row ? row.share_profile === 1 : true });
});

const putBody = z.object({ share_profile: z.boolean() });

profileRouter.put('/me', putLimiter, requireAuth, (req: AuthedRequest, res: Response) => {
  const parsed = putBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_body' });
  const me = req.auth!.lc_username;
  stmts.setShareProfile.run(parsed.data.share_profile ? 1 : 0, me);
  res.json({ ok: true, share_profile: parsed.data.share_profile });
});

// Which of the given handles are LeetSquad members that opted in, plus their current streak.
const lookupBody = z.object({ usernames: z.array(z.string()).max(MAX_LOOKUP * 4) });

profileRouter.post('/presence', postLimiter, requireAuth, (req: AuthedRequest, res: Response) => {
  const parsed = lookupBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_body' });

  const names = Array.from(new Set(
    parsed.data.usernames.filter(isValidUsername).map(canonicalUsername)
  )).slice(0, MAX_LOOKUP);
  if (names.length === 0) return res.json({ presence: {} });

  const placeholders = names.map(() => '?').join(',');
  const members = db.prepare(
    `SELECT lc_username FROM users WHERE share_profile = 1 AND lc_username IN (${placeholders})`
  ).all(...names) as Array<{ lc_username: string }>;
  if (members.length === 0) return res.json({ presence: {} });

  const memberNames = members.map((m) => m.lc_username);
  const gph = memberNames.map(() => '?').join(',');
  const goalRows = db.prepare(
    `SELECT lc_username, goals_json FROM user_daily_goals WHERE lc_username IN (${gph})`
  ).all(...memberNames) as Array<{ lc_username: string; goals_json: string }>;

  const goalsByUser = new Map<string, Record<string, { completed?: number }>>();
  for (const r of goalRows) {
    try { goalsByUser.set(r.lc_username, JSON.parse(r.goals_json)); } catch {}
  }

  const today = utcToday();
  const presence: Record<string, { member: boolean; streak: number }> = {};
  for (const name of memberNames) {
    presence[name] = { member: true, streak: computeStreak(goalsByUser.get(name) || {}, today) };
  }
  res.json({ presence });
});
