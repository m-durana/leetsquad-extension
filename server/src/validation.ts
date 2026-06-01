export const USERNAME_RE = /^[a-zA-Z0-9_-]{1,30}$/;
export const SLUG_RE = /^[a-z0-9-]{1,80}$/;

export function isValidUsername(u: unknown): u is string {
  return typeof u === 'string' && USERNAME_RE.test(u);
}

export function isValidSlug(s: unknown): s is string {
  return typeof s === 'string' && SLUG_RE.test(s);
}

export function clampLimit(value: unknown, defaultValue = 50, max = 200): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return defaultValue;
  return Math.min(n, max);
}

export function parseSince(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function encodeCursor(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T = unknown>(value: unknown): T | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
