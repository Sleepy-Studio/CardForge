# Milestone 1 interaction architecture

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

## Bias and scope note

The product brief naturally pulls toward a complete monorepo and polished UI. That is the wrong proof. The main architectural risk is nondeterministic, unbounded card behavior; therefore this slice tests the rules seam under repeated complete games before application infrastructure is introduced.

## Next cut

1. Add general modal, multi-target, and ordered-trigger choices.
2. Add release-state and date-based legality.
3. Add Prepare/Reserve, Attachments, Relics, and Sites.
4. Generate localized rules text from the same ability graph used by the engine.
5. Grow property-based tests around setup, damage batches, zone ownership, responses, choices, and effect limits.

Only after those invariants hold should the browser renderer become the critical path.
