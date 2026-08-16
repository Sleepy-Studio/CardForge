import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stateHash } from "@cardforge/rules-kernel";
import { proofDeck, TempoFrontEngine } from "@cardforge/rules-tempofront";
import { runBatch, simulateGame, verifyReplay } from "./simulation.js";

void describe("TempoFront deterministic proof", () => {
  void it("creates identical initial states from identical inputs", () => {
    const engine = new TempoFrontEngine();
    const input = {
      matchId: "same",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    } as const;
    assert.equal(
      stateHash(engine.createGame(input)),
      stateHash(engine.createGame(input)),
    );
  });

  void it("replays a complete match to the exact final hash", () => {
    const result = simulateGame(8675309);
    assert.notEqual(result.finalState.winner, null);
    assert.doesNotThrow(() => verifyReplay(result));
  });

  void it("keeps hidden hands out of opponent projections", () => {
    const engine = new TempoFrontEngine();
    const state = engine.createGame({
      matchId: "views",
      seed: 7,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const view = engine.projectView(state, "p1");
    assert.equal(view.players.p1.hand?.length, 5);
    assert.equal(view.players.p2.hand, undefined);
    assert.equal(view.players.p2.handCount, 5);
  });

  void it("completes and verifies a varied simulation batch", () => {
    const summary = runBatch(100, 1000);
    assert.equal(summary.p1Wins + summary.p2Wins, 100);
    assert.equal(summary.integrityWins + summary.dominionWins, 100);
  });
});
