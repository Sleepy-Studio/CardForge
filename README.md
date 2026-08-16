# CardForge

CardForge is a deterministic, rebrandable web TCG framework. This repository contains the completed **Milestone 1 engine vertical slice** for its reference game, TempoFront.

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
packages/card-schema       Semantic card, ability, format, and theme contracts
packages/rules-kernel      Commands, events, game state, PRNG, canonical hashing
packages/rules-tempofront  TempoFront rules, proof cards, and rules engine
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

The browser renderer, online match service, complete keyword/status vocabulary, redirect and set-value replacements, player-ordered simultaneous triggers, full publication tooling, and production content remain deferred. Simultaneous triggers use the documented deterministic order for this slice; manual ordering is intentionally not required by the Milestone 1 rules contract.

See [docs/architecture.md](docs/architecture.md) for boundaries and the next implementation cut.

## Milestone 2 progress

The first browser slice is now runnable in `apps/web`:

- Next.js App Router and React 19 application shell;
- production TempoFront engine running directly in the browser;
- browser-safe synchronous SHA-256 with hashes identical to the Node runtime;
- PixiJS WebGL battlefield with semantic Front, Site, and slot presentation;
- DOM resource HUD, Timeline, card hand, inspector, legal-action rail, and event stream;
- projected Time costs before action confirmation;
- deterministic bot opponent and mulligan handoff;
- local hot-seat mode with explicit private handoff locks and viewer-relative board rotation;
- four selectable dual-Aspect Leaders with distinct executable Commands and legal forty-card starter decks;
- a complete sixty-card prototype pool across all six Aspects, excluding internal proof fixtures;
- complete headless match and exact replay coverage for every prototype Leader;
- keyboard-operable legal actions and screen-reader board summaries;
- reduced-motion and responsive layouts;
- production build, HTTP smoke, screenshot review, and CDP interaction smoke.

Run it with `pnpm dev`. Hot-seat privacy is designed for two people sharing one
device: the hand and controls are blanked during every priority transfer, but
the full local state still exists in browser memory. Server-projected secrecy
arrives with online play in Milestone 3.

The sixty-card Milestone 2 content target is complete: four Leaders, twenty-nine
Entities, fifteen Tactics, five Reactions, three Attachments, two Relics, and two
Sites. The internal all-Aspect proof Leader and generated Token are excluded.

Milestone 2 is not complete yet. Richer semantic board animation and a real
new-player comprehension pass remain.
