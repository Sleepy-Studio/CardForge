# Milestone 0 architecture

## Kernel boundary

The kernel owns deterministic machinery: match state, card instances, player-intent commands, semantic events, seeded RNG, canonical serialization, state hashes, replay records, and hidden-information views. It contains no themed terminology and no browser concerns.

TempoFront owns board topology, timeline priority, Focus, combat, cycle scoring, victory conditions, and interpretation of the current typed effect operators.

Card definitions are immutable content. A logical card ID and revision produce match-local card instances. Replays pin the ruleset revision and content hash, then store accepted commands and the expected final state hash.

## Command pipeline

```text
Command
  -> timeline and legality validation
  -> immutable state clone
  -> semantic event generation
  -> state reduction
  -> batch defeat processing
  -> victory/state checks
  -> cycle transition when both players lock
  -> canonical state hash
```

Replacement effects, response windows, pending choices, and a general trigger queue are intentionally the next cut. They need explicit pending-state types rather than clever recursion inside card effects.

## Bias and scope note

The product brief naturally pulls toward a complete monorepo and polished UI. That is the wrong proof. The main architectural risk is nondeterministic, unbounded card behavior; therefore this slice tests the rules seam under repeated complete games before application infrastructure is introduced.

## Next cut: Milestone 1

1. Add a `PendingAction` state machine for Main Action, Response, Counter-Response, and reverse resolution.
2. Replace direct effect iteration with an explicit bounded effect and trigger queue.
3. Add `PendingChoice`, choice commands, replacement effects, and operator publication limits.
4. Implement mulligan, Prepare/Reserve, Attachments, Relics, Sites, and full deck validation.
5. Generate localized rules text from the same ability graph used by the engine.
6. Grow property-based tests around damage batches, zone ownership, response depth, and effect limits.

Only after those invariants hold should the browser renderer become the critical path.
