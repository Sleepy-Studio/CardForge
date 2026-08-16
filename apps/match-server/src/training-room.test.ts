import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseTrainingBotCommand } from "./training-room.js";

void describe("training bot policy", () => {
  void it("mulligans deterministically and prefers actions over passing", () => {
    const mulligan = {
      type: "mulligan",
      playerId: "p2",
      instanceIds: [],
    } as const;
    assert.equal(chooseTrainingBotCommand([mulligan]), mulligan);
    const pass = { type: "pass", playerId: "p2" } as const;
    const play = {
      type: "play_card",
      playerId: "p2",
      instanceId: "p2-1",
      front: "left",
      slot: "vanguard",
    } as const;
    assert.equal(chooseTrainingBotCommand([pass, play]), play);
  });
});
