import { randomBytes } from 'node:crypto';

export function generateNonce(): string {
  return 'leetsquad-verify-' + randomBytes(9).toString('base64url');
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{1,30}$/;

export function isValidUsername(u: unknown): u is string {
  return typeof u === 'string' && USERNAME_RE.test(u);
}
