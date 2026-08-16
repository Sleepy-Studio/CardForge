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

## Bias and scope note

The product brief naturally pulls toward a complete monorepo and polished UI. That is the wrong proof. The main architectural risk is nondeterministic, unbounded card behavior; therefore this slice tests the rules seam under repeated complete games before application infrastructure is introduced.

## Next cut

1. Add `PendingChoice`, choice commands, and optional costs.
2. Add replacement-effect ordering and broader trigger collection.
3. Implement mulligan, Prepare/Reserve, Attachments, Relics, Sites, and full deck validation.
4. Generate localized rules text from the same ability graph used by the engine.
5. Grow property-based tests around damage batches, zone ownership, response legality, and effect limits.

Only after those invariants hold should the browser renderer become the critical path.
