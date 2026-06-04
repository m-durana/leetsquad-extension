import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { stmts } from '../db';
import { requireAuth, AuthedRequest } from '../authMiddleware';

export const dailyGoalsRouter = Router();

const MAX_DAYS = 1000;
const MAX_BODY_BYTES = 128 * 1024;

const limitsDisabled = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMITS === '1';

const getLimiter = limitsDisabled
  ? (_req: AuthedRequest, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });

const putLimiter = limitsDisabled
  ? (_req: AuthedRequest, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });

const dayEntry = z.object({
  target: z.number().int().min(1).max(1000),
  completed: z.number().int().min(0).max(10000),
  problems: z.array(z.string()).max(10000)
});

const dateKey = /^\d{4}-\d{2}-\d{2}$/;

const putBody = z.object({
  goals: z.record(z.string(), dayEntry)
});

dailyGoalsRouter.get('/', getLimiter, requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.auth!.lc_username;
  const row = stmts.getDailyGoals.get(me) as { goals_json: string; updated_at: number } | undefined;
  if (!row) return res.json({ goals: {}, updated_at: 0 });
  let goals: unknown = {};
  try { goals = JSON.parse(row.goals_json); } catch {}
  res.json({ goals, updated_at: row.updated_at });
});

dailyGoalsRouter.put('/', putLimiter, requireAuth, (req: AuthedRequest, res: Response) => {
  const raw = JSON.stringify(req.body ?? {});
  if (raw.length > MAX_BODY_BYTES) return res.status(413).json({ error: 'too_large' });

  const parsed = putBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_body' });

  const days = Object.keys(parsed.data.goals);
  if (days.length > MAX_DAYS) return res.status(400).json({ error: 'too_many_days' });
  for (const k of days) {
    if (!dateKey.test(k)) return res.status(400).json({ error: 'bad_date_key' });
  }

  const me = req.auth!.lc_username;
  const now = Date.now();
  stmts.upsertDailyGoals.run(me, JSON.stringify(parsed.data.goals), now);
  res.json({ ok: true, updated_at: now });
});
