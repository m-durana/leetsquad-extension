import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { unlinkSync, existsSync } from 'node:fs';

vi.mock('../src/leetcode', async () => {
  const actual = await vi.importActual<typeof import('../src/leetcode')>('../src/leetcode');
  return {
    ...actual,
    getPublicSkillTags: vi.fn(),
    getPublicSolvedCount: vi.fn(),
    fetchProblemCatalog: vi.fn(),
  };
});

import { createApp } from '../src/app';
import { db, stmts } from '../src/db';
import { fetchProblemCatalog } from '../src/leetcode';
import { refreshProblemCatalogNow } from '../src/catalogRefresher';

const mockedFetch = vi.mocked(fetchProblemCatalog);
const app = createApp();

beforeEach(() => {
  db.exec('DELETE FROM problem_catalog;');
  mockedFetch.mockReset();
});

afterAll(() => {
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

describe('catalog refresher', () => {
  it('persists fetched problems into problem_catalog as a JSON map', async () => {
    mockedFetch.mockResolvedValueOnce([
      { slug: 'two-sum', title: 'Two Sum', id: 1, difficulty: 'Easy', paid: false, acRate: 55.2 },
      { slug: 'add-two-numbers', title: 'Add Two Numbers', id: 2, difficulty: 'Medium', paid: false, acRate: 44.1 },
    ]);
    const r = await refreshProblemCatalogNow();
    expect(r).toEqual({ ok: true, count: 2 });

    const row = stmts.getProblemCatalog.get() as { catalog_json: string; total_count: number };
    expect(row.total_count).toBe(2);
    const parsed = JSON.parse(row.catalog_json);
    expect(parsed['two-sum']).toEqual({ title: 'Two Sum', id: 1, difficulty: 'Easy', paid: false, acRate: 55.2 });
    expect(parsed['add-two-numbers'].difficulty).toBe('Medium');
  });

  it('refuses to persist an empty payload', async () => {
    mockedFetch.mockResolvedValueOnce([]);
    const r = await refreshProblemCatalogNow();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('empty_payload');
    const row = stmts.getProblemCatalog.get();
    expect(row).toBeUndefined();
  });

  it('reports failure when LC fetch throws', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('LeetCode catalog HTTP 503'));
    const r = await refreshProblemCatalogNow();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTP 503/);
  });
});

describe('GET /api/v1/catalog', () => {
  it('returns 503 when catalog has never been refreshed', async () => {
    const r = await request(app).get('/api/v1/catalog');
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('not_ready');
  });

  it('serves the persisted catalog with updated_at and problem map', async () => {
    mockedFetch.mockResolvedValueOnce([
      { slug: 'two-sum', title: 'Two Sum', id: 1, difficulty: 'Easy', paid: false, acRate: 55.2 },
    ]);
    await refreshProblemCatalogNow();

    const r = await request(app).get('/api/v1/catalog');
    expect(r.status).toBe(200);
    expect(r.body.total_count).toBe(1);
    expect(typeof r.body.updated_at).toBe('number');
    expect(r.body.problems['two-sum']).toEqual({ title: 'Two Sum', id: 1, difficulty: 'Easy', paid: false, acRate: 55.2 });
    expect(r.headers['cache-control']).toMatch(/max-age=3600/);
  });
});
