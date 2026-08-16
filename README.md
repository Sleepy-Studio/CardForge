# CardForge

CardForge is a deterministic, rebrandable web TCG framework. This repository contains the completed **Milestone 1 engine**, **Milestone 2 browser implementation**, and **Milestone 3 authoritative online alpha** for its reference game, TempoFront.

The proof is intentionally headless. It establishes the expensive invariants before UI work begins:

- server-shaped commands express player intent rather than outcomes;
- game state uses integer math and seeded randomness;
- cards use typed ability data rather than executable scripts;
- card definitions, match instances, and revisions are distinct;
- public/private projections hide opponent hands;
- every accepted command is replayable through the production engine;
- canonical state hashes expose any deterministic divergence;
- random legal-action simulations assert invariants after every command.

## Run it

Requires Node.js 22 or newer and pnpm.

```bash
pnpm install
pnpm build
pnpm test
pnpm sim --games 1000 --seed 1
```

The simulator runs complete matches, immediately replays each command log, and fails if any final state hash differs.

## Workspace

```text
apps/simulator              CLI, random bot, invariants, replay verification
apps/web                    React/Next application shell and Pixi match client
apps/match-server           Authoritative sessions and Colyseus room transport
packages/persistence       PostgreSQL schema, migrations, and storage contracts
packages/card-schema       Semantic card, ability, format, and theme contracts
packages/content-core-set  Versioned semantic core-set source pack
packages/content-tools     Pack compiler, CSV import, linting, and SVG previews
packages/rules-kernel      Commands, events, game state, PRNG, canonical hashing
packages/rules-tempofront  TempoFront rules, proof cards, and rules engine
packages/theme-default     Aetherfront fantasy presentation pack
packages/theme-test-scifi  Orbital Conflict science-fiction presentation pack
```

## Implemented rules slice

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

## Milestone 1 verification

- 24 focused and property-based tests pass.
- A 1,000-game batch over seeds 7001–8000 completes without an invariant failure.
- All 1,000 command logs reproduce their exact final state hash.
- Matches average 11.62 Cycles, 185 commands, 3.61 Reactions, and 7.55 resolved choices.
- The bot win split is 519–481. These bot numbers are regression telemetry, not a balance verdict.

## Deliberately deferred

Accounts, durable match/deck persistence, ranked matchmaking, complete keyword/status vocabulary, redirect and set-value replacements, player-ordered simultaneous triggers, full publication tooling, and launch content remain deferred. Simultaneous triggers use the documented deterministic order for this slice; manual ordering is intentionally not required by the Milestone 1 rules contract.

See [docs/architecture.md](docs/architecture.md) for boundaries and the next implementation cut.

## Milestone 2 progress

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

Run it with `pnpm dev`. Hot-seat privacy is designed for two people sharing one
device: the hand and controls are blanked during every priority transfer, but
the full local state still exists in browser memory. Server-projected secrecy
arrives with online play in Milestone 3.

The sixty-card Milestone 2 content target is complete: four Leaders, twenty-nine
Entities, fifteen Tactics, five Reactions, three Attachments, two Relics, and two
Sites. The internal all-Aspect proof Leader and generated Token are excluded.

Milestone 2 implementation is complete. The remaining exit gate is an external
new-player running the Field Guide and a match without developer coaching,
followed by any clarity fixes that observation exposes.

## Milestone 3 complete

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

Run `pnpm dev:server` for the room service on port 2567 and `pnpm smoke:server`
to exercise it. With the web server running, `pnpm smoke:online` drives two
independent browser clients. Configure the action deadline with
`CARDFORGE_ACTION_CLOCK_MS`.

For durable local development, run `docker compose up -d postgres`, copy the
values from `.env.example`, and start the match server with `DATABASE_URL` set.
Without that variable the server deliberately uses an in-memory test adapter.
The alpha account header is a scope boundary, not production authentication;
real identity-provider integration remains a launch hardening task.

## Milestone 4 complete

The content-factory foundation is now executable:

- Zod runtime schemas validate cards, recursive typed effects, abilities, content manifests, and themes;
- every prototype definition carries a Set ID and immutable publication metadata;
- the core pack compiles sixty collectible/Leader cards plus its generated Token;
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
