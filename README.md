# CardForge

CardForge is a deterministic, rebrandable web trading-card-game framework,
shipping with a reference game, **TempoFront**: a no-turns tactical card game
where both players share one Timeline across three contested Fronts.

**Current status: M7 — Production Alpha.** A new player can register (email
or Discord), choose a starter Leader, learn the rules, build and save decks,
craft cards, play casual, ranked, friend-invite, or practice matches against a
fully authoritative server, reconnect after a drop, earn exactly-once rewards
and rating, review their match history, and watch a server-verified replay.
The stack deploys from one Dockerfile and a production compose file (Coolify
guide included). See [docs/m7-roadmap.md](docs/m7-roadmap.md) for the audit
and plan, and the [M7 section](#milestone-7-production-alpha) below for the
verification evidence.

## Run it locally

Requires Node.js 22+ and pnpm 11.

```bash
pnpm install
pnpm build                    # typecheck every package and build the web app
docker compose up -d postgres # optional; without DATABASE_URL the server uses memory
cp .env.example .env          # then export the variables you need
pnpm dev:server               # match server + API on :2567 (after pnpm build)
pnpm dev                      # web client on :3000
```

Open http://localhost:3000, create an account, and follow onboarding.
Developer tools live outside the player navigation: `/lab` (local engine
sandbox), `/studio` (Card Studio), and `/operations` (admin accounts only).

```bash
pnpm test                     # unit, contract, determinism, and property tests
pnpm sim --games 1000 --seed 1
pnpm sim:matrix               # seat-swapped 12×12 archetype matrix
pnpm smoke:journey            # full player journey against a running server
pnpm smoke:player             # the same journey in real browsers (needs web + server)
```

`CARDFORGE_TEST_DATABASE_URL` runs the persistence contract tests against
Postgres as well as the in-memory adapter.

## Production

- [docs/deployment.md](docs/deployment.md) — Docker images, production compose,
  Coolify setup, staging, migrations, backups, observability.
- [docs/auth.md](docs/auth.md) — sessions, Discord OAuth, room tickets, admin
  boundary, and migrating alpha accounts.
- [docs/architecture.md](docs/architecture.md) — engine and service boundaries.

## Workspace

```text
apps/web                    Next.js player client, Pixi battlefield, dev tools
apps/match-server           API, auth, Colyseus rooms, settlement, telemetry
apps/simulator              CLI, bots, invariants, replay verification, matrix
packages/persistence        PostgreSQL schema, migrations, storage contract
packages/card-schema        Semantic card, ability, format, and theme contracts
packages/content-core-set   Versioned semantic core-set source pack
packages/content-tools      Pack compiler, CSV import, linting, SVG previews
packages/rules-kernel       Commands, events, game state, PRNG, hashing
packages/rules-tempofront   TempoFront rules, cards, glossary, rules text
packages/competitive        Seasons, Elo rating, rank tiers, progression, telemetry
packages/economy            Shards, Style Tokens, crafting, rewards policy
packages/training           Academy tutorials and PvE scenarios
packages/live-ops           Additive live-ops revisions, quests, events, flags
packages/theme-default      Aetherfront fantasy presentation pack
packages/theme-test-scifi   Orbital Conflict science-fiction presentation pack
```

## Engineering principles

Server authority; deterministic state with seeded RNG and canonical hashes;
exact replays; immutable content revisions and balance patches;
hidden-information projections; typed card effects with no user scripts;
presentation that can never gate or alter rules; theme terminology outside the
kernel; strict validation at every external boundary; idempotent rewards and
settlements; and never trusting a client to report results or rewards.

## Milestone history

### Milestone 1 — deterministic engine

#### Implemented rules slice

- three Fronts with Vanguard and Support slots;
- Focus ramp from three to eight;
- shared Time priority with alternating tie Initiative;
- Entity deployment, spent/ready state, Strikes, and adjacent Shifts;
- melee and Ranged targeting with simultaneous retaliation;
- persistent damage, Armor, Barrier, and batch defeat checks;
- Presence scoring, Dominion victory, Integrity victory, and escalating fatigue;
- typed Tactic effects for damage, healing, movement, spawning, salvage, and scouting;
- deployment and defeat triggers;
- serializable Main Action, Response, and Counter-Response windows;
- reverse-order chain resolution with immediate Tempo Debt;
- a bounded effect/trigger queue and publish-time content limits;
- resumable, replayed `PendingChoice` commands with private option projection;
- interactive Scout selection and optional Focus payment branches;
- deterministic Barrier-before-Armor damage replacement ordering;
- authoritative simultaneous setup with one deterministic mulligan per player;
- format validation for deck size, copy limits, generated cards, and minimum Entities;
- set rotation, ban-list, Leader Aspect identity, and Leader subtype restrictions;
- deterministic release-state and date-window legality;
- structured Stunned, Rooted, Silenced, Exposed, and Protected statuses;
- playable Prepare/Reserve, Attachment, Relic, and shared Site zones;
- Leader Commands and persistent-card activations through the normal Response pipeline;
- modal and bounded multi-target choices recorded as commands;
- deterministic rules-text generation with theme terminology overrides;
- selected Format, Leader, content, and ruleset revisions pinned in replay state;
- 40-card proof decks and a semantic content fixture covering every fundamental interaction;
- property-based seed coverage and JSON round-trip replay verification.

#### Milestone 1 verification

- 24 focused and property-based tests pass.
- A 1,000-game batch over seeds 7001–8000 completes without an invariant failure.
- All 1,000 command logs reproduce their exact final state hash.
- Matches average 11.62 Cycles, 185 commands, 3.61 Reactions, and 7.55 resolved choices.
- The bot win split is 519–481. These bot numbers are regression telemetry, not a balance verdict.

#### Deferred at Milestone 1

Redirect and set-value replacements and player-ordered simultaneous
triggers remain deferred; simultaneous triggers use the documented
deterministic order. (Accounts, persistence, ranked play, and launch content
were delivered in later milestones.)

### Milestone 2 — browser client

The first browser slice is now runnable in `apps/web`:

- Next.js App Router and React 19 application shell;
- production TempoFront engine running directly in the browser;
- browser-safe synchronous SHA-256 with hashes identical to the Node runtime;
- PixiJS WebGL battlefield with semantic Front, Site, and slot presentation;
- event-driven Pixi traces, target rings, and DOM callouts for deployment, movement, combat, protection, defeat, Front control, Dominion, and victory;
- DOM resource HUD, Timeline, card hand, inspector, legal-action rail, and event stream;
- projected Time costs before action confirmation;
- deterministic bot opponent and mulligan handoff;
- local hot-seat mode with explicit private handoff locks and viewer-relative board rotation;
- four selectable dual-Aspect Leaders with distinct executable Commands and legal forty-card starter decks;
- a complete sixty-card prototype pool across all six Aspects, excluding internal proof fixtures;
- complete headless match and exact replay coverage for every prototype Leader;
- an auto-opening four-concept Field Guide with scored Timeline, Front-control, Response, and victory checks stored only for the browser session;
- keyboard-operable legal actions and screen-reader board summaries;
- reduced-motion, Skip FX, and responsive layouts; presentation never gates engine resolution;
- production build, HTTP smoke, screenshot review, and CDP interaction smoke.

The local match lab now lives at `/lab`. Hot-seat privacy is designed for two people sharing one
device: the hand and controls are blanked during every priority transfer, but
the full local state still exists in browser memory. Server-projected secrecy
arrives with online play in Milestone 3.

The sixty-card Milestone 2 content target is complete: four Leaders, twenty-nine
Entities, fifteen Tactics, five Reactions, three Attachments, two Relics, and two
Sites. The internal all-Aspect proof Leader and generated Token are excluded.

Milestone 2 implementation is complete. The remaining exit gate is an external
new-player running the Field Guide and a match without developer coaching,
followed by any clarity fixes that observation exposes.

### Milestone 3 — authoritative online alpha

`apps/match-server` now provides the first authoritative online boundary:

- a transport-independent match session owns the complete deterministic state;
- two connection IDs receive stable server-assigned seats;
- clients submit strict Zod-validated intent payloads without `playerId`;
- the server injects seat identity and rejects forged, malformed, or illegal commands;
- every accepted intent is recorded into an exact production replay;
- each connection receives its own projected state with the opponent hand omitted;
- private choice results are redacted from the opposing event stream;
- Colyseus 0.17 rooms expose an explicit ready handshake, snapshot stream, command errors, and a thirty-second reconnect window;
- real two-client network smoke verifies shared hashes and separate private hands;
- `/online` joins live matchmaking, renders only the seat projection, displays server-approved intents, and reports connection/reconnect state;
- a two-browser Chromium smoke proves opposite seats, private five-card hands, synchronized command numbers, and matching authoritative hashes;
- server-owned thirty-second action clocks expose synchronized deadlines without entering deterministic game state;
- timed-out seats submit a deterministic legal fallback—empty mulligan, passed Response, passed Cycle, or the first bounded choice—and that command remains replayable.
- PostgreSQL migrations persist account-scoped decks and searchable match records with exact replay JSONB;
- every room is stored at creation and after accepted commands, and stored replays restore to the same canonical hash;
- alpha account and deck APIs validate scope, payloads, Format legality, Leader identity, and forty-card lists server-side;
- the browser provisions a starter deck, lists saved decks, and sends the selected deck IDs to matchmaking;
- two accounts may safely use the same human-friendly deck ID because storage identity is `(account_id, deck_id)`;
- a live selected-deck smoke proves distinct stored Leaders enter the same room and a process-independent restore reproduces their shared hash.

Configure the action deadline with `CARDFORGE_ACTION_CLOCK_MS`.

For durable local development, run `docker compose up -d postgres`, copy the
values from `.env.example`, and start the match server with `DATABASE_URL` set.
Without that variable the server deliberately uses an in-memory test adapter.
(The M3 alpha account header was replaced by verified authentication in M7.)

### Milestone 4 — content factory and rebrand proof

The content-factory foundation is now executable:

- Zod runtime schemas validate cards, recursive typed effects, abilities, content manifests, and themes;
- every prototype definition carries a Set ID and immutable publication metadata;
- the core pack compiles 120 collectible/Leader cards plus its generated Token;
- compilation rejects duplicate IDs, undeclared Sets, illegal effect graphs, missing generated Tokens, missing dependencies, and dependency cycles;
- spreadsheet CSV rows import through the same authoritative card schema;
- generated rules text and accessible SVG card previews consume theme terminology and palette tokens;
- Aetherfront and Orbital Conflict provide complete terms, frames, icons, board, animation, audio, event, reduced-motion, and palette mappings;
- both themes compile from one gameplay pack with an identical gameplay hash and distinct presentation hashes.

The browser now completes the rebrand proof:

- `/studio` provides searchable content, structured graph editing, publication stages, validation, generated text, theme-aware SVG preview, and revision diff;
- a global Theme Pack switch updates the match lab, online room, Field Guide, semantic event text, resource labels, DOM palette, and Pixi cue colors;
- a browser smoke changes Aetherfront to Orbital Conflict while the gameplay hash stays fixed, the presentation hash changes, and generated text uses `Scrapyard` rather than an engine-owned term;
- the live match smoke verifies `Power`, `Sector Control`, and `Sector` replace the corresponding semantic terms without rebuilding or mutating the rules kernel;
- reusable procedural recipes and reduced-motion alternatives are recorded in `docs/game-studio/spec.md`.

Milestone 5 is next: six mono-Aspect Leaders, a 120-card competitive pool,
ranked seasons, analytics, balance telemetry, patches, and starter progression.

### Milestone 5 — competitive beta

The competitive content target is now executable:

- the production-facing pool contains exactly 120 cards plus its generated Token;
- twelve Leaders cover all six mono-Aspect archetypes and the six planned dual-Aspect archetypes;
- every Leader has a legal forty-card starter deck pinned to its Aspect identity;
- all twelve starter matchups complete through the deterministic simulator and replay through the production engine;
- the browser exposes all twelve Leaders and Card Studio compiles 121 definitions under both complete Theme Packs.
- a pure competitive domain pins seasons to immutable patch and Format revisions, calculates Elo-style ratings, grants account and Aspect mastery, unlocks Leaders through deterministic starter progression, and aggregates replay-derived balance telemetry.
- PostgreSQL stores seasonal profiles and replay-derived telemetry, while one transaction locks both competitors and makes rating, XP, mastery, unlocks, telemetry, and the settlement receipt idempotent by match ID.
- `tempofront-ranked` is a distinct authoritative queue requiring saved legal decks, different accounts, the active season, and an unlocked Leader; its snapshots identify the queue and carry the server settlement.
- `/competitive` displays the live season lock, profile progression, victory routes, Initiative rate, action volume, and per-Leader performance directly from server APIs, with explicit low-sample caution.

The remaining competitive-beta gate is evidence rather than another feature:
run larger archetype simulations and collect external playtest telemetry before
claiming Initiative neutrality, broad archetype viability, or zero recurring
rules confusion.

The automated gate now includes a seat-swapped 12×12 archetype matrix. A fixed
576-game run verified every replay, produced a 47.57% starting-Initiative win
rate, averaged 10.55 Cycles, and split wins between 212 Integrity and 364
Dominion finishes. Its first pass exposed severe Bastion/Force and Motion
outliers; immutable balance patch `tempofront-competitive-2` revised twenty-one
cards and narrowed the heuristic Leader range to 36.46–66.67%. Those bot rates
are regression evidence, not a substitute for skill-banded human playtests.

Milestone 5 engineering is complete. External usability and competitive balance
validation remain release gates while Milestone 6 launch systems are built.

### Milestone 6 — launch systems

The launch content contract is complete:

- exactly 180 production cards: 12 Leaders, 90 Entities, 32 Tactics, 18 Reactions, 12 Attachments, 6 Relics, and 10 Sites;
- exactly 168 collectibles split into 72 Common, 48 Uncommon, 32 Rare, and 16 one-copy Unique cards;
- each of the six Aspects and Neutral has exactly 24 collectible cards;
- every production card has a unique three-digit collector number plus generated budget and complexity metadata;
- all twelve existing starter decks remain legal, all fifty tests pass, and browser smoke compiles 181 definitions including the generated Token under both themes.

The remaining launch systems then landed: an auditable Shards/Style Tokens
economy with idempotent crafting and cosmetic unlocks, the collection vault,
five deterministic tutorials and three PvE challenges run by an authoritative
training room with once-only rewards, published live-ops definitions (quests,
events, feature flags), and persisted support cases with an append-only audit
log behind an operations console.

### Milestone 7 — production alpha

M7 turned the framework into a game a stranger can pick up. Summary (details
in [docs/m7-roadmap.md](docs/m7-roadmap.md)):

- **Authentication** — email/password (scrypt) and Discord OAuth; hashed
  opaque session cookies; five-minute HMAC tickets for room joins; admin role
  and operator token for operations; one-time claim codes for alpha accounts.
  The `X-CardForge-Account-Id` header and all `/api/accounts/:id` routes are
  gone; player data lives under `/api/me`.
- **Player journey** — onboarding (starter Leader, Field Guide, practice
  match), Home with rank, level, quests, events, and recent matches; Play menu
  (Casual, Ranked, Vs Friend with `/join/CODE`, Practice, Academy);
  deckbuilder with filters, ownership, legality, and drafts; collection
  crafting; match history; replay viewer; rules reference; profile.
- **Match UX** — legal-target highlighting, target lines, drag-and-drop or
  tap-to-target, Time and Focus previews on every action, Response and choice
  prompts, clocks, concession, result screens with rewards, automatic
  reconnect after a reload, and scaling for tablet, Steam Deck, and landscape
  phones. Everything is derived from server-listed legal intents.
- **Server** — rooms require legal, owned decks with unlocked Leaders; record
  participants, outcomes, and server-derived per-seat stats; end matches by
  concession or by abandonment after a 60-second reconnect window; settle
  rating and rewards exactly once; serve verified replay frames without ever
  exposing seeds or hidden cards.
- **Content and live ops** — a canonical keyword/status glossary drives
  tooltips, the rules reference, and generated rules text; rank tiers
  (Bronze → Master) wrap the unchanged Elo rating; live ops gained an
  additive revision with current events, and expired events are no longer
  shown as live.
- **Operations** — structured JSON logs with request and match IDs,
  credential redaction, `critical` alerts for integrity failures, `/health`,
  `/ready`, Prometheus `/metrics`, and a playtest dashboard where every rate
  carries its sample size and a caution level.
- **Delivery** — one Dockerfile (web and match-server targets), production
  compose with health-gated startup, Coolify guide, and GitHub Actions for PRs
  (tests, 50-game simulation, build, server and browser smokes, image build),
  `main` (matrix, GHCR images, staging deploy and smoke), and nightly
  simulation.

Fixed along the way: targeted Reactions could never be played online (the wire
schema dropped their targets), and the API echoed `Access-Control-Allow-Origin`
with credentials for unlisted origins, including `null`.

Still open before a public launch: observing real first-session players (the
funnel is now instrumented), skill-banded balance evidence from human matches,
multi-replica scaling (Redis presence for Colyseus), email verification and
password reset, and production art.
