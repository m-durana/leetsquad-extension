import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, stmts } from '../db';
import { requireAuth, AuthedRequest } from '../authMiddleware';
import { isValidUsername, canonicalUsername } from '../validation';

export const friendsRouter = Router();

const MAX_FRIENDS = 500;

const limitsDisabled = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMITS === '1';

const getLimiter = limitsDisabled
  ? (_req: AuthedRequest, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });

const putLimiter = limitsDisabled
  ? (_req: AuthedRequest, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });

friendsRouter.get('/', getLimiter, requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.auth!.lc_username;
  const rows = stmts.getFriendsForUser.all(me) as Array<{
    friend_username: string;
    added_at: number;
  }>;
  const updatedAt = rows.reduce((m, r) => Math.max(m, r.added_at), 0);
  res.json({
    friends: rows.map((r) => r.friend_username),
    updated_at: updatedAt,
  });
});

// Cap higher than MAX_FRIENDS so the too_many_friends branch fires with a precise error.
const putBody = z.object({
  friends: z.array(z.string()).max(MAX_FRIENDS * 4),
});

friendsRouter.put('/', putLimiter, requireAuth, (req: AuthedRequest, res: Response) => {
  const parsed = putBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_body' });
  const me = req.auth!.lc_username;

  const incoming = parsed.data.friends
    .filter((u) => isValidUsername(u))
    .map(canonicalUsername)
    .filter((u) => u !== me);
  const deduped = Array.from(new Set(incoming));
  if (deduped.length > MAX_FRIENDS) {
    return res.status(400).json({ error: 'too_many_friends' });
  }

  const now = Date.now();
  const tx = db.transaction(() => {
    stmts.deleteFriendsForUser.run(me);
    for (const u of deduped) {
      stmts.insertFriend.run(me, u, now);
    }
  });
  tx();

  res.json({ friends: deduped, updated_at: now });
});
