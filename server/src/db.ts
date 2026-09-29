import Database from 'better-sqlite3';
import { config } from './config';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    lc_username   TEXT PRIMARY KEY,
    verified_at   INTEGER NOT NULL,
    last_sync_at  INTEGER NOT NULL DEFAULT 0,
    share_profile INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS auth_nonces (
    lc_username TEXT NOT NULL,
    nonce       TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (lc_username, nonce)
  );

  CREATE INDEX IF NOT EXISTS idx_nonces_exp ON auth_nonces(expires_at);

  -- No FK to users: rows can exist for handles that have not self-verified yet.
  CREATE TABLE IF NOT EXISTS solved_sets (
    lc_username        TEXT PRIMARY KEY,
    slugs_json         TEXT NOT NULL,
    schema_version     INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    last_self_sync_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS public_solved_counts (
    lc_username TEXT PRIMARY KEY,
    count       INTEGER NOT NULL,
    fetched_at  INTEGER NOT NULL
  );

  -- solved_sets[target] is the union across all rows here for that target, recomputed on write.
  CREATE TABLE IF NOT EXISTS contributions (
    target_username      TEXT NOT NULL,
    contributor_username TEXT NOT NULL,
    slugs_json           TEXT NOT NULL,
    updated_at           INTEGER NOT NULL,
    PRIMARY KEY (target_username, contributor_username)
  );
  CREATE INDEX IF NOT EXISTS idx_contributions_target ON contributions(target_username);
  CREATE INDEX IF NOT EXISTS idx_contributions_contributor ON contributions(contributor_username);

  CREATE INDEX IF NOT EXISTS idx_solved_sets_updated_at ON solved_sets(updated_at);

  -- Plaintext never stored; key_hash is sha256, prefix is the non-secret head for log correlation.
  CREATE TABLE IF NOT EXISTS api_keys (
    key_hash      TEXT PRIMARY KEY,
    prefix        TEXT NOT NULL,
    lc_username   TEXT NOT NULL,
    tier          TEXT NOT NULL DEFAULT 'free',
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER,
    revoked_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_username ON api_keys(lc_username);
  CREATE INDEX IF NOT EXISTS idx_api_keys_prefix   ON api_keys(prefix);

  -- Internal-only; never exposed via /api/v1. Restores the user's list across reinstalls.
  CREATE TABLE IF NOT EXISTS user_friends (
    lc_username     TEXT NOT NULL,
    friend_username TEXT NOT NULL,
    added_at        INTEGER NOT NULL,
    PRIMARY KEY (lc_username, friend_username)
  );
  CREATE INDEX IF NOT EXISTS idx_user_friends_owner ON user_friends(lc_username);

  CREATE TABLE IF NOT EXISTS user_daily_goals (
    lc_username TEXT PRIMARY KEY,
    goals_json  TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  -- Globally cached snapshot of LeetCode's problemsetQuestionList. Single row
  -- holds the whole catalog as JSON; refreshed by a daily background job.
  CREATE TABLE IF NOT EXISTS problem_catalog (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    catalog_json TEXT NOT NULL,
    updated_at   INTEGER NOT NULL,
    total_count  INTEGER NOT NULL
  );
`);

// Add share_profile to pre-existing users tables (opt-out; on by default).
(function migrateShareProfileColumn() {
  try {
    const cols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'share_profile')) {
      db.exec(`ALTER TABLE users ADD COLUMN share_profile INTEGER NOT NULL DEFAULT 1`);
    }
  } catch (e) { console.error('share_profile migration failed:', e); }
})();

export const stmts = {
  insertNonce: db.prepare(
    `INSERT INTO auth_nonces (lc_username, nonce, expires_at) VALUES (?, ?, ?)`
  ),
  findActiveNonce: db.prepare(
    `SELECT nonce, expires_at FROM auth_nonces
     WHERE lc_username = ? AND expires_at > ?`
  ),
  deleteNoncesForUser: db.prepare(
    `DELETE FROM auth_nonces WHERE lc_username = ?`
  ),
  deleteExpiredNonces: db.prepare(
    `DELETE FROM auth_nonces WHERE expires_at <= ?`
  ),
  upsertUser: db.prepare(
    `INSERT INTO users (lc_username, verified_at, last_sync_at)
     VALUES (?, ?, 0)
     ON CONFLICT(lc_username) DO UPDATE SET verified_at = excluded.verified_at`
  ),
  upsertSelfSolvedSet: db.prepare(
    `INSERT INTO solved_sets (lc_username, slugs_json, schema_version, updated_at, last_self_sync_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lc_username) DO UPDATE SET
       slugs_json        = excluded.slugs_json,
       schema_version    = excluded.schema_version,
       updated_at        = excluded.updated_at,
       last_self_sync_at = excluded.last_self_sync_at`
  ),
  upsertCrowdsourcedSet: db.prepare(
    `INSERT INTO solved_sets (lc_username, slugs_json, schema_version, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(lc_username) DO UPDATE SET
       slugs_json     = excluded.slugs_json,
       updated_at     = excluded.updated_at,
       schema_version = MAX(schema_version, excluded.schema_version)`
  ),
  getSolvedSet: db.prepare(
    `SELECT slugs_json, schema_version, updated_at, last_self_sync_at FROM solved_sets
     WHERE lc_username = ?`
  ),
  getSolvedSlugsRaw: db.prepare(
    `SELECT slugs_json, last_self_sync_at FROM solved_sets WHERE lc_username = ?`
  ),
  deleteUser: db.prepare(`DELETE FROM users WHERE lc_username = ?`),
  getShareProfile: db.prepare(`SELECT share_profile FROM users WHERE lc_username = ?`),
  setShareProfile: db.prepare(`UPDATE users SET share_profile = ? WHERE lc_username = ?`),
  deleteSolvedSet: db.prepare(`DELETE FROM solved_sets WHERE lc_username = ?`),
  touchLastSync: db.prepare(`UPDATE users SET last_sync_at = ? WHERE lc_username = ?`),
  getCachedSolvedCount: db.prepare(
    `SELECT count, fetched_at FROM public_solved_counts WHERE lc_username = ?`
  ),
  upsertCachedSolvedCount: db.prepare(
    `INSERT INTO public_solved_counts (lc_username, count, fetched_at)
     VALUES (?, ?, ?)
     ON CONFLICT(lc_username) DO UPDATE SET
       count      = excluded.count,
       fetched_at = excluded.fetched_at`
  ),
  getContribution: db.prepare(
    `SELECT slugs_json FROM contributions
     WHERE target_username = ? AND contributor_username = ?`
  ),
  getContributionsForTarget: db.prepare(
    `SELECT contributor_username, slugs_json, updated_at FROM contributions
     WHERE target_username = ?`
  ),
  countContributorsForTarget: db.prepare(
    `SELECT COUNT(*) AS c FROM contributions WHERE target_username = ?`
  ),
  upsertContribution: db.prepare(
    `INSERT INTO contributions (target_username, contributor_username, slugs_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(target_username, contributor_username) DO UPDATE SET
       slugs_json = excluded.slugs_json,
       updated_at = excluded.updated_at`
  ),
  deleteContributionsForTarget: db.prepare(
    `DELETE FROM contributions WHERE target_username = ?`
  ),
  deleteContributionsByContributor: db.prepare(
    `DELETE FROM contributions WHERE contributor_username = ?`
  ),

  // API keys.
  insertApiKey: db.prepare(
    `INSERT INTO api_keys (key_hash, prefix, lc_username, tier, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ),
  getApiKeyByHash: db.prepare(
    `SELECT key_hash, prefix, lc_username, tier, created_at, last_used_at, revoked_at
     FROM api_keys WHERE key_hash = ?`
  ),
  getLiveKeyForUser: db.prepare(
    `SELECT key_hash, prefix, lc_username, tier, created_at
     FROM api_keys
     WHERE lc_username = ? AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ),
  revokeKeysForUser: db.prepare(
    `UPDATE api_keys SET revoked_at = ?
     WHERE lc_username = ? AND revoked_at IS NULL`
  ),
  touchApiKeyUsage: db.prepare(
    `UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?`
  ),
  deleteApiKeysForUser: db.prepare(`DELETE FROM api_keys WHERE lc_username = ?`),

  // user_friends.
  getFriendsForUser: db.prepare(
    `SELECT friend_username, added_at FROM user_friends
     WHERE lc_username = ?
     ORDER BY friend_username ASC`
  ),
  insertFriend: db.prepare(
    `INSERT OR IGNORE INTO user_friends (lc_username, friend_username, added_at)
     VALUES (?, ?, ?)`
  ),
  deleteFriendsForUser: db.prepare(`DELETE FROM user_friends WHERE lc_username = ?`),
  deleteUserFromAllFriendLists: db.prepare(
    `DELETE FROM user_friends WHERE friend_username = ?`
  ),

  getDailyGoals: db.prepare(
    `SELECT goals_json, updated_at FROM user_daily_goals WHERE lc_username = ?`
  ),
  upsertDailyGoals: db.prepare(
    `INSERT INTO user_daily_goals (lc_username, goals_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(lc_username) DO UPDATE SET
       goals_json = excluded.goals_json,
       updated_at = excluded.updated_at`
  ),
  deleteDailyGoalsForUser: db.prepare(
    `DELETE FROM user_daily_goals WHERE lc_username = ?`
  ),

  getProblemCatalog: db.prepare(
    `SELECT catalog_json, updated_at, total_count FROM problem_catalog WHERE id = 1`
  ),
  upsertProblemCatalog: db.prepare(
    `INSERT INTO problem_catalog (id, catalog_json, updated_at, total_count)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       catalog_json = excluded.catalog_json,
       updated_at   = excluded.updated_at,
       total_count  = excluded.total_count`
  ),
};

export function sweepExpiredNonces(): void {
  stmts.deleteExpiredNonces.run(Date.now());
}

// Per-slug observation; all fields optional, {} means observed with no metadata yet.
export interface SlugRecord {
  ts?: number;     // submission unix seconds
  id?: string;     // LeetCode submission id
  lang?: string;   // "cpp", "java", "python3", ...
  rt?: string;     // raw runtime, e.g. "5 ms"
  mem?: string;    // raw memory, e.g. "10 MB"
}
export type SlugMap = Record<string, SlugRecord>;

// Reads tolerate three historical shapes:
//   v1:    ["a","b"]                     -> {a:{}, b:{}}
//   v1.5:  {"a": 1700000000}             -> {a:{ts:1700000000}}
//   v2:    {"a": {ts, id, lang, rt, mem}} (as-is)
export function parseSlugsJson(json: string | null | undefined): SlugMap {
  if (!json) return {};
  let v: unknown;
  try { v = JSON.parse(json); } catch { return {}; }
  if (Array.isArray(v)) {
    const out: SlugMap = {};
    for (const s of v) if (typeof s === 'string') out[s] = {};
    return out;
  }
  if (v && typeof v === 'object') {
    const out: SlugMap = {};
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k !== 'string') continue;
      if (typeof raw === 'number') {
        if (Number.isFinite(raw) && raw >= 0) out[k] = { ts: Math.floor(raw) };
        else out[k] = {};
        continue;
      }
      if (raw && typeof raw === 'object') {
        const r = raw as Record<string, unknown>;
        const rec: SlugRecord = {};
        if (typeof r.ts === 'number' && Number.isFinite(r.ts) && r.ts >= 0) rec.ts = Math.floor(r.ts);
        if (typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64) rec.id = r.id;
        if (typeof r.lang === 'string' && r.lang.length > 0 && r.lang.length <= 32) rec.lang = r.lang;
        if (typeof r.rt === 'string' && r.rt.length > 0 && r.rt.length <= 32) rec.rt = r.rt;
        if (typeof r.mem === 'string' && r.mem.length > 0 && r.mem.length <= 32) rec.mem = r.mem;
        out[k] = rec;
      } else {
        out[k] = {};
      }
    }
    return out;
  }
  return {};
}

export function serializeSlugMap(m: SlugMap): string {
  return JSON.stringify(m);
}

// Merge into prev: keep max ts; prefer newest non-empty id/lang/rt/mem, never erase with empty.
export function mergeSlugRecord(prev: SlugRecord, incoming: SlugRecord): SlugRecord {
  const out: SlugRecord = { ...prev };
  if (typeof incoming.ts === 'number' && (out.ts === undefined || incoming.ts > out.ts)) out.ts = incoming.ts;
  if (incoming.id) out.id = incoming.id;
  if (incoming.lang) out.lang = incoming.lang;
  if (incoming.rt) out.rt = incoming.rt;
  if (incoming.mem) out.mem = incoming.mem;
  return out;
}

export function unionSlugMaps(maps: SlugMap[]): SlugMap {
  const out: SlugMap = {};
  for (const m of maps) {
    for (const [slug, rec] of Object.entries(m)) {
      out[slug] = mergeSlugRecord(out[slug] || {}, rec);
    }
  }
  return out;
}

// One-time migration of legacy v1/v1.5 shapes to v2 SlugRecord. Idempotent; safe every boot.
(function migrateSlugsJsonToV2() {
  // Hardcoded allowlist: these are the only tables ever interpolated into SQL here.
  const tables = ['solved_sets', 'contributions'] as const;
  const tx = db.transaction(() => {
    for (const table of tables) {
      if (table !== 'solved_sets' && table !== 'contributions') continue;
      const rows = db.prepare(`SELECT rowid, slugs_json FROM ${table}`).all() as Array<{
        rowid: number;
        slugs_json: string;
      }>;
      for (const r of rows) {
        const parsed = parseSlugsJson(r.slugs_json);
        const normalized = serializeSlugMap(parsed);
        if (normalized === r.slugs_json) continue;
        db.prepare(`UPDATE ${table} SET slugs_json = ? WHERE rowid = ?`).run(normalized, r.rowid);
      }
    }
  });
  try { tx(); } catch (e) { console.error('slugs_json migration failed:', e); }
})();
