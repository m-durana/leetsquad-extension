import { db } from './db';

export interface StatsPayload {
  users_total: number;
  solves_total: number;
  top_slugs: Array<{ slug: string; count: number }>;
  generated_at: number;
}

let cached: StatsPayload | null = null;
let intervalHandle: NodeJS.Timeout | null = null;

const RECOMPUTE_INTERVAL_MS = 10 * 60_000;
const TOP_SLUGS = 20;

export function computeStatsNow(): StatsPayload {
  const rows = db
    .prepare('SELECT slugs_json FROM solved_sets')
    .all() as Array<{ slugs_json: string }>;

  let solves_total = 0;
  const counts = new Map<string, number>();
  for (const row of rows) {
    try {
      const slugs = JSON.parse(row.slugs_json) as string[];
      solves_total += slugs.length;
      for (const slug of slugs) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    } catch {}
  }

  const top_slugs = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_SLUGS)
    .map(([slug, count]) => ({ slug, count }));

  const payload: StatsPayload = {
    users_total: rows.length,
    solves_total,
    top_slugs,
    generated_at: Date.now(),
  };
  cached = payload;
  return payload;
}

export function getStatsPayload(): StatsPayload {
  if (cached) return cached;
  return computeStatsNow();
}

export function startStatsAggregator(): void {
  computeStatsNow();
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => {
    try {
      computeStatsNow();
    } catch (e) {
      console.error('stats recompute failed:', (e as Error).message);
    }
  }, RECOMPUTE_INTERVAL_MS);
  intervalHandle.unref();
}

export function stopStatsAggregatorForTests(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  cached = null;
}
