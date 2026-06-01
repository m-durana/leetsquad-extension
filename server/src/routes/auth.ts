import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { stmts, sweepExpiredNonces } from '../db';
import { generateNonce, isValidUsername } from '../nonce';
import { getPublicAboutMe } from '../leetcode';
import { signToken } from '../jwt';
import { config } from '../config';

export const authRouter = Router();

const limitsDisabled = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMITS === '1';

const startLimiter = limitsDisabled
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });

const verifyLimiter = limitsDisabled
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });

const usernameBody = z.object({ lc_username: z.string() });

authRouter.post('/start', startLimiter, (req: Request, res: Response) => {
  const parsed = usernameBody.safeParse(req.body);
  if (!parsed.success || !isValidUsername(parsed.data.lc_username)) {
    return res.status(400).json({ error: 'invalid_username' });
  }
  const username = parsed.data.lc_username;

  sweepExpiredNonces();
  stmts.deleteNoncesForUser.run(username);

  const nonce = generateNonce();
  const expiresAt = Date.now() + config.nonceTtlSeconds * 1000;
  stmts.insertNonce.run(username, nonce, expiresAt);

  res.json({ nonce, expires_at: expiresAt });
});

authRouter.post('/verify', verifyLimiter, async (req: Request, res: Response) => {
  const parsed = usernameBody.safeParse(req.body);
  if (!parsed.success || !isValidUsername(parsed.data.lc_username)) {
    return res.status(400).json({ error: 'invalid_username' });
  }
  const username = parsed.data.lc_username;

  const row = stmts.findActiveNonce.get(username, Date.now()) as
    | { nonce: string; expires_at: number }
    | undefined;
  if (!row) return res.status(403).json({ error: 'no_active_nonce' });

  let aboutMe: string | null;
  try {
    aboutMe = await getPublicAboutMe(username);
  } catch (e) {
    return res.status(502).json({ error: 'leetcode_unreachable' });
  }
  if (aboutMe === null) return res.status(404).json({ error: 'user_not_found' });
  if (!aboutMe.includes(row.nonce)) {
    return res.status(403).json({ error: 'nonce_not_found_in_bio' });
  }

  stmts.upsertUser.run(username, Date.now());
  stmts.deleteNoncesForUser.run(username);

  const { token, expiresAt } = signToken({ lc_username: username });
  res.json({ token, expires_at: expiresAt });
});
