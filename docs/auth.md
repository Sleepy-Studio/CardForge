# Authentication and authorization

M7 replaced the alpha `X-CardForge-Account-Id` header, which any client could
set to any value, with verified server-side identity. This document describes
the design, the trust boundaries, and how legacy alpha accounts migrate.

## Principles

- The server decides who a request belongs to. No API, room, or payload
  accepts an account ID from the client as authority.
- Player data is addressed as `/api/me/...`; the account comes from the
  session. The old `/api/accounts/:accountId/...` routes no longer exist.
- Operations APIs are a separate boundary with their own credential and an
  audit actor derived by the server.
- Nothing secret is logged. The structured logger redacts keys matching
  password, secret, token, cookie, authorization, credential, and DSN.

## Components

| Piece          | Where                                                                      | Notes                                                                                                                                                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password login | `POST /api/auth/register`, `POST /api/auth/login`                          | Node `scrypt` (N=16384, r=8, p=1, 16-byte salt, 64-byte key). Unknown emails still run scrypt against a decoy hash so timing does not reveal registered addresses.                                                                                                                                                                    |
| Discord OAuth  | `GET /api/auth/discord/start` → Discord → `GET /api/auth/discord/callback` | `identify` scope only. `state` is random and bound to a signed, 10-minute, HttpOnly cookie. Post-login `next` paths must be same-app relative paths.                                                                                                                                                                                  |
| Sessions       | `cardforge_sessions`                                                       | 256-bit random token in an `HttpOnly; SameSite=Lax; Secure` cookie. Only its SHA-256 is stored. 30-day sliding expiry (`CARDFORGE_SESSION_TTL_DAYS`), refreshed at most hourly. `POST /api/auth/logout` deletes the row; `POST /api/auth/logout-all` deletes every session for the account.                                           |
| Room tickets   | `POST /api/me/match-ticket`                                                | HMAC-SHA256 signed `{sub, pur: "match", exp}` valid for five minutes. The browser sets it as the Colyseus auth token; `onAuth` verifies it and loads the account before any seat is reserved. Reconnection uses Colyseus reconnection tokens and needs no new ticket.                                                                 |
| Admin          | `/api/admin/*`, `/metrics` in production                                   | An account with `role = 'admin'`, or `Authorization: Bearer $CARDFORGE_ADMIN_TOKEN` (≥ 32 characters) for automation. Admin role is granted by an operator (`POST /api/admin/accounts/:accountId/role`) or by `CARDFORGE_ADMIN_DISCORD_IDS` at Discord sign-in; never by an unverified registration email. There is no default token. |

## Request flow

```text
browser (web origin) ──fetch, credentials: include──▶ match server /api
        │                                             │ session cookie → account
        │                                             ▼
        │                                  CORS allow-list + Origin check
        │
        ├──POST /api/me/match-ticket──▶ signed 5-minute ticket
        │
        └──Colyseus joinOrCreate(room, { deckId }), auth.token = ticket
                                      │
                         static onAuth(ticket) → { accountId, displayName }
                                      │
                         onJoin: deck loaded by (accountId, deckId);
                         ownership, legality, and Leader unlock checked
```

Game commands still never carry `playerId`: the room maps the connection to
its seat and injects identity before the engine sees the command.

## Cookie and CSRF policy

The web client and API are expected on sibling hosts of one site (for example
`play.example.com` and `api.example.com`), which makes the API cookie
first-party and `SameSite=Lax` sufficient. State-changing requests are also
protected by:

1. An `Origin` allow-list (`CARDFORGE_ALLOWED_ORIGINS`): any mutating request
   with a foreign `Origin` receives 403 before routing.
2. JSON-only bodies, which forces a CORS preflight for cross-origin callers.
3. Credentialed CORS responses only for allow-listed origins.

The two hosts must share a registrable domain. Platform-generated hostnames
under public suffixes such as `*.sslip.io` do not count as one site; use your
own domain (see [deployment.md](deployment.md)).

## Authorization rules

| Resource                                                                                 | Rule                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decks, collection, crafting, cosmetics, quests, profile, history, rewards, support cases | Session account only (`/api/me`).                                                                                                                        |
| Online queues                                                                            | Ticket account; the deck must belong to that account, be legal, fully owned, and use an unlocked Leader.                                                 |
| Friend invites                                                                           | Host plus exactly one guest; codes expire after 15 minutes and start one match only.                                                                     |
| Replays                                                                                  | Participants see the public view and their own seat; opponents' hands stay hidden. Admins may view any perspective. Unfinished matches are not viewable. |
| Rewards and ranked settlement                                                            | Only the room awards them, once per (match, account) and once per match, inside database transactions.                                                   |

## Rate limits

In-process fixed windows (the closed alpha runs one match-server replica):
authentication 30 requests per 10 minutes per IP plus 10 login attempts per
10 minutes per email; player writes 120 per minute per account; invites 20
per hour per account. Oversized WebSocket frames (> 16 KiB) and JSON bodies
(> 64 KiB) are refused.

## Promoting operators

Registration never grants admin, because emails are not verified. After an
operator registers normally, promote the account with the operator token (or
from an existing admin session); every change is audited:

```bash
curl "https://api.example.com/api/admin/accounts?q=ops@example.com" \
  -H "Authorization: Bearer $CARDFORGE_ADMIN_TOKEN"
# → { "account": { "accountId": "…", … } }
curl -X POST https://api.example.com/api/admin/accounts/<accountId>/role \
  -H "Authorization: Bearer $CARDFORGE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"role":"admin"}'
```

`{"role":"player"}` revokes it. Discord accounts listed in
`CARDFORGE_ADMIN_DISCORD_IDS` are promoted at sign-in, since Discord verifies
the ID. The server refuses to start if the removed `CARDFORGE_ADMIN_EMAILS`
is still set.

## Migrating alpha accounts

Migration `0007_production_auth` is additive. Every existing account row,
deck, wallet, and match is preserved, and existing account IDs are reused.
Legacy alpha accounts have no credentials, so nobody can sign in as them
until an operator issues a one-time claim code:

```bash
curl -X POST https://api.example.com/api/admin/accounts/<accountId>/claim-code \
  -H "Authorization: Bearer $CARDFORGE_ADMIN_TOKEN"
# → { "claimCode": "…", "expiresAt": "…" }  (valid 7 days, single use)
```

The player registers with that `claimCode`; the credential attaches to the
existing account instead of creating a new one. Codes are stored hashed.

## Support-assisted password reset

There is no email infrastructure in the alpha, so resets go through support.
An operator looks the player up in _Operations → Account support_ (by email
or account ID, `GET /api/admin/accounts?q=`) and issues the same one-time,
seven-day code. On the sign-in page the player opens _Forgot your password?_,
enters the code and a new password (`POST /api/auth/reset-password`). The
password is replaced, every existing session for the account is revoked, and
the player is signed in. Codes are single use and stored hashed; issuance is
audited.

## Configuration

See `.env.example`. Production refuses to start without
`CARDFORGE_SESSION_SECRET` (≥ 32 characters), `DATABASE_URL`, and
`CARDFORGE_ALLOWED_ORIGINS`. Set `CARDFORGE_SIGNUP_MODE=invite` with
`CARDFORGE_SIGNUP_CODES` to restrict registration during the closed alpha.

## Verification

- `apps/match-server/src/m7.test.ts`: scrypt, ticket forgery/expiry/purpose,
  cookie flags, open-redirect guard, production config refusal, log redaction.
- `packages/persistence/src/journey-contract.test.ts`: sessions, duplicate
  emails, single-use claims, OAuth identity mapping (memory and Postgres).
- `pnpm smoke:journey`: header spoofing, foreign origins, rooms without or
  with forged tickets, and client-supplied account IDs are all refused.
- `pnpm --filter @cardforge/match-server smoke:discord`: OAuth state
  mismatch refused; one Discord identity maps to one account.
