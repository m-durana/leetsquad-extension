import Database from 'better-sqlite3';
import { config } from './config';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    lc_username   TEXT PRIMARY KEY,
    verified_at   INTEGER NOT NULL,
    last_sync_at  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS auth_nonces (
    lc_username TEXT NOT NULL,
    nonce       TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (lc_username, nonce)
  );

  CREATE INDEX IF NOT EXISTS idx_nonces_exp ON auth_nonces(expires_at);

  -- No FK to users: rows can be created by crowdsourced uploads from
  -- contributors who know about a LeetCode handle that has not (yet)
  -- self-verified with us. DELETE happens explicitly via the issue-driven
  -- deletion process, not by cascade.
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

  -- Per (target, contributor) pair: this contributor's accreted claim about
  -- this target's solved slugs. solved_sets[target].slugs_json is derived
  -- as the union across all contributors for that target and is recomputed
  -- on every write here.
  CREATE TABLE IF NOT EXISTS contributions (
    target_username      TEXT NOT NULL,
    contributor_username TEXT NOT NULL,
    slugs_json           TEXT NOT NULL,
    updated_at           INTEGER NOT NULL,
    PRIMARY KEY (target_username, contributor_username)
  );
  CREATE INDEX IF NOT EXISTS idx_contributions_target ON contributions(target_username);
  CREATE INDEX IF NOT EXISTS idx_contributions_contributor ON contributions(contributor_username);
`);

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
    `SELECT contributor_username, slugs_json FROM contributions
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
};

export function sweepExpiredNonces(): void {
  stmts.deleteExpiredNonces.run(Date.now());
}
