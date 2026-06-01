import { stmts } from './db';
import { getPublicSolvedCount } from './leetcode';

const TTL_MS = 24 * 60 * 60 * 1000;

// Collapse concurrent fetches for the same username into one in-flight LeetCode call.
const inflight = new Map<string, Promise<number | null>>();

export async function getCachedPublicSolvedCount(username: string): Promise<number | null> {
  const row = stmts.getCachedSolvedCount.get(username) as
    | { count: number; fetched_at: number }
    | undefined;
  if (row && Date.now() - row.fetched_at < TTL_MS) return row.count;

  if (inflight.has(username)) return inflight.get(username)!;

  const p = (async () => {
    try {
      const count = await getPublicSolvedCount(username);
      if (count !== null) stmts.upsertCachedSolvedCount.run(username, count, Date.now());
      return count;
    } finally {
      inflight.delete(username);
    }
  })();
  inflight.set(username, p);
  return p;
}
