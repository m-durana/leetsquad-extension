import { Request, Response, NextFunction } from 'express';
import { parseAuthBearer, looksLikeApiKey, verifyApiKey, touchKeyUsage, ApiKeyRow } from './apiKeys';
import { ApiError } from './errorEnvelope';

export interface ApiKeyContext {
  keyHash: string;
  prefix: string;
  lc_username: string;
  tier: string;
}

export interface ApiKeyedRequest extends Request {
  apiKey?: ApiKeyContext;
}

function attach(req: ApiKeyedRequest, row: ApiKeyRow): void {
  req.apiKey = {
    keyHash: row.key_hash,
    prefix: row.prefix,
    lc_username: row.lc_username,
    tier: row.tier,
  };
  touchKeyUsage(row.key_hash);
}

export function optionalApiKey(req: ApiKeyedRequest, _res: Response, next: NextFunction): void {
  const token = parseAuthBearer(req.header('authorization'));
  if (!token || !looksLikeApiKey(token)) return next();
  const result = verifyApiKey(token);
  if (result.ok && result.row) attach(req, result.row);
  next();
}

export function requireApiKey(req: ApiKeyedRequest, _res: Response, next: NextFunction): void {
  const token = parseAuthBearer(req.header('authorization'));
  if (!token) return next(new ApiError('missing_key', 'API key required'));
  if (!looksLikeApiKey(token)) return next(new ApiError('invalid_key', 'malformed API key'));
  const result = verifyApiKey(token);
  if (!result.ok) {
    if (result.reason === 'revoked') return next(new ApiError('revoked_key', 'API key has been revoked'));
    return next(new ApiError('invalid_key', 'unknown API key'));
  }
  attach(req, result.row!);
  next();
}
