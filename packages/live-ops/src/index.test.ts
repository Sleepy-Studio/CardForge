import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { launchLiveOps, stageLiveOps, validateLiveOps } from "./index.js";

void describe("launch live operations", () => {
  void it("publishes valid quests, events, and conservative feature flags", () => {
    assert.deepEqual(validateLiveOps(launchLiveOps), []);
    assert.equal(launchLiveOps.quests.length, 5);
    assert.equal(launchLiveOps.events.length, 2);
    assert.equal(launchLiveOps.featureFlags["economy.trading"], false);
  });

  void it("requires monotonic revisions for staged changes", () => {
    assert.equal(stageLiveOps(launchLiveOps, 2).state, "staged");
    assert.throws(() => stageLiveOps(launchLiveOps, 1), /must increase/);
  });
});
