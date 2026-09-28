import { stmts } from './db';
import { fetchProblemCatalog } from './leetcode';

const REFRESH_INTERVAL_MS = 24 * 60 * 60_000;
let intervalHandle: NodeJS.Timeout | null = null;

export async function refreshProblemCatalogNow(): Promise<{ ok: boolean; count?: number; error?: string }> {
  try {
    const problems = await fetchProblemCatalog();
    if (problems.length === 0) return { ok: false, error: 'empty_payload' };
    const json = JSON.stringify(
      Object.fromEntries(problems.map((p) => [p.slug, { title: p.title, id: p.id, difficulty: p.difficulty, paid: p.paid, acRate: p.acRate }]))
    );
    stmts.upsertProblemCatalog.run(json, Date.now(), problems.length);
    return { ok: true, count: problems.length };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// refreshProblemCatalogNow resolves with { ok:false } on failure rather than
// throwing, so a bare .catch() would swallow it. Log both outcomes explicitly.
function logCatalogRefresh(kind: string, p: ReturnType<typeof refreshProblemCatalogNow>): void {
  p.then((r) => {
    if (r.ok) console.log(`catalog ${kind} refresh: ${r.count} problems`);
    else console.error(`catalog ${kind} refresh failed:`, r.error);
  }).catch((e) => console.error(`catalog ${kind} refresh threw:`, (e as Error).message));
}

// Boot path: trigger an immediate refresh only if the cache is missing or
// older than the interval. Schedules a recurring refresh either way.
export function startCatalogRefresher(): void {
  const row = stmts.getProblemCatalog.get() as { updated_at: number } | undefined;
  const stale = !row || Date.now() - row.updated_at > REFRESH_INTERVAL_MS;
  if (stale) {
    logCatalogRefresh('initial', refreshProblemCatalogNow());
  }
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => {
    logCatalogRefresh('recurring', refreshProblemCatalogNow());
  }, REFRESH_INTERVAL_MS);
  intervalHandle.unref();
}

export function stopCatalogRefresherForTests(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
