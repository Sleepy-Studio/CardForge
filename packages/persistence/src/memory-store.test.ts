import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistenceTestReplay } from "./fixtures.js";
import { MemoryCardForgeStore } from "./memory-store.js";
import { createMatchTelemetry, seasonOne } from "@cardforge/competitive";

void describe("CardForge persistence contract", () => {
  void it("isolates account decks and clones stored records", async () => {
    const store = new MemoryCardForgeStore();
    await store.upsertAccount("account-one", "Player One");
    await store.saveDeck({
      deckId: "deck-one",
      accountId: "account-one",
      gameId: "cardforge",
      formatId: "standard",
      leaderId: "leader.one",
      name: "First Front",
      revision: 1,
      cardIds: ["entity.one", "entity.one", "tactic.one"],
    });
    assert.equal(await store.getDeck("account-two", "deck-one"), null);
    assert.deepEqual(
      (await store.getDeck("account-one", "deck-one"))?.cardIds,
      ["entity.one", "entity.one", "tactic.one"],
    );
    await store.upsertAccount("account-two", "Player Two");
    await store.saveDeck({
      deckId: "deck-one",
      accountId: "account-two",
      gameId: "cardforge",
      formatId: "standard",
      leaderId: "leader.two",
      name: "Second Front",
      revision: 1,
      cardIds: ["entity.two"],
    });
    assert.equal(
      (await store.getDeck("account-one", "deck-one"))?.name,
      "First Front",
    );
    assert.equal(
      (await store.getDeck("account-two", "deck-one"))?.name,
      "Second Front",
    );
  });

  void it("stores an exact active replay record", async () => {
    const store = new MemoryCardForgeStore();
    const replay = persistenceTestReplay("match-one");
    await store.saveMatch({ status: "active", replay });
    assert.deepEqual(await store.getMatch("match-one"), {
      status: "active",
      replay,
    });
  });

  void it("settles a ranked match exactly once and persists telemetry", async () => {
    const store = new MemoryCardForgeStore();
    await store.upsertAccount("account-one", "Player One");
    await store.upsertAccount("account-two", "Player Two");
    const replay = persistenceTestReplay("ranked-memory");
    const participants = {
      p1: {
        playerId: "p1",
        accountId: "account-one",
        leaderId: "leader.ember",
        aspects: ["force"],
      },
      p2: {
        playerId: "p2",
        accountId: "account-two",
        leaderId: "leader.citadel",
        aspects: ["bastion"],
      },
    } as const;
    const telemetry = createMatchTelemetry({
      replay,
      queue: "ranked",
      seasonId: seasonOne.seasonId,
      participants,
      winnerId: "p1",
      victoryReason: "integrity",
      startingInitiative: "p2",
      cycles: 9,
    });
    const completion = {
      matchId: replay.matchId,
      seasonId: seasonOne.seasonId,
      participants,
      winnerId: "p1",
      cycles: 9,
      telemetry,
    } as const;
    const first = await store.completeRankedMatch(completion);
    const duplicate = await store.completeRankedMatch(completion);
    assert.equal(first?.ratingDelta.p1, 16);
    assert.equal(duplicate, null);
    assert.equal(
      (await store.getCompetitiveProfile("account-one", seasonOne.seasonId))
        ?.wins,
      1,
    );
    assert.deepEqual(await store.listTelemetry(seasonOne.seasonId), [
      telemetry,
    ]);
  });
});
