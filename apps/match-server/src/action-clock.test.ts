import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ActionClock } from "./action-clock.js";

void describe("action clock", () => {
  void it("preserves an existing simultaneous deadline when another seat acts", () => {
    let now = 1_000;
    const clock = new ActionClock(30_000, () => now);
    clock.reconcile(["p1", "p2"]);
    now = 5_000;
    clock.reconcile(["p2"]);
    assert.deepEqual(clock.snapshot().deadlines, {
      p1: null,
      p2: 31_000,
    });
  });

  void it("reports expiry and starts a fresh deadline for a newly active seat", () => {
    let now = 10;
    const clock = new ActionClock(100, () => now);
    clock.reconcile(["p1"]);
    now = 110;
    assert.deepEqual(clock.expiredPlayers(), ["p1"]);
    clock.reconcile(["p2"]);
    assert.deepEqual(clock.snapshot().deadlines, { p1: null, p2: 210 });
  });
});
