import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stateHash } from "@cardforge/rules-kernel";
import {
  createTrainingGame,
  trainingScenarios,
  validateTrainingScenarios,
} from "./index.js";

void describe("training and PvE catalog", () => {
  void it("publishes five tutorials and three PvE challenges", () => {
    assert.equal(validateTrainingScenarios().length, 0);
    assert.equal(
      trainingScenarios.filter((item) => item.kind === "tutorial").length,
      5,
    );
    assert.equal(
      trainingScenarios.filter((item) => item.kind === "pve").length,
      3,
    );
  });

  void it("creates deterministic modified starting states", () => {
    for (const scenario of trainingScenarios) {
      const first = createTrainingGame(scenario, {
        matchId: scenario.scenarioId,
        seed: 42,
      });
      const second = createTrainingGame(scenario, {
        matchId: scenario.scenarioId,
        seed: 42,
      });
      assert.equal(stateHash(first), stateHash(second));
      assert.equal(first.players.p1.leader.cardId, scenario.playerLeaderId);
      assert.equal(first.players.p2.leader.cardId, scenario.opponentLeaderId);
    }
  });
});
