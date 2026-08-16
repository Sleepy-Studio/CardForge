import type { ReplayRecord } from "@cardforge/rules-kernel";

export function persistenceTestReplay(matchId: string): ReplayRecord {
  return {
    replayVersion: 1,
    matchId,
    seed: 42,
    rulesetRevision: "tempofront@1",
    formatId: "standard",
    formatRevision: 1,
    contentHash: "sha256:test-content",
    decks: { p1: [], p2: [] },
    leaders: { p1: "leader.one", p2: "leader.two" },
    acceptedCommands: [],
    finalStateHash: "sha256:test-state",
  };
}
