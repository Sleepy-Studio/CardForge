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

## Coolify (recommended)

`compose.production.yaml` is written for Coolify's Docker Compose build pack.
Its `SERVICE_*` [magic variables](https://coolify.io/docs/applications/builds/docker-compose)
make Coolify generate the database credentials, session secret, and operator
token, and assign a domain to `web` (port 3000) and `match-server` (port
2567, HTTP and WebSocket). Nothing is hand-configured except invite codes.

1. **New Resource → Public/Private Repository** (`Sleepy-Studio/CardForge`,
   branch `main`), build pack **Docker Compose**, compose location
   `/compose.production.yaml`.
2. **Environment Variables:** fill in `CARDFORGE_SIGNUP_CODES`
   (comma-separated invite codes). Coolify marks it required and will not
   deploy without it. Everything else is generated or defaulted.
3. **Domains:** if the server has a wildcard domain (_Servers → your server
   → Wildcard Domain_, for example `https://yourdomain.com`), Coolify has
   already assigned `web` and `match-server` hostnames under it and there is
   nothing to do. Otherwise, or to choose nicer names, set them on the
   resource, e.g. `web` → `https://play.yourdomain.com` and `match-server` →
   `https://api.yourdomain.com`.
4. **Deploy.** Health checks gate the rollout: the match server is healthy
   only after migrations finish and the database answers, and `web` starts
   only after that. With Coolify's GitHub App, pushes to `main` redeploy
   automatically.

Then make yourself operator: register on the site, open the resource's
**Terminal** tab, choose the `match-server` container, and run

```bash
node dist/admin-cli.js promote you@yourdomain.com
```

The operator token (for `/metrics` and automation) is the generated
`SERVICE_HEX_64_OPERATOR` value under Environment Variables.

### Requirements Coolify cannot check

- **Both domains must share a registrable domain you own** (the session
  cookie is first-party). Coolify's fallback `*.sslip.io` names are separate
  sites to browsers and break sign-in; use them only for a smoke test.
- **HTTPS.** Use `https://` domains so cookies are `Secure`.

### Optional settings

| Variable                                        | Default      | Notes                                                                       |
| ----------------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| `CARDFORGE_SIGNUP_MODE`                         | `invite`     | `open` lets anyone register (codes are then ignored but still required).    |
| `CARDFORGE_ENVIRONMENT`                         | `production` | `staging` for a staging resource; shown in the web footer and logs.         |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`   | unset        | Enables Discord login. Redirect URI: `<API URL>/api/auth/discord/callback`. |
| `CARDFORGE_ADMIN_DISCORD_IDS`                   | unset        | Discord user IDs granted the admin role at Discord sign-in.                 |
| `CARDFORGE_ACTION_CLOCK_MS`                     | `45000`      | Per-action clock.                                                           |
| `CARDFORGE_RECONNECT_SECONDS`                   | `60`         | Reconnect grace before a dropped player forfeits.                           |
| `CARDFORGE_TRUST_PROXY` / `CARDFORGE_LOG_LEVEL` | `1` / `info` | Proxy hops for client IPs; log verbosity.                                   |

`/health` reports the deployed commit from Coolify's `SOURCE_COMMIT` at
runtime, so the build cache is unaffected.

### Verify

From any machine with Node 22 and this repository:

```bash
CARDFORGE_SMOKE_SIGNUP_CODE=<an invite code> \
  node scripts/verify-deployment.ts https://play.yourdomain.com https://api.yourdomain.com
```

It checks HTTPS and same-site domains, `/health` and `/ready`, gated
`/metrics`, CORS and CSRF against foreign origins, session-cookie flags
(registers one `deploy-check-…@example.invalid` account when a code is
given), web security headers, and that the web app points at this API. For
the full two-player journey against the live API:

```bash
CARDFORGE_SERVER_URL=https://api.yourdomain.com \
CARDFORGE_SMOKE_ORIGIN=https://play.yourdomain.com \
CARDFORGE_SMOKE_SIGNUP_CODE=<an invite code> \
  pnpm --filter @cardforge/match-server smoke:journey
```

### Staging

Add a second resource from the same repository and compose file with
`CARDFORGE_ENVIRONMENT=staging` and its own domains. `main.yml` can trigger
it and smoke it after each merge when `COOLIFY_STAGING_WEBHOOK` (secret),
`COOLIFY_API_TOKEN` (secret), `STAGING_API_URL`, and `STAGING_WEB_URL`
(variables) are set; without them that job is skipped.

## Any other Docker host

```bash
cp .env.production.example .env.production   # fill in the SERVICE_* values
docker compose -f compose.production.yaml --env-file .env.production up -d --build
```

Put a TLS-terminating reverse proxy (Caddy, Traefik, nginx) in front and
route the two hostnames to `web:3000` and `match-server:2567`, forwarding
`Upgrade`/`Connection` headers for WebSockets. Promote your operator with
`docker compose -f compose.production.yaml exec match-server node dist/admin-cli.js promote <email>`.
For a local production-mode trial without a proxy, add
`-f compose.production.local.yaml` and use `http://localhost:3000` /
`http://localhost:2567` as the two `SERVICE_URL_*` values.

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
  `Authorization: Bearer <operator token>` in production): HTTP
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
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc cardforge' > cardforge-$(date +%F).dump
docker compose -f compose.production.yaml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d cardforge --clean' < cardforge-YYYY-MM-DD.dump
```

Replays are stored as JSONB inside the database, so a database backup is a
complete backup.

On Coolify, run the dump from the resource's Terminal (the `postgres`
container) or as a Scheduled Task, and copy it off the server; the volume
lives on the same host as the application.
