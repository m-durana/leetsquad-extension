import { createHash, randomBytes } from 'node:crypto';
import { stmts } from './db';

const KEY_PREFIX = 'ls_pk_';
const KEY_BODY_BYTES = 24;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32NoPad(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

export function generateKey(): { plaintext: string; prefix: string; hash: string } {
  const body = base32NoPad(randomBytes(KEY_BODY_BYTES));
  const plaintext = KEY_PREFIX + body;
  const prefix = KEY_PREFIX + body.slice(0, 6);
  const hash = hashKey(plaintext);
  return { plaintext, prefix, hash };
}

export function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function parseAuthBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  return m[1];
}

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(KEY_PREFIX);
}

export interface ApiKeyRow {
  key_hash: string;
  prefix: string;
  lc_username: string;
  tier: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

// Idempotent so re-verifying doesn't churn keys; plaintext is null when a live key already exists.
export function issueKeyForUser(lc_username: string): { plaintext: string | null; prefix: string; tier: string } {
  const existing = stmts.getLiveKeyForUser.get(lc_username) as
    | { key_hash: string; prefix: string; tier: string; created_at: number }
    | undefined;
  if (existing) {
    return { plaintext: null, prefix: existing.prefix, tier: existing.tier };
  }
  const { plaintext, prefix, hash } = generateKey();
  stmts.insertApiKey.run(hash, prefix, lc_username, 'free', Date.now());
  return { plaintext, prefix, tier: 'free' };
}

export function rotateKeyForUser(lc_username: string): { plaintext: string; prefix: string; tier: string } {
  const now = Date.now();
  stmts.revokeKeysForUser.run(now, lc_username);
  const { plaintext, prefix, hash } = generateKey();
  stmts.insertApiKey.run(hash, prefix, lc_username, 'free', now);
  return { plaintext, prefix, tier: 'free' };
}

export interface VerifyKeyResult {
  ok: boolean;
  reason?: 'malformed' | 'not_found' | 'revoked';
  row?: ApiKeyRow;
}

export function verifyApiKey(plaintext: string): VerifyKeyResult {
  if (!looksLikeApiKey(plaintext)) return { ok: false, reason: 'malformed' };
  const hash = hashKey(plaintext);
  const row = stmts.getApiKeyByHash.get(hash) as ApiKeyRow | undefined;
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.revoked_at !== null) return { ok: false, reason: 'revoked' };
  return { ok: true, row };
}

// Debounce so hot keys don't write last_used_at on every request.
const TOUCH_DEBOUNCE_MS = 60_000;
const lastTouched = new Map<string, number>();

export function touchKeyUsage(keyHash: string): void {
  const now = Date.now();
  const prev = lastTouched.get(keyHash) ?? 0;
  if (now - prev < TOUCH_DEBOUNCE_MS) return;
  lastTouched.set(keyHash, now);
  stmts.touchApiKeyUsage.run(now, keyHash);
}

export function resetTouchDebounceForTests(): void {
  lastTouched.clear();
}
