import { Request, Response, NextFunction } from 'express';
import { verifyToken, AuthClaims } from './jwt';

export interface AuthedRequest extends Request {
  auth?: AuthClaims;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const h = req.header('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'missing_token' });
  try {
    req.auth = verifyToken(m[1]);
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}
