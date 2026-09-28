import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autumnLiveOps,
  launchLiveOps,
  liveOpsCatalog,
  liveOpsWarnings,
  questPeriod,
  stageLiveOps,
  validateLiveOps,
  visibleEvents,
} from "./index.js";

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

void describe("additive live-ops revisions", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");

  void it("keeps the launch revision immutable and history-only", () => {
    assert.equal(launchLiveOps.revision, 1);
    assert.equal(launchLiveOps.events[0]!.endsAt, "2026-09-01T00:00:00.000Z");
    assert.deepEqual(visibleEvents(launchLiveOps, now), []);
    assert.ok(liveOpsWarnings(launchLiveOps, now).length > 0);
  });

  void it("publishes a valid additive revision with current events", () => {
    assert.deepEqual(validateLiveOps(autumnLiveOps), []);
    assert.deepEqual(
      liveOpsCatalog.map((definition) => definition.revision),
      [1, 2],
    );
    const events = visibleEvents(autumnLiveOps, now);
    assert.deepEqual(
      events.map((event) => [event.eventId, event.window]),
      [
        ["event.autumn-front", "active"],
        ["event.clockwork-gauntlet-2", "upcoming"],
      ],
    );
  });

  void it("computes UTC quest reset windows", () => {
    const season = { seasonId: "s1", startsAt: "2026-08-16T00:00:00.000Z", endsAt: "2026-11-16T00:00:00.000Z" };
    assert.deepEqual(questPeriod("daily", now, season), {
      periodKey: "d:2026-09-30",
      startsAt: "2026-09-30T00:00:00.000Z",
      endsAt: "2026-10-01T00:00:00.000Z",
    });
    // 2026-09-30 is a Wednesday; the week starts Monday 2026-09-28.
    assert.equal(questPeriod("weekly", now, season).periodKey, "w:2026-09-28");
    assert.equal(questPeriod("seasonal", now, season).periodKey, "s1");
  });
});
