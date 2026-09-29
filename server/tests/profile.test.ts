import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { unlinkSync, existsSync } from 'node:fs';
import { createApp } from '../src/app';
import { db } from '../src/db';
import { signToken } from '../src/jwt';
import { computeStreak } from '../src/streak';

const app = createApp();

function jwt(username: string) {
  return `Bearer ${signToken({ lc_username: username }).token}`;
}

function addUser(username: string, share = 1) {
  db.prepare(
    'INSERT INTO users (lc_username, verified_at, last_sync_at, share_profile) VALUES (?, ?, 0, ?)'
  ).run(username, Date.now(), share);
}

function addGoals(username: string, goals: Record<string, unknown>) {
  db.prepare(
    'INSERT INTO user_daily_goals (lc_username, goals_json, updated_at) VALUES (?, ?, ?)'
  ).run(username, JSON.stringify(goals), Date.now());
}

function dayKey(offsetDays: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().split('T')[0];
}

beforeEach(() => {
  db.exec('DELETE FROM user_daily_goals; DELETE FROM users;');
});

afterAll(() => {
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

describe('computeStreak', () => {
  it('is 0 with no goals', () => {
    expect(computeStreak({}, dayKey(0))).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    const goals = {
      [dayKey(0)]: { completed: 1 },
      [dayKey(1)]: { completed: 2 },
      [dayKey(2)]: { completed: 1 },
    };
    expect(computeStreak(goals, dayKey(0))).toBe(3);
  });

  it('breaks on a gap', () => {
    const goals = {
      [dayKey(0)]: { completed: 1 },
      [dayKey(2)]: { completed: 1 },
    };
    expect(computeStreak(goals, dayKey(0))).toBe(1);
  });

  it('is 0 when today has no completions', () => {
    const goals = { [dayKey(1)]: { completed: 1 } };
    expect(computeStreak(goals, dayKey(0))).toBe(0);
  });
});

describe('GET /profile/me', () => {
  it('401 without JWT', async () => {
    const r = await request(app).get('/profile/me');
    expect(r.status).toBe(401);
  });

  it('defaults to true for a user with no row', async () => {
    const r = await request(app).get('/profile/me').set('Authorization', jwt('alice'));
    expect(r.status).toBe(200);
    expect(r.body.share_profile).toBe(true);
  });

  it('reflects a stored opt-out', async () => {
    addUser('alice', 0);
    const r = await request(app).get('/profile/me').set('Authorization', jwt('alice'));
    expect(r.body.share_profile).toBe(false);
  });
});

describe('PUT /profile/me', () => {
  it('401 without JWT', async () => {
    const r = await request(app).put('/profile/me').send({ share_profile: false });
    expect(r.status).toBe(401);
  });

  it('rejects a bad body', async () => {
    addUser('alice');
    const r = await request(app).put('/profile/me').set('Authorization', jwt('alice')).send({ share_profile: 'no' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_body');
  });

  it('updates the flag and GET reflects it', async () => {
    addUser('alice');
    const put = await request(app).put('/profile/me').set('Authorization', jwt('alice')).send({ share_profile: false });
    expect(put.status).toBe(200);
    expect(put.body.share_profile).toBe(false);
    const get = await request(app).get('/profile/me').set('Authorization', jwt('alice'));
    expect(get.body.share_profile).toBe(false);
  });
});

describe('POST /profile/presence', () => {
  it('401 without JWT', async () => {
    const r = await request(app).post('/profile/presence').send({ usernames: ['bob'] });
    expect(r.status).toBe(401);
  });

  it('returns only opted-in members, with streaks', async () => {
    addUser('bob', 1);
    addGoals('bob', { [dayKey(0)]: { completed: 1 }, [dayKey(1)]: { completed: 1 } });
    addUser('carol', 0); // opted out
    // 'dave' is not a member at all

    const r = await request(app)
      .post('/profile/presence')
      .set('Authorization', jwt('alice'))
      .send({ usernames: ['bob', 'carol', 'dave'] });

    expect(r.status).toBe(200);
    expect(r.body.presence.bob).toEqual({ member: true, streak: 2 });
    expect(r.body.presence.carol).toBeUndefined();
    expect(r.body.presence.dave).toBeUndefined();
  });

  it('matches case-insensitively (canonical lowercase keys)', async () => {
    addUser('bob', 1);
    const r = await request(app)
      .post('/profile/presence')
      .set('Authorization', jwt('alice'))
      .send({ usernames: ['BoB'] });
    expect(r.body.presence.bob).toEqual({ member: true, streak: 0 });
  });

  it('returns empty presence for an empty list', async () => {
    const r = await request(app)
      .post('/profile/presence')
      .set('Authorization', jwt('alice'))
      .send({ usernames: [] });
    expect(r.status).toBe(200);
    expect(r.body.presence).toEqual({});
  });
});
