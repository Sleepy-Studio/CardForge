import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistenceTestReplay } from "./fixtures.js";
import { MemoryCardForgeStore } from "./memory-store.js";

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
});
