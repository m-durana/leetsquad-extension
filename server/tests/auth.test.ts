import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { unlinkSync, existsSync } from 'node:fs';

vi.mock('../src/leetcode', () => ({
  getPublicAboutMe: vi.fn(),
}));

import { createApp } from '../src/app';
import { db } from '../src/db';
import { getPublicAboutMe } from '../src/leetcode';
import jwt from 'jsonwebtoken';

const mockedAboutMe = vi.mocked(getPublicAboutMe);
const app = createApp();

beforeEach(() => {
  db.exec('DELETE FROM auth_nonces; DELETE FROM users;');
  mockedAboutMe.mockReset();
});

afterAll(() => {
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

describe('POST /auth/start', () => {
  it('issues a nonce for a valid username', async () => {
    const r = await request(app).post('/auth/start').send({ lc_username: 'akutasan' });
    expect(r.status).toBe(200);
    expect(r.body.nonce).toMatch(/^leetsquad-verify-/);
    expect(r.body.expires_at).toBeGreaterThan(Date.now());
  });

  it('rejects bogus usernames', async () => {
    const r = await request(app).post('/auth/start').send({ lc_username: 'bad name!' });
    expect(r.status).toBe(400);
  });

  it('replaces prior nonces for the same user', async () => {
    const a = await request(app).post('/auth/start').send({ lc_username: 'alice' });
    const b = await request(app).post('/auth/start').send({ lc_username: 'alice' });
    expect(a.body.nonce).not.toBe(b.body.nonce);
    const rows = db
      .prepare('SELECT COUNT(*) as c FROM auth_nonces WHERE lc_username = ?')
      .get('alice') as { c: number };
    expect(rows.c).toBe(1);
  });
});

describe('POST /auth/verify', () => {
  it('issues a JWT when the bio contains the nonce', async () => {
    const start = await request(app).post('/auth/start').send({ lc_username: 'bob' });
    const nonce = start.body.nonce;

    mockedAboutMe.mockResolvedValueOnce(`hello world ${nonce} thanks`);

    const r = await request(app).post('/auth/verify').send({ lc_username: 'bob' });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();

    const claims = jwt.verify(r.body.token, process.env.JWT_SECRET!) as { lc_username: string };
    expect(claims.lc_username).toBe('bob');

    const user = db.prepare('SELECT * FROM users WHERE lc_username = ?').get('bob') as
      | { lc_username: string }
      | undefined;
    expect(user?.lc_username).toBe('bob');

    const noncesLeft = db
      .prepare('SELECT COUNT(*) as c FROM auth_nonces WHERE lc_username = ?')
      .get('bob') as { c: number };
    expect(noncesLeft.c).toBe(0);
  });

  it('rejects when bio does not contain the nonce', async () => {
    await request(app).post('/auth/start').send({ lc_username: 'carol' });
    mockedAboutMe.mockResolvedValueOnce('nothing relevant here');
    const r = await request(app).post('/auth/verify').send({ lc_username: 'carol' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('nonce_not_found_in_bio');
  });

  it('returns 403 when no active nonce exists', async () => {
    const r = await request(app).post('/auth/verify').send({ lc_username: 'nobody' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('no_active_nonce');
  });

  it('returns 404 when LeetCode reports user not found', async () => {
    await request(app).post('/auth/start').send({ lc_username: 'ghost' });
    mockedAboutMe.mockResolvedValueOnce(null);
    const r = await request(app).post('/auth/verify').send({ lc_username: 'ghost' });
    expect(r.status).toBe(404);
  });

  it('returns 502 when LeetCode call throws', async () => {
    await request(app).post('/auth/start').send({ lc_username: 'dave' });
    mockedAboutMe.mockRejectedValueOnce(new Error('boom'));
    const r = await request(app).post('/auth/verify').send({ lc_username: 'dave' });
    expect(r.status).toBe(502);
  });
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });
});
