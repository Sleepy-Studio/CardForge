# CardForge

CardForge is a deterministic, rebrandable web TCG framework. This repository currently contains the **Milestone 0 rules proof** for its reference game, TempoFront.

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
- 40-card proof decks and a semantic 20-card-plus-token content fixture.

## Deliberately deferred

General modal and multi-target choices, redirect/set-value replacement effects, release-date legality, attachments, Relic/Site board zones, full keyword/status pools, rules-text generation, and full publication tooling remain deferred. Their schema seams are present, but pretending they are implemented would be dishonest.

See [docs/architecture.md](docs/architecture.md) for boundaries and the next implementation cut.
