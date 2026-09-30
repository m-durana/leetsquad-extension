import { stmts } from './db';
import { fetchProblemCatalog } from './leetcode';

const REFRESH_INTERVAL_MS = 24 * 60 * 60_000; // how old is too old
const CHECK_INTERVAL_MS = 60 * 60_000; // hourly tick that only refreshes when the DATA is stale
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

// Resolves { ok:false } on failure rather than throwing, so a bare .catch() misses it.
function logCatalogRefresh(kind: string, p: ReturnType<typeof refreshProblemCatalogNow>): void {
  p.then((r) => {
    if (r.ok) console.log(`catalog ${kind} refresh: ${r.count} problems`);
    else console.error(`catalog ${kind} refresh failed:`, r.error);
  }).catch((e) => console.error(`catalog ${kind} refresh threw:`, (e as Error).message));
}

export function startCatalogRefresher(): void {
  // Anchor staleness to the catalog's updated_at, not process start, so restarts can't
  // reset the clock and let the catalog silently drift toward ~48h old.
  const maybeRefresh = (kind: string) => {
    const row = stmts.getProblemCatalog.get() as { updated_at: number } | undefined;
    if (!row || Date.now() - row.updated_at > REFRESH_INTERVAL_MS) {
      logCatalogRefresh(kind, refreshProblemCatalogNow());
    }
  };

  maybeRefresh('initial');
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => maybeRefresh('recurring'), CHECK_INTERVAL_MS);
  intervalHandle.unref();
}

export function stopCatalogRefresherForTests(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
