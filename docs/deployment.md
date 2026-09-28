# Deploying CardForge

CardForge ships as three services:

| Service        | Image target                  | Port            | Purpose                                            |
| -------------- | ----------------------------- | --------------- | -------------------------------------------------- |
| `web`          | `Dockerfile` → `web`          | 3000            | Next.js player client (standalone server)          |
| `match-server` | `Dockerfile` → `match-server` | 2567            | REST API, authentication, Colyseus WebSocket rooms |
| `postgres`     | `postgres:17-alpine`          | 5432 (internal) | Accounts, decks, matches, replays, economy         |

Redis is not used. The closed alpha runs one match-server replica; rooms,
rate limits, and the replay cache live in that process (see
[Scaling limits](#scaling-limits)).

## Domains

Both public services need HTTPS hostnames **on the same registrable domain**
so the session cookie is first-party:

```text
https://play.example.com  → web:3000
https://api.example.com   → match-server:2567   (HTTP + WebSocket upgrade)
```

Platform-generated names under public suffixes (for example `*.sslip.io`)
are separate sites to the browser and will break sign-in; use your own
domain for anything beyond a smoke test.

## Configuration

All configuration is environment variables; nothing is baked into images, so
one build can be promoted from staging to production. Start from
[`.env.production.example`](../.env.production.example).

| Variable                                           | Required    | Notes                                                                                                       |
| -------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `CARDFORGE_WEB_URL`                                | yes         | Public web origin, e.g. `https://play.example.com`. Also the CORS allow-list and OAuth return target.       |
| `CARDFORGE_PUBLIC_API_URL`                         | yes         | Public API origin, e.g. `https://api.example.com`. The web client reads it at request time.                 |
| `POSTGRES_PASSWORD`                                | yes         | Database password (the compose file builds `DATABASE_URL`).                                                 |
| `CARDFORGE_SESSION_SECRET`                         | yes         | ≥ 32 random characters. Signs match tickets and OAuth state. Rotating it invalidates tickets, not sessions. |
| `CARDFORGE_ADMIN_TOKEN`                            | recommended | ≥ 32 characters. Operator automation, `/metrics`, and promoting the first operator (see `docs/auth.md`).    |
| `CARDFORGE_ADMIN_DISCORD_IDS`                      | optional    | Discord user IDs granted the admin role at Discord sign-in.                                                 |
| `CARDFORGE_SIGNUP_MODE` / `CARDFORGE_SIGNUP_CODES` | recommended | `invite` plus comma-separated codes for a closed alpha.                                                     |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`      | optional    | Enables Discord login. Redirect URI: `https://api.example.com/api/auth/discord/callback`.                   |
| `CARDFORGE_ENVIRONMENT`                            | optional    | `production` or `staging`; shown in the web footer and logs.                                                |
| `CARDFORGE_ACTION_CLOCK_MS`                        | optional    | Per-action clock (default 45 s in the compose file).                                                        |
| `CARDFORGE_RECONNECT_SECONDS`                      | optional    | Reconnect grace before a dropped player forfeits (default 60).                                              |
| `CARDFORGE_TRUST_PROXY`                            | optional    | Reverse-proxy hops to trust for client IPs (default 1).                                                     |

The match server refuses to start in production without a session secret,
database URL, and allowed origins.

## Coolify

1. **Create the resource.** In your project choose _New Resource → Docker
   Compose_ (from the Git repository), branch `main`, and set the compose
   path to `/compose.production.yaml`.
2. **Environment.** Open _Environment Variables_ and paste the contents of
   your `.env.production` (all variables above). Mark the secrets as
   secrets. Do not set `DATABASE_URL`; the compose file derives it.
3. **Domains.** Under the service list set:
   - `web` → `https://play.example.com:3000`
   - `match-server` → `https://api.example.com:2567`

   The `:port` suffix tells Coolify which container port to route to.
   Leave `postgres` without a domain. Coolify's Traefik proxy forwards
   WebSocket upgrades automatically; no extra labels are needed.

4. **Persistent storage.** The named volume `cardforge-postgres` persists
   across deploys. Configure Coolify's scheduled backups for the Postgres
   service (or `pg_dump` via a scheduled task) before inviting players.
5. **Health checks.** Both images declare Docker `HEALTHCHECK`s: the match
   server reports healthy only once migrations finish and the database
   answers (`GET /ready`); `web` depends on a healthy match server. Coolify
   waits for these before routing traffic.
6. **Deploy.** Click _Deploy_. Watch the match-server logs for
   `migrations complete` and `match server ready`.
7. **Verify.** `curl https://api.example.com/ready` returns
   `{"status":"ready","database":"ok"}`; open `https://play.example.com`,
   create an account (with a signup code if in invite mode), and finish
   onboarding.

### Staging

Create a second Coolify resource from the same repository and compose file
with its own domains (for example `staging-play.example.com` and
`staging-api.example.com`), `CARDFORGE_ENVIRONMENT=staging`, and different
secrets. The main-branch workflow can trigger its deploy webhook (see
[CI/CD](#cicd)); production stays a manual _Deploy_ in Coolify, or a
redeploy pinned to an image tag that already passed staging.

## Any other Docker host

```bash
cp .env.production.example .env.production   # fill in values
docker compose -f compose.production.yaml --env-file .env.production up -d --build
```

Put a TLS-terminating reverse proxy (Caddy, Traefik, nginx) in front and
route the two hostnames to `web:3000` and `match-server:2567`, forwarding
`Upgrade`/`Connection` headers for WebSockets. For a local production-mode
trial without a proxy, add `-f compose.production.local.yaml`, which
publishes both ports on `127.0.0.1` and allows non-HTTPS cookies.

## Migrations

Migrations are ordered SQL files in `packages/persistence/migrations`,
applied inside transactions and recorded in `cardforge_schema_migrations`.
The match server applies pending migrations on start while holding a
Postgres advisory lock, so concurrent starts cannot double-apply them;
`/ready` stays `503` until they finish. Each migration logs
`migration applied` with its duration; a failure logs at `critical` and
exits the process so the platform keeps the previous container running.

To migrate as a separate release step instead:

```bash
docker compose -f compose.production.yaml run --rm match-server node dist/migrate-cli.js
```

Migrations are additive; M7's `0007` and `0008` add tables and nullable
columns only and preserve every existing account ID.

## Observability

- **Logs**: JSON lines on stdout with `level`, `msg`, `requestId`,
  `matchId`, and `accountId` where relevant. Credentials are redacted.
  `critical` lines carry `"alert": true` — alert on them. They cover replay
  hash mismatches, duplicate settlements/rewards, settlement failures,
  migration failures, and startup failures.
- **Probes**: `GET /health` (liveness), `GET /ready` (migrations + database),
  web `GET /healthz`.
- **Metrics**: `GET /metrics` (Prometheus text, requires
  `Authorization: Bearer $CARDFORGE_ADMIN_TOKEN` in production): HTTP
  requests and 5xx by route class, WebSocket joins/drops/reconnects,
  connected clients, queue sizes, active/started/completed matches, rejected
  commands, auth events, integrity failures, and error log lines.
- **Request IDs**: every response carries `x-request-id`; 500 responses
  include it in the body for support.
- **Error monitoring**: `observeErrors()` in `apps/match-server/src/logger.ts`
  receives every `error` and `critical` log line. To forward them to Sentry
  (or any monitor), register an observer there that calls the SDK; nothing
  else needs to change. Until then, alert on `"alert": true` log lines.

## CI/CD

`.github/workflows/ci.yml` runs on every pull request: install, typecheck,
lint, unit and contract tests (with a Postgres service), a representative
simulation sample, production build, the server journey smoke, and the
browser smoke. `.github/workflows/main.yml` runs on `main`: the full test
suite, the 12×12 archetype matrix, image builds pushed to GHCR, and — when
`COOLIFY_STAGING_WEBHOOK` is configured — a staging deploy followed by a
smoke against the staging URL. A nightly workflow runs the long simulation
batch.

## Scaling limits

The alpha is designed for one match-server replica (hundreds of concurrent
players). Running more replicas requires a Colyseus presence/driver
(Redis) for matchmaking across processes and a shared rate-limit store; the
database schema and migration lock already support multiple replicas.

## Backups and restore

```bash
docker compose -f compose.production.yaml exec postgres \
  pg_dump -U cardforge -Fc cardforge > cardforge-$(date +%F).dump
docker compose -f compose.production.yaml exec -T postgres \
  pg_restore -U cardforge -d cardforge --clean < cardforge-YYYY-MM-DD.dump
```

Replays are stored as JSONB inside the database, so a database backup is a
complete backup.
