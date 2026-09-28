import { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit, { Options } from 'express-rate-limit';
import { ApiKeyedRequest } from './apiKeyMiddleware';
import { ApiError } from './errorEnvelope';
import { verifyToken } from './jwt';

const disabled = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMITS === '1';

function noopLimiter(_req: Request, _res: Response, next: NextFunction): void {
  next();
}

export interface TierLimits {
  anonPerWindow: number;       // requests per anon window
  anonWindowMs: number;        // window length for anon
  keyedPerWindow: number;      // requests per keyed window
  keyedWindowMs: number;       // window length for keyed
}

// Picks an anon-IP bucket or a keyed bucket based on whether the request carries a verified key.
export function tieredLimiter(limits: TierLimits): RequestHandler {
  if (disabled) return noopLimiter;

  const baseAnon: Partial<Options> = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    windowMs: limits.anonWindowMs,
    limit: limits.anonPerWindow,
    keyGenerator: (req) => `anon:${req.ip}`,
    handler: (_req, _res, next) => next(new ApiError('too_many_requests', 'rate limit exceeded')),
  };

  const baseKeyed: Partial<Options> = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    windowMs: limits.keyedWindowMs,
    limit: limits.keyedPerWindow,
    keyGenerator: (req: ApiKeyedRequest) => `key:${req.apiKey?.keyHash ?? 'anon'}`,
    handler: (_req, _res, next) => next(new ApiError('too_many_requests', 'rate limit exceeded')),
  };

  const anonLimiter = rateLimit(baseAnon);
  const keyedLimiter = rateLimit(baseKeyed);

  return (req: ApiKeyedRequest, res: Response, next: NextFunction) => {
    if (req.apiKey) return keyedLimiter(req, res, next);
    // anonPerWindow=0 means key-required; let requireApiKey reject downstream, not a misleading 429.
    if (limits.anonPerWindow === 0) return next();
    anonLimiter(req, res, next);
  };
}

// Simple per-IP limiter for endpoints that never use a key (e.g. /key, /key/rotate).
export function fixedLimiter(opts: {
  perWindow: number;
  windowMs: number;
  bucket: string;
  by?: 'ip' | 'jwt';
}): RequestHandler {
  if (disabled) return noopLimiter;
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.perWindow,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      if (opts.by === 'jwt') {
        // Key on the verified subject (IP fallback) so bearer rotation can't reset the bucket.
        const m = /^Bearer (.+)$/.exec(req.header('authorization') || '');
        if (m) {
          try {
            return `${opts.bucket}:jwt:${verifyToken(m[1]).lc_username}`;
          } catch {
            /* fall through to IP */
          }
        }
        return `${opts.bucket}:ip:${req.ip}`;
      }
      return `${opts.bucket}:ip:${req.ip}`;
    },
    handler: (_req, _res, next) => next(new ApiError('too_many_requests', 'rate limit exceeded')),
  });
}
