# leetsquad-server

Cloud sync backend + public read-only API for the LeetSquad extension. The full public surface is documented in [../API.md](../API.md); machine-readable OpenAPI 3.1 is served at `/api/v1/openapi.json`.

## Requirements

- Node 20+
- A LeetCode handle the server can resolve via the public GraphQL endpoint (no LeetCode credentials required server-side)

## Setup (local dev)

```bash
cp .env.example .env
# edit .env: set JWT_SECRET to a long random string
npm install
npm run dev
```

Listens on `:8787` and writes `./leetsquad.db`. Hot-reloads on file change via `tsx watch`.

## Environment

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP listen port |
| `DB_PATH` | `./leetsquad.db` | SQLite file path |
| `TRUST_PROXY` | `2` | Proxy hops in front of the app (Cloudflare + nginx = 2) so rate limits key on the real client IP. Set to match your topology. |
| `JWT_SECRET` | (required) | HS256 signing secret. Use ≥48 random bytes. |
| `JWT_EXPIRES_IN` | `30d` | JWT TTL (vercel/ms format) |
| `NONCE_TTL_SECONDS` | `600` | Auth nonce validity window |
| `ALLOWED_ORIGINS` | (empty) | Comma-separated CORS allowlist. Supports `*` wildcards, e.g. `chrome-extension://*,https://leetsquad.miro.build` |
| `NODE_ENV` | (unset) | Set to `test` to bypass rate limits in CI |
| `DISABLE_RATE_LIMITS` | (unset) | Set to `1` to bypass rate limits for load testing |

Generate a JWT secret with `openssl rand -hex 48`.

## Build

```bash
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
npm start           # node dist/index.js
```

## Tests

```bash
npm test
```

Vitest. Tests use `tests/setup.ts` to set `NODE_ENV=test` (which disables rate limits) and point at `./test-leetsquad.db`, recreated each run.

## Deploy on a VPS

```bash
docker build -t leetsquad-server .
docker volume create leetsquad-data
docker run -d --name leetsquad-server \
  --restart=unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v leetsquad-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 48)" \
  -e ALLOWED_ORIGINS="chrome-extension://*,https://leetsquad.miro.build" \
  leetsquad-server
```

The container bind-mounts `/data` so the SQLite file survives `docker rm`. `DB_PATH` is pre-set to `/data/leetsquad.db` in the Dockerfile.

### TLS via Caddy

```
leetsquad.miro.build {
  reverse_proxy 127.0.0.1:8787
}
```

Caddy handles Let's Encrypt automatically. `trust proxy` is already enabled server-side so `X-Forwarded-For` is honoured for rate limiting.

### Smoke test

```bash
curl https://leetsquad.miro.build/health
# → {"ok":true}

curl -X POST https://leetsquad.miro.build/auth/start \
  -H 'Content-Type: application/json' \
  -d '{"lc_username":"<your-handle>"}'
# → {"nonce":"leetsquad-verify-...","expires_at":...}
```

## Operations

### Database

SQLite, WAL mode, single file at `$DB_PATH`. Tables are created at boot via `CREATE TABLE IF NOT EXISTS`. There is no migration tooling yet; schema changes mean editing [src/db.ts](src/db.ts) and accepting that running deployments need a manual `ALTER TABLE` or a fresh DB.

Back up the file with any SQLite-aware tool. Cold copy is safe while the server is stopped; for a live backup use `sqlite3 leetsquad.db ".backup /tmp/snapshot.db"`.

### Rate limits

Defined in [src/routes/auth.ts](src/routes/auth.ts) and [src/routes/sync.ts](src/routes/sync.ts) (currently 5/min on `/auth/start`, 10/min on `/auth/verify`, 12/hour/token on `/sync`). Bypass with `DISABLE_RATE_LIMITS=1` for load tests.

### Logs

Plain stdout. `console.error` for handled failures, `console.log` for boot. Pipe to journald/Loki/whatever your VPS uses.

### Updating

```bash
git pull
docker build -t leetsquad-server .
docker stop leetsquad-server && docker rm leetsquad-server
docker run -d ... leetsquad-server   # same flags as above
```

The volume persists across rebuilds.

## Data deletion requests

Verified users self-serve via `DELETE /api/v1/users/me` (JWT-authed), exposed in the extension Settings as "Delete my data". The manual SQL path below is only for users who have lost their JWT (extension uninstalled, browser wiped) and have filed a GitHub issue with proof of ownership.

```bash
docker exec -it leetsquad-server sh -c '
sqlite3 /data/leetsquad.db "
  DELETE FROM contributions WHERE target_username = '\''USER'\'' OR contributor_username = '\''USER'\'';
  DELETE FROM solved_sets WHERE lc_username = '\''USER'\'';
  DELETE FROM user_friends WHERE lc_username = '\''USER'\'' OR friend_username = '\''USER'\'';
  DELETE FROM api_keys WHERE lc_username = '\''USER'\'';
  DELETE FROM public_solved_counts WHERE lc_username = '\''USER'\'';
  DELETE FROM users WHERE lc_username = '\''USER'\'';
"
'
```

(Replace `USER` with the requested handle.)
