import { Router, Response, NextFunction } from 'express';
import { requireAuth, AuthedRequest } from '../../authMiddleware';
import { stmts } from '../../db';
import { rotateKeyForUser } from '../../apiKeys';
import { fixedLimiter } from '../../v1RateLimits';
import { ApiError } from '../../errorEnvelope';

export const v1KeyRouter = Router();

const getLimiter = fixedLimiter({ perWindow: 12, windowMs: 60 * 60_000, bucket: 'v1key_get', by: 'jwt' });
const rotateLimiter = fixedLimiter({ perWindow: 6, windowMs: 24 * 60 * 60_000, bucket: 'v1key_rotate', by: 'jwt' });

v1KeyRouter.get('/', getLimiter, requireAuth, (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const username = req.auth!.lc_username;
    const row = stmts.getLiveKeyForUser.get(username) as
      | { prefix: string; tier: string; created_at: number }
      | undefined;
    if (!row) throw new ApiError('not_found', 'no live API key for this user');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ prefix: row.prefix, tier: row.tier, created_at: row.created_at });
  } catch (e) {
    next(e);
  }
});

// Plaintext is only returned here and at /auth/verify; nothing stores it.
v1KeyRouter.post('/rotate', rotateLimiter, requireAuth, (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.body && JSON.stringify(req.body).length > 1024) {
      throw new ApiError('bad_body', 'body too large');
    }
    const username = req.auth!.lc_username;
    const issued = rotateKeyForUser(username);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ api_key: issued.plaintext, prefix: issued.prefix, tier: issued.tier });
  } catch (e) {
    next(e);
  }
});
