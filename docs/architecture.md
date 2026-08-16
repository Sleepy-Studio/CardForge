# Milestone 1 engine architecture

Milestone 1 is complete at TempoFront revision `tempofront@0.6.0`. The scope is
an authoritative, deterministic headless engine vertical slice—not a browser
prototype or production content platform.

## Kernel boundary

The kernel owns deterministic machinery: match state, card instances, player-intent commands, semantic events, seeded RNG, canonical serialization, state hashes, replay records, and hidden-information views. It contains no themed terminology and no browser concerns.

TempoFront owns board topology, timeline priority, Focus, combat, cycle scoring, victory conditions, and interpretation of the current typed effect operators.

Card definitions are immutable content. A logical card ID and revision produce match-local card instances. Replays pin the ruleset revision and content hash, then store accepted commands and the expected final state hash.

## Command pipeline

```text
Command
  -> timeline and legality validation
  -> commit Focus, Time, and source state
  -> serializable PendingAction
  -> Defender Response or pass
  -> Acting-player Counter-Response or pass
  -> reverse-order chain resolution
  -> bounded effect and trigger queue
  -> batch defeat and victory checks
  -> cycle transition when both players lock
  -> canonical state hash
```

The chain has a hard depth of two reactions. A passed player may still respond, and each Reaction commits its Focus and Tempo Debt when declared. The pending chain is match state, so reconnects and replays do not depend on process-local callbacks.

Effects resolve through an explicit FIFO queue. An ability may publish at most 16 effects, at most 64 effects may wait at once, and no command may resolve more than 128 effects. Content that violates static limits is rejected when the engine loads it; runtime limits remain a final defense against cross-card recursion.

## Resumable choices

Effects may suspend resolution by creating `PendingChoice`. The chooser submits a normal validated `resolve_choice` command, so the decision is preserved in the replay log. Scout removes its candidate cards from the deck while the choice is pending, exposes the card options only to the chooser, then puts unselected cards on the bottom in deterministic order.

Optional Focus branches use the same mechanism. Paying prepends the gated effects ahead of later queued effects; declining discards the continuation. Choice state and the remaining queue survive the command boundary without process-local callbacks.

## Damage replacement order

Entity damage collects prevention in a fixed order. Barrier consumes and prevents the complete instance first. Armor applies only when damage remains. Semantic `damage_replaced` events record which rule applied and how much it prevented before the final `damage_dealt` event.

## Setup and deck validation

Games begin in an explicit `mulligan` phase. Either player may submit once; normal timeline commands remain illegal until both submissions arrive. Selected cards are removed from hand, replacements are drawn from the remaining deck, and only then are rejected cards shuffled back using the match RNG. Both submissions and completion are semantic replay events.

Deck validation runs before instances are created or shuffled. The selected Format enforces exact size, ordinary and Unique copy limits, per-card overrides, generated/Leader exclusion, known definitions, and the minimum Entity count. Invalid decks fail with all discovered reasons rather than the first convenient complaint.

Formats may additionally declare legal set IDs and banned card IDs. When a Leader is supplied, every non-Neutral Aspect on every card must belong to that Leader's identity. Leaders may also require a minimum number of cards sharing a subtype. These checks remain pure content validation, so they can run in deckbuilders, publication tools, matchmaking, and the authoritative match service without constructing a match.

Release legality is also deterministic. Formats pin an effective `YYYY-MM-DD`
date and allowed publication states; validation never consults the server clock.
Matches pin the selected Format ID and revision alongside rules and content.

## Persistent zones and Commands

Players now have a Leader, one Reserve slot, and two Relic slots. Fronts have a
shared Site slot, and Entities own their attached card instances. Prepare moves
an eligible card into Reserve for one Time; playing it that Cycle applies its
printed discount, while unused cards return at refresh. Attachments follow a
defeated host to their owners' discard piles, and a newly played Site replaces
the existing Site.

Leader Commands and activated Relic or Entity abilities use the same declared
action and bounded Response pipeline as other main actions. Once-per-Cycle use
is serializable match state and resets at refresh.

## Statuses and choices

Status instances record semantic ID, source, integer value, duration, and
stacking policy. The first executable pool covers Stunned, Rooted, Silenced,
Exposed, and Protected. Status behavior is enforced by legal-command generation,
damage replacement, keyword evaluation, and refresh expiration.

The choice state machine now supports private card selection, optional costs,
two-or-three-mode effects, and bounded multi-target selections. Every selection
is an accepted command. Simultaneous mandatory triggers retain the fixed active-
player ordering from the rules contract; manual trigger ordering is deferred to
a later rules module instead of being smuggled into the base game.

## Generated rules text

Supported ability graphs generate display text through semantic templates. A
terminology override can rename Focus, Leader, Entity, and zones without putting
theme strings in engine behavior. The graph remains authoritative.

## Verification baseline

Twenty-four focused and property-based tests pass. Replays survive JSON
serialization and reconstruct through a fresh engine instance. A 1,000-game
batch over seeds 7001–8000 completed with 1,000 exact final hashes and no
invariant failure. It averaged 11.62 Cycles, 185 commands, 3.61 Reactions, and
7.55 choices; the 519–481 win split is regression telemetry rather than proof
of competitive balance.

## Bias and scope note

The product brief naturally pulls toward a complete monorepo and polished UI. That is the wrong proof. The main architectural risk is nondeterministic, unbounded card behavior; therefore this slice tests the rules seam under repeated complete games before application infrastructure is introduced.

## Milestone 2 browser slice

Milestone 2 is in progress. `apps/web` is a Next.js App Router client that runs
the production TempoFront engine locally. PixiJS renders board geometry and
pointer hit targets through WebGL; React/DOM owns the Timeline, resources, hand,
generated rules text, card inspector, legal actions, event history, and screen-
reader state. Animations do not gate command resolution.

The rules kernel now hashes with a synchronous browser-safe SHA-256 package.
A fixed digest test proves byte-for-byte compatibility with the former Node
implementation, preserving replay hashes. The deterministic browser bot submits
the same legal intent commands as a human client.

Local hot-seat play also uses the same command path. The revealed viewer is
always rendered at the bottom of the Pixi board. When priority changes players,
React immediately removes the previous hand and legal controls, then covers the
field with an explicit pass-device screen until the next seat is revealed.
This protects ordinary over-the-table hidden information, but it is not a
security boundary: the local browser process still owns the complete match
state. Online play must render server-projected views instead.

The browser match setup now selects from four dual-Aspect Leaders. Each Leader
has an executable once-per-Cycle Command and a dedicated legal forty-card deck:
Force/Bastion Siege, Motion/Cunning Ambush, Growth/Entropy Reclamation, and
Force/Motion Raid. Sixteen low-complexity foundation cards make those identities
legal without relaxing the three-copy limit. Match creation pins the selected
Leader IDs and supplies the corresponding decks to the production engine.
Headless coverage completes and exactly replays a match involving every Leader,
in addition to focused tests for all four Commands and starter-deck legality.

The production-facing prototype pool is exactly sixty cards. The final content
cut adds twelve Entities, two Reactions, two Attachments, one Relic, and one Site
because the earlier proof set already overrepresented Tactics. All four starters
use cards from the completed pool while retaining legal Aspect identities,
forty-card size, at least twelve Entities, and the three-copy ceiling. A content
contract test freezes the exact count, unique semantic IDs, fixture exclusions,
and type distribution.

Lab Build 05 adds a presentation adapter over accepted `GameEvent` batches.
Deployments, Shifts, Strikes, damage, prevention, defeats, cycle-end Front
control, Dominion, and victory produce typed visual cues. Pixi draws transient
source-to-target traces and board anchors while a DOM callout provides readable
semantic context. A new command can replace the cue immediately, Skip FX clears
it, and neither path can delay authoritative state. Reduced-motion preference is
honored inside Pixi as well as CSS. The engine now emits exact
`front_control_resolved` events with both Presence totals during scoring.

Lab Build 06 adds an auto-opening, keyboard-operable Field Guide. Four short
lessons teach and test the shared Timeline, Presence scoring, bounded Response
chain, and dual victory routes. Wrong answers explain the misconception;
correct answers advance the guide. Attempts and score remain in session storage
and appear on the Guide control after completion. No analytics leave the local
browser. Chromium completes the scored 4/4 path before running the existing
match, event-presentation, and hot-seat privacy smoke.

A production-browser smoke test drives Chromium through mulligan, bot handoff,
card selection, inspection, legal-action discovery, and action resolution. It
then switches modes and verifies both hot-seat mulligans, hand blanking during
handoff, viewer rotation, a Main Action transfer, and the opposing Response
seat. It also verifies the Lab Build 05 marker, reduced-motion mode, a semantic
deployment cue reaching both DOM and Pixi, and Skip FX clearing that cue. The
first screenshot review confirms that all three Fronts and the Timeline remain
readable at 1440×1000.

The internal all-Aspect proof Leader and generated Token are not counted toward
the sixty-card prototype target. Milestone 2 implementation is complete. Its
remaining exit gate is an external new player completing the Field Guide and a
match without developer coaching, followed by any clarity fixes that observation
exposes. Kernel additions remain driven by concrete prototype requirements
rather than speculative universal-engine work.

## Authoritative online boundary

Milestone 3 begins in `apps/match-server`. `AuthoritativeMatchSession` is a
transport-independent owner for the production engine, full match state,
server-controlled seed, stable two-seat assignment, accepted command log, and
replay record. Raw payloads pass through a strict Zod discriminated union. The
wire format never accepts `playerId`; the session derives it from the connection
seat before asking the engine to validate and apply the command.

Each update is projected separately for each connection. Opponent hands remain
absent, private choice identifiers are redacted, and both projections carry the
same canonical full-state hash and command number. Network transport cannot
mutate state directly. A command error returns a bounded semantic code without
changing state.

`TempoFrontRoom` is a thin Colyseus 0.17 adapter. Clients join, register message
handlers, then send `ready` to receive their seat and initial snapshot. Accepted
commands produce viewer-specific snapshots for both seats. Unexpected drops
receive a thirty-second reconnection window and a successful reconnect rebuilds
the exact projected state. The standard WebSocket transport runs with its
promotional greeting disabled; its optional native MessagePack accelerator is
explicitly denied an install script, preserving the workspace supply-chain
policy and JavaScript fallback.

Focused session tests cover seat ownership, forged identity, illegal
no-mutation behavior, private projections, and exact replay. A real SDK smoke
connects two clients to the live room, completes the ready handshake, proves a
forged seat fails, submits a mulligan, and verifies matching hashes with separate
private hands.

The browser now consumes this boundary at `/online`. It joins or creates a room,
performs the explicit ready handshake, and renders the existing Pixi board from
`ProjectedGameView`; it never manufactures a full `GameState`. Every snapshot
includes legal seatless intents computed by the authoritative engine. The client
can submit one of those intents but cannot attach a player identity. Connection,
drop, automatic reconnect, command rejection, room ID, command number, and a
short canonical hash are visible in the UI.

A two-browser Chromium smoke launches independent profiles, joins one room as
opposite seats, verifies both projected private hands and the shared hash, then
submits the server-projected empty mulligan. Both clients advance from command
zero to one with a new identical hash. The server CORS policy permits only
configured browser origins. Durable match records, deck storage,
and saved-deck selection are implemented; production authentication remains.

Action deadlines live beside the match rather than inside `GameState`. The room
publishes server timestamps and per-seat deadlines, while the browser derives a
local countdown without trusting its own clock for enforcement. Expiry selects
an already legal deterministic fallback command and records it in the ordinary
command log. Wall time can therefore cause a command, but it cannot alter state
math, hashes, RNG, or replay semantics.

## Alpha persistence

`packages/persistence` defines one storage contract with in-memory and
PostgreSQL adapters. The PostgreSQL schema keeps accounts, decks, and ordered
deck cards relational. Match indexing fields are columns while the immutable
replay payload is JSONB. Migrations are versioned and transactional. Deck keys
are account-scoped, preventing two players' identically named starter deck IDs
from overwriting each other.

Rooms persist their replay at creation and after every accepted command. A
stored record reconstructs a new `AuthoritativeMatchSession` by replaying the
pinned seed, decks, Leaders, and commands, then rejecting the restore unless its
canonical hash matches. The selected-deck network smoke performs this recovery
through a separate database connection.

The current REST surface provides basic alpha account registration and
server-validated deck storage. `X-CardForge-Account-Id` prevents accidental
cross-account operations but is explicitly not an authentication credential.
Replacing it with verified identity is required before exposing the service to
untrusted users.

## Content factory and rebrand proof

The authoritative content boundary is `ContentPackSource`: a versioned manifest
and semantic card revisions. Zod validates recursive effect graphs at runtime;
the TempoFront publication linter then enforces engine limits and token
dependencies. The compiler emits generated rules text and a gameplay hash that
does not include presentation data. Spreadsheet rows enter through the same
schema rather than a second permissive import path.

Theme Packs are separately versioned and must provide every semantic term,
visual asset family, palette token, gameplay-event presentation recipe, audio
mapping, emphasis level, and reduced-motion alternative. Compilation resolves
themed card views and produces a separate presentation hash. Aetherfront and
Orbital Conflict compile over one gameplay pack with the same gameplay hash.

The browser's global theme provider applies those manifests to the match lab,
online room, Field Guide, generated text, DOM tokens, and Pixi cue palette.
`/studio` exposes the pack library, structured JSON graph draft, publication
workflow, compiler feedback, theme-aware SVG card preview, checks, and revision
diff. Browser smoke changes the entire live vocabulary from Aetherfront to
Orbital Conflict without importing a Theme Pack into the rules kernel.

## Competitive content boundary

The competitive-beta pack contains 120 deck-facing cards: twelve Leaders,
sixty-one Entities, twenty-one Tactics, eleven Reactions, six Attachments, six
Relics, and three Sites. Its generated Token remains outside deck legality. Six
mono-Aspect Leaders and six dual-Aspect Leaders map to the twelve launch
archetypes; each ships with a legal forty-card starter deck. The same immutable
definitions feed deck validation, simulation, browser play, match rooms, Card
Studio compilation, and both Theme Packs.

`packages/competitive` owns ladder arithmetic outside the match kernel. Season
definitions pin one Format revision and one immutable balance patch. Ranked
settlement calculates ratings, account experience, Aspect mastery, and Leader
unlocks from explicit match inputs. Telemetry derives action, Reaction, choice,
victory-route, cycle, Initiative, and per-Leader metrics from accepted command
records, keeping the dashboard reproducible rather than client-reported.

The competitive persistence migration stores seasonal profiles, indexed ladder
ratings, replay-derived telemetry, and one settlement receipt per match. Ranked
completion locks both profiles in a PostgreSQL transaction, calculates the
settlement from their current ratings, writes progression and telemetry, and
commits the receipt together. A repeated completion attempt returns no award.
The in-memory adapter implements the same contract for tests and local work.
