import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { db } from '../src/db';
import {
  generateKey,
  hashKey,
  issueKeyForUser,
  rotateKeyForUser,
  verifyApiKey,
  looksLikeApiKey,
  parseAuthBearer,
  touchKeyUsage,
  resetTouchDebounceForTests,
} from '../src/apiKeys';

beforeEach(() => {
  db.exec('DELETE FROM api_keys; DELETE FROM users;');
  resetTouchDebounceForTests();
});

afterAll(() => {
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

describe('generateKey + hashKey', () => {
  it('produces ls_pk_ prefixed plaintext, base32 body, and matching sha256', () => {
    const { plaintext, prefix, hash } = generateKey();
    expect(plaintext.startsWith('ls_pk_')).toBe(true);
    expect(/^ls_pk_[A-Z2-7]+$/.test(plaintext)).toBe(true);
    expect(prefix.startsWith('ls_pk_')).toBe(true);
    expect(prefix.length).toBe('ls_pk_'.length + 6);
    expect(hash).toBe(createHash('sha256').update(plaintext).digest('hex'));
  });

  it('generates distinct keys on each call', () => {
    const a = generateKey();
    const b = generateKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('issueKeyForUser', () => {
  it('inserts a new key on first call and returns the plaintext', () => {
    const r = issueKeyForUser('alice');
    expect(r.plaintext).toMatch(/^ls_pk_/);
    const row = db.prepare('SELECT * FROM api_keys WHERE lc_username = ?').get('alice') as any;
    expect(row).toBeDefined();
    expect(row.revoked_at).toBeNull();
    expect(row.prefix).toBe(r.prefix);
  });

  it('is idempotent: a second call returns the existing key (no new plaintext)', () => {
    const a = issueKeyForUser('bob');
    const b = issueKeyForUser('bob');
    expect(a.plaintext).toMatch(/^ls_pk_/);
    expect(b.plaintext).toBeNull();
    expect(b.prefix).toBe(a.prefix);
    const c = db.prepare('SELECT COUNT(*) AS c FROM api_keys WHERE lc_username = ?').get('bob') as { c: number };
    expect(c.c).toBe(1);
  });
});

describe('rotateKeyForUser', () => {
  it('revokes any live keys and issues a fresh plaintext', () => {
    const a = issueKeyForUser('carol');
    const b = rotateKeyForUser('carol');
    expect(b.plaintext).toMatch(/^ls_pk_/);
    expect(b.plaintext).not.toBe(a.plaintext);
    const liveCount = db
      .prepare('SELECT COUNT(*) AS c FROM api_keys WHERE lc_username = ? AND revoked_at IS NULL')
      .get('carol') as { c: number };
    expect(liveCount.c).toBe(1);
    const revokedCount = db
      .prepare('SELECT COUNT(*) AS c FROM api_keys WHERE lc_username = ? AND revoked_at IS NOT NULL')
      .get('carol') as { c: number };
    expect(revokedCount.c).toBe(1);
  });

  it('after rotate, the old plaintext fails verifyApiKey with reason=revoked', () => {
    const a = issueKeyForUser('dave');
    const aKey = a.plaintext!;
    rotateKeyForUser('dave');
    const v = verifyApiKey(aKey);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('revoked');
  });
});

describe('verifyApiKey', () => {
  it('accepts a valid key and returns the row', () => {
    const r = issueKeyForUser('eve');
    const v = verifyApiKey(r.plaintext!);
    expect(v.ok).toBe(true);
    expect(v.row?.lc_username).toBe('eve');
  });

  it('rejects malformed (no ls_pk_ prefix)', () => {
    const v = verifyApiKey('totally-not-a-key');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('malformed');
  });

  it('rejects an unknown key', () => {
    const v = verifyApiKey('ls_pk_DOESNOTEXIST');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('not_found');
  });

  it('rejects a revoked key', () => {
    const r = issueKeyForUser('frank');
    rotateKeyForUser('frank');
    const v = verifyApiKey(r.plaintext!);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('revoked');
  });
});

describe('parseAuthBearer + looksLikeApiKey', () => {
  it('parses Bearer header', () => {
    expect(parseAuthBearer('Bearer abc123')).toBe('abc123');
    expect(parseAuthBearer('bearer xyz')).toBe('xyz');
    expect(parseAuthBearer(undefined)).toBeNull();
    expect(parseAuthBearer('Basic foo')).toBeNull();
  });
  it('detects ls_pk_ prefix', () => {
    expect(looksLikeApiKey('ls_pk_anything')).toBe(true);
    expect(looksLikeApiKey('eyJ.jwt.token')).toBe(false);
  });
});

describe('touchKeyUsage (debounced)', () => {
  it('writes last_used_at and debounces within 60s', () => {
    const r = issueKeyForUser('grace');
    const v = verifyApiKey(r.plaintext!);
    expect(v.ok).toBe(true);

    touchKeyUsage(v.row!.key_hash);
    const first = (db
      .prepare('SELECT last_used_at FROM api_keys WHERE key_hash = ?')
      .get(v.row!.key_hash) as { last_used_at: number }).last_used_at;
    expect(first).toBeGreaterThan(0);

    // Second touch immediately: writes are debounced, value stays the same
    touchKeyUsage(v.row!.key_hash);
    const second = (db
      .prepare('SELECT last_used_at FROM api_keys WHERE key_hash = ?')
      .get(v.row!.key_hash) as { last_used_at: number }).last_used_at;
    expect(second).toBe(first);
  });
});

describe('hashKey is deterministic', () => {
  it('same plaintext produces same hash', () => {
    expect(hashKey('foo')).toBe(hashKey('foo'));
    expect(hashKey('foo')).not.toBe(hashKey('bar'));
  });
});
