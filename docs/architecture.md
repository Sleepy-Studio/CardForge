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

A production-browser smoke test drives Chromium through mulligan, bot handoff,
card selection, inspection, legal-action discovery, and action resolution. The
first screenshot review confirms that all three Fronts and the Timeline remain
readable at 1440×1000.

Remaining Milestone 2 work is local hot-seat play, four production-style
Leaders, expansion to sixty cards, richer semantic event animation, and a
new-player comprehension pass. Kernel additions remain driven by those concrete
prototype requirements rather than speculative universal-engine work.
