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
  db.exec('DELETE FROM user_daily_goals; DELETE FROM users;');
});

afterAll(() => {
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

const sampleGoals = {
  '2026-06-01': { target: 3, completed: 2, problems: ['two-sum', 'add-two-numbers'] },
  '2026-06-02': { target: 3, completed: 3, problems: ['valid-parentheses', 'merge-two-sorted-lists', 'reverse-linked-list'] },
};

describe('GET /daily-goals', () => {
  it('401 without JWT', async () => {
    const r = await request(app).get('/daily-goals');
    expect(r.status).toBe(401);
  });

  it('returns empty for a new user', async () => {
    const r = await request(app).get('/daily-goals').set('Authorization', jwt('alice'));
    expect(r.status).toBe(200);
    expect(r.body.goals).toEqual({});
    expect(r.body.updated_at).toBe(0);
  });
});

describe('PUT /daily-goals', () => {
  it('401 without JWT', async () => {
    const r = await request(app).put('/daily-goals').send({ goals: {} });
    expect(r.status).toBe(401);
  });

  it('rejects missing goals field', async () => {
    const r = await request(app).put('/daily-goals').set('Authorization', jwt('alice')).send({ wrong: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_body');
  });

  it('rejects bad date keys', async () => {
    const r = await request(app)
      .put('/daily-goals')
      .set('Authorization', jwt('alice'))
      .send({ goals: { 'not-a-date': { target: 1, completed: 0, problems: [] } } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_date_key');
  });

  it('rejects malformed day entry shape', async () => {
    const r = await request(app)
      .put('/daily-goals')
      .set('Authorization', jwt('alice'))
      .send({ goals: { '2026-06-01': { target: 'three', completed: 0, problems: [] } } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_body');
  });

  it('rejects negative completed', async () => {
    const r = await request(app)
      .put('/daily-goals')
      .set('Authorization', jwt('alice'))
      .send({ goals: { '2026-06-01': { target: 3, completed: -1, problems: [] } } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_body');
  });

  it('rejects > 1000 days with too_many_days', async () => {
    const goals: Record<string, { target: number; completed: number; problems: string[] }> = {};
    for (let i = 0; i < 1001; i++) {
      const d = new Date(2024, 0, 1);
      d.setDate(d.getDate() + i);
      goals[d.toISOString().split('T')[0]] = { target: 1, completed: 1, problems: [] };
    }
    const r = await request(app).put('/daily-goals').set('Authorization', jwt('alice')).send({ goals });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('too_many_days');
  });

  it('round-trips through GET', async () => {
    const r = await request(app).put('/daily-goals').set('Authorization', jwt('alice')).send({ goals: sampleGoals });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.updated_at).toBe('number');

    const r2 = await request(app).get('/daily-goals').set('Authorization', jwt('alice'));
    expect(r2.status).toBe(200);
    expect(r2.body.goals).toEqual(sampleGoals);
    expect(r2.body.updated_at).toBeGreaterThan(0);
  });

  it('PUT replaces the whole map (not merged on server)', async () => {
    await request(app).put('/daily-goals').set('Authorization', jwt('alice')).send({ goals: sampleGoals });
    const next = { '2026-06-03': { target: 5, completed: 1, problems: ['palindrome-number'] } };
    await request(app).put('/daily-goals').set('Authorization', jwt('alice')).send({ goals: next });
    const r = await request(app).get('/daily-goals').set('Authorization', jwt('alice'));
    expect(r.body.goals).toEqual(next);
  });

  it('two users keep separate goal maps', async () => {
    await request(app).put('/daily-goals').set('Authorization', jwt('alice')).send({ goals: sampleGoals });
    const carolGoals = { '2026-05-15': { target: 1, completed: 1, problems: ['two-sum'] } };
    await request(app).put('/daily-goals').set('Authorization', jwt('carol')).send({ goals: carolGoals });

    const a = await request(app).get('/daily-goals').set('Authorization', jwt('alice'));
    const c = await request(app).get('/daily-goals').set('Authorization', jwt('carol'));
    expect(a.body.goals).toEqual(sampleGoals);
    expect(c.body.goals).toEqual(carolGoals);
  });

  it('accepts empty goals map', async () => {
    const r = await request(app).put('/daily-goals').set('Authorization', jwt('alice')).send({ goals: {} });
    expect(r.status).toBe(200);
    const r2 = await request(app).get('/daily-goals').set('Authorization', jwt('alice'));
    expect(r2.body.goals).toEqual({});
  });
});
