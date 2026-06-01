# LeetSquad Public API

Read-only HTTP API at `https://leetsquad.miro.build/api/v1/*` over the cloud-sync corpus. OpenAPI 3.1 at [`/api/v1/openapi.json`](https://leetsquad.miro.build/api/v1/openapi.json). Usage terms are in the [Terms](#terms) section below.

## Quick start

```bash
# 1. Anonymous read, no setup
curl https://leetsquad.miro.build/api/v1/users/alice

# 2. Grab your API key from the extension (Settings > Cloud Sync > API key)
export LS_KEY=ls_pk_yourkeyhere

# 3. Higher-tier read
curl -H "Authorization: Bearer $LS_KEY" \
  'https://leetsquad.miro.build/api/v1/users?limit=10'
```

Anonymous reads work for the marked endpoints in the table below. For API key access, install the extension, verify Cloud Sync and copy the key from Settings.

## Authentication

Two bearer tokens, used in different places:

| Token | Format | Where |
|---|---|---|
| API key | `ls_pk_<base32>` | `/api/v1/users*`, `/api/v1/stats`, `/api/v1/changes`, `/api/v1/slugs/*` |
| JWT | `eyJ...` | `/api/v1/key`, `/api/v1/key/rotate` |

Every verified Cloud Sync user gets a personal API key, visible in the extension's Settings panel with copy and rotate buttons. There is no self-serve key endpoint. Anonymous reads work too, at a lower rate-limit tier.

## Endpoints

| Method | Path | Auth | Anon | Keyed |
|---|---|---|---|---|
| `GET` | `/api/v1/health` | none | ∞ | ∞ |
| `GET` | `/api/v1/users/:username` | optional key | 60/hr/IP | 5/sec |
| `GET` | `/api/v1/users/:username/count` | optional key | 120/hr/IP | 10/sec |
| `GET` | `/api/v1/users` (paginated) | required key | — | 1/sec |
| `GET` | `/api/v1/stats` | optional key | 60/hr/IP | 5/sec |
| `GET` | `/api/v1/changes?since=&limit=` | required key | — | 5/sec |
| `GET` | `/api/v1/slugs/:slug/count` | optional key | 120/hr/IP | 10/sec |
| `GET` | `/api/v1/slugs/:slug/solvers?cursor=&limit=` | required key | — | 2/sec |
| `GET` | `/api/v1/openapi.json` | none | ∞ | ∞ |
| `GET` | `/api/v1/key` | JWT | — | 12/hr |
| `POST` | `/api/v1/key/rotate` | JWT | — | 6/day |
| `DELETE` | `/api/v1/users/me` | JWT | — | 3/day |

All responses include `X-RateLimit-*` headers and an `x-trace-id` header. Quote `trace_id` from any error when filing a bug.

## Response shapes

```jsonc
// GET /api/v1/users/alice
{
  "username": "alice",
  "solved_slugs": ["two-sum", "add-two-numbers", "..."],
  "solved_count": 487,
  "contributors_count": 3,            // how many LeetSquad users have contributed to this row
  "updated_at": 1735693200000,
  "schema_version": 1
}

// GET /api/v1/users?cursor=&limit=100
{ "users": [{ "username": "alice", "solved_count": 312, "updated_at": 1735000000000 }, ...],
  "next_cursor": "<opaque base64>" | null }

// GET /api/v1/stats
{ "users_total": 1284, "solves_total": 412903,
  "top_slugs": [{ "slug": "two-sum", "count": 1102 }, ...], "generated_at": 1735693200000 }

// GET /api/v1/changes?since=&limit=
{ "changes": [{ "username": "alice", "updated_at": 1735100000000 }, ...],
  "next_since": 1735693201000 }

// GET /api/v1/slugs/two-sum/solvers?limit=100
{ "slug": "two-sum",
  "solvers": [{ "username": "alice", "updated_at": 1735100000000 }, ...],
  "next_cursor": "<opaque>" | null }

// POST /api/v1/key/rotate (JWT)
{ "api_key": "ls_pk_<new>", "prefix": "ls_pk_<6>", "tier": "free" }

// DELETE /api/v1/users/me (JWT)
{ "ok": true, "deleted": "alice" }
```

Every error has the same envelope:

```json
{ "error": "not_found", "message": "user is not published", "trace_id": "9f1c2a" }
```

Common codes: `invalid_username`, `bad_slug`, `bad_cursor`, `missing_key`, `invalid_key`, `revoked_key`, `missing_token`, `not_found`, `too_many_requests`, `leetcode_unreachable`, `internal`.

## Pagination

`/users` and `/slugs/:slug/solvers` are cursor-paginated: round-trip `next_cursor` verbatim, `limit=1..200` (default 50). Done when `next_cursor` is `null`. `/changes` uses `since=<unix_ms>` and returns `next_since`; echo it back on the next poll.

## Keys

The server only stores `sha256(key)`. You see the plaintext exactly twice: at verification, and after `POST /api/v1/key/rotate`. Rotation revokes the prior key atomically. If your JWT is also lost, re-verify in the extension.

## Terms

The dataset is contributed by LeetSquad extension users who have proven ownership of a LeetCode handle via the bio-nonce verification flow and kept Cloud Sync enabled. Each row is a self-uploaded or crowdsourced claim about which problem slugs a user has solved, bounded by that user's public solved count. A row may exist for a user with Cloud Sync off, populated by other users who follow them.

By using the API you agree that the followign are prohibited: targeted harassment; impersonation; combining this data with other personally identifiable information without users' separate consent; redistribution under more permissive terms.

API keys may be revoked at any time if traffic is abusive. You may rotate your own key from the extension's Settings panel.

## Examples

```bash
curl https://leetsquad.miro.build/api/v1/health
curl https://leetsquad.miro.build/api/v1/users/alice
curl -H 'Authorization: Bearer ls_pk_yours' \
  'https://leetsquad.miro.build/api/v1/users?limit=10'
curl https://leetsquad.miro.build/api/v1/slugs/two-sum/count
curl -X POST -H "Authorization: Bearer $JWT" \
  https://leetsquad.miro.build/api/v1/key/rotate
```

Issues: <https://github.com/m-durana/leetsquad-extension/issues>.
