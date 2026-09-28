# M7 — Production Alpha: audit and roadmap

This document records the repository audit that opened Milestone 7 and the
plan used to move CardForge from a mature framework into a closed alpha that a
new player can use without developer help. Status markers are kept current as
work lands.

## 1. Audit (start of M7)

### What already existed

| Area                          | State at audit                                                                                            | Gap for M7                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Rules engine, replay, hashing | Complete and tested (62 tests, 1,000-game batches, 12×12 matrix)                                          | None. Frozen for M7.                                                                                  |
| Authoritative rooms           | Casual, ranked, training rooms; seat-injected identity; action clocks; reconnect                          | Room join trusted a client-supplied `accountId`; no concede/abandon outcome; no friend rooms          |
| Persistence                   | Accounts, decks, matches (replay JSONB), profiles, telemetry, economy, training, live-ops, audit          | No credentials, sessions, match participants, match rewards, invites, product analytics               |
| Accounts                      | `PUT /api/accounts/:id` + `X-CardForge-Account-Id` header                                                 | Header is a scope hint, not authentication. Anyone could act as any account, including over WebSocket |
| Admin                         | Shared `X-CardForge-Admin-Token`; default token in non-production; actor name supplied by client          | Actor spoofable; no admin accounts                                                                    |
| Economy                       | Wallets, crafting, cosmetics, idempotent transactions                                                     | Inventory starts empty and deck legality ignores ownership, so collection had no effect on play       |
| Competitive                   | Elo rating, XP, mastery, Leader unlocks, balance overview                                                 | No rank tiers, no per-account history, casual play granted nothing                                    |
| Training/Academy              | Five tutorials + three PvE scenarios, server-run bot, idempotent reward                                   | Training room trusted client `accountId` (reward impersonation)                                       |
| Live ops                      | Single hardcoded `liveops.launch-2026` with events that expired 2026-09-01/10                             | No additive revision path besides flag toggles                                                        |
| Web                           | `/` = developer Match Lab, `/online`, `/studio`, `/competitive`, `/collection`, `/academy`, `/operations` | Developer vocabulary everywhere; no login, home, deckbuilder, history, replays, onboarding            |
| Deployment                    | `compose.yaml` runs a dev Postgres only                                                                   | No Dockerfiles, production compose, readiness probe, migration step, runtime web config               |
| CI                            | None                                                                                                      | Everything                                                                                            |

### Stale documentation found

- README described the project as "intentionally headless" and "before UI work begins" — untrue since M2.
- README/architecture both said real identity was "a launch hardening task" — correct but now resolved by M7/Auth.
- `docs/architecture.md` is titled "Milestone 1 engine architecture" and says M2 is "in progress".
- Default CORS origins included a private LAN IP (`192.168.8.182`).
- `.env.example` lacked every production variable.

### Architectural constraints kept

Server authority, deterministic state, exact replays, immutable content and
balance patches, hidden-information projections, typed effects, theme terms
outside the kernel, strict external validation, idempotent rewards and
settlements, and never trusting the client for results or rewards. M7 adds no
rules-kernel changes: concessions and abandonment are room-level outcomes
recorded beside the replay, not new game commands.

### Deployment blockers (resolved in M7)

1. No container images or production compose.
2. Web API endpoint baked at build time via `NEXT_PUBLIC_*`, making one image
   per environment necessary.
3. Migrations ran implicitly in the server process with no lock against
   concurrent replicas.
4. `/health` only; no database readiness probe.

### Security blockers (resolved in M7)

1. Account impersonation over REST (`X-CardForge-Account-Id`).
2. Account impersonation over WebSocket (room `accountId` option), allowing
   ranked settlement against another player's profile.
3. Training reward impersonation (room `accountId` option).
4. Admin actor spoofing and a well-known default admin token.
5. No rate limits on any endpoint.

## 2. Decisions

- **Auth lives in the match server** (it is already the API origin). Postgres
  sessions with an opaque random token in an `HttpOnly` cookie; only the
  SHA-256 of the token is stored. Email + password (Node `scrypt`, no extra
  dependency) and Discord OAuth. WebSocket joins use a short-lived HMAC
  ticket fetched with the session cookie. See [auth.md](auth.md).
- **Account IDs are preserved.** New tables reference `cardforge_accounts`.
  Legacy alpha accounts can be claimed with an operator-issued claim code.
- **Collection matters.** Onboarding grants the chosen starter deck's cards.
  Deck saves may contain unowned cards (so players can plan), but queues
  reject decks the player does not fully own. The server is the authority.
- **Rewards are per (match, account) receipts** committed in one transaction
  with wallet and XP changes. Friend matches grant no rewards (anti-farming).
- **Runtime web config.** The web container reads `CARDFORGE_PUBLIC_API_URL`
  at request time, so one image serves staging and production.
- **Replays are reconstructed server-side** and served as projected frames, so
  a client never receives the seed and deck order that would expose hidden
  information.

## 3. Plan and status

| #   | Slice                                                                                | Status |
| --- | ------------------------------------------------------------------------------------ | ------ |
| 1   | Repository audit (this document)                                                     | Done   |
| 2   | M7/Auth — sessions, password, Discord, WS tickets, admin roles, claims               | Done   |
| 3   | M7/Deployment — Dockerfile, production compose, readiness, migrations, Coolify guide | Done   |
| 4   | M7/Player Shell — home, navigation, dev tools separated                              | Done   |
| 5   | M7/Deckbuilder                                                                       | Done   |
| 6   | M7/Collection — crafting flow with confirm                                           | Done   |
| 7   | Casual/ranked Play UX, rank tiers, concede, abandon                                  | Done   |
| 8   | M7/Friend Matches — invite codes, `/join/CODE`                                       | Done   |
| 9   | Match history                                                                        | Done   |
| 10  | M7/Replays — verified server reconstruction, viewer                                  | Done   |
| 11  | Onboarding + product analytics                                                       | Done   |
| 12  | M7/Observability — structured logs, request IDs, metrics, readiness                  | Done   |
| 13  | M7/CI — PR gate, main pipeline, nightly matrix                                       | Done   |
| 14  | M7/Security — rate limits, cookie policy, CSRF, payload validation                   | Done   |
| 15  | Closed-alpha hardening — end-to-end journey smoke                                    | Done   |

All slices landed. Verification: 106 unit/contract/property tests (the
persistence contract also runs against Postgres), the journey, rooms,
training, operations, and Discord server smokes, and the browser player, lab,
and studio smokes, all run by `scripts/ci/run-smokes.sh` in CI. The security
audit is recorded in [security-review.md](security-review.md).

Deliberately not done in M7 (see the README): real-player observation of the
first session, skill-banded balance evidence, multi-replica scaling, email
verification and self-service password reset, production art, and rematch.
