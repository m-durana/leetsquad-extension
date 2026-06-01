import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from './config';

export interface AuthClaims {
  lc_username: string;
}

export function signToken(claims: AuthClaims): { token: string; expiresAt: number } {
  const token = jwt.sign(claims, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  } as SignOptions);
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const expiresAt = (decoded?.exp ?? 0) * 1000;
  return { token, expiresAt };
}

export function verifyToken(token: string): AuthClaims {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as AuthClaims;
}
