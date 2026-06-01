import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { unlinkSync, existsSync } from 'node:fs';
import { createApp } from '../src/app';
import { db } from '../src/db';
import { signToken } from '../src/jwt';

const app = createApp();

function jwt(username: string) {
  return `Bearer ${signToken({ lc_username: username }).token}`;
}

beforeEach(() => {
  db.exec('DELETE FROM user_friends; DELETE FROM users;');
});

afterAll(() => {
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

describe('GET /friends', () => {
  it('401 without JWT', async () => {
    const r = await request(app).get('/friends');
    expect(r.status).toBe(401);
  });

  it('returns empty list for a new user', async () => {
    const r = await request(app).get('/friends').set('Authorization', jwt('alice'));
    expect(r.status).toBe(200);
    expect(r.body.friends).toEqual([]);
    expect(r.body.updated_at).toBe(0);
  });
});

describe('PUT /friends', () => {
  it('401 without JWT', async () => {
    const r = await request(app).put('/friends').send({ friends: [] });
    expect(r.status).toBe(401);
  });

  it('rejects bad body', async () => {
    const r = await request(app).put('/friends').set('Authorization', jwt('alice')).send({ wrong: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_body');
  });

  it('stores a deduped, alphabetised list and round-trips via GET', async () => {
    const r = await request(app)
      .put('/friends')
      .set('Authorization', jwt('alice'))
      .send({ friends: ['bob', 'carol', 'bob'] });
    expect(r.status).toBe(200);
    expect(r.body.friends.sort()).toEqual(['bob', 'carol']);

    const r2 = await request(app).get('/friends').set('Authorization', jwt('alice'));
    expect(r2.body.friends).toEqual(['bob', 'carol']);
    expect(r2.body.updated_at).toBeGreaterThan(0);
  });

  it('PUT replaces the whole list (not additive)', async () => {
    await request(app).put('/friends').set('Authorization', jwt('alice')).send({ friends: ['bob'] });
    await request(app).put('/friends').set('Authorization', jwt('alice')).send({ friends: ['carol'] });
    const r = await request(app).get('/friends').set('Authorization', jwt('alice'));
    expect(r.body.friends).toEqual(['carol']);
  });

  it('strips bad usernames silently', async () => {
    const r = await request(app)
      .put('/friends')
      .set('Authorization', jwt('alice'))
      .send({ friends: ['bob', 'bad name!', '../etc', 'ok-user_42'] });
    expect(r.body.friends.sort()).toEqual(['bob', 'ok-user_42']);
  });

  it('strips self from the list', async () => {
    const r = await request(app)
      .put('/friends')
      .set('Authorization', jwt('alice'))
      .send({ friends: ['alice', 'bob', 'ALICE'] });
    expect(r.body.friends).toEqual(['bob']);
  });

  it('rejects > 500 friends with too_many_friends', async () => {
    const lots = Array.from({ length: 501 }, (_, i) => `u${i}`);
    const r = await request(app).put('/friends').set('Authorization', jwt('alice')).send({ friends: lots });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('too_many_friends');
  });

  it('two users keep separate lists', async () => {
    await request(app).put('/friends').set('Authorization', jwt('alice')).send({ friends: ['bob'] });
    await request(app).put('/friends').set('Authorization', jwt('carol')).send({ friends: ['dave'] });
    const a = await request(app).get('/friends').set('Authorization', jwt('alice'));
    const c = await request(app).get('/friends').set('Authorization', jwt('carol'));
    expect(a.body.friends).toEqual(['bob']);
    expect(c.body.friends).toEqual(['dave']);
  });
});
