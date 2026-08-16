import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistenceTestReplay } from "./fixtures.js";
import { MemoryCardForgeStore } from "./memory-store.js";
import { createMatchTelemetry, seasonOne } from "@cardforge/competitive";
import { cosmeticCatalog } from "@cardforge/economy";
import type { CardDefinition } from "@cardforge/card-schema";

const economyTestCard: CardDefinition = {
  cardId: "entity.economy-test",
  revision: 1,
  name: "Economy Test",
  type: "entity",
  aspects: ["neutral"],
  rarity: "common",
  focusCost: 1,
  playTime: 2,
  power: 1,
  vitality: 2,
  presence: 1,
  strikeTime: 3,
};

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

  void it("persists idempotent crafting, rewards, and cosmetic unlocks", async () => {
    const store = new MemoryCardForgeStore();
    await store.upsertAccount("economy-account", "Collector");
    const initial = await store.bootstrapEconomy("economy-account");
    assert.equal(
      initial.wallets.find((wallet) => wallet.currencyId === "shards")?.balance,
      3_000,
    );

    const crafted = await store.craftCard(
      "craft-one",
      "economy-account",
      economyTestCard,
      2,
    );
    const duplicate = await store.craftCard(
      "craft-one",
      "economy-account",
      economyTestCard,
      2,
    );
    assert.deepEqual(duplicate, crafted);
    assert.equal(crafted.cards[0]?.quantity, 2);
    assert.equal(
      crafted.wallets.find((wallet) => wallet.currencyId === "shards")?.balance,
      2_800,
    );

    await store.grantReward(
      "reward-one",
      "economy-account",
      "style_tokens",
      50,
    );
    const cosmetic = cosmeticCatalog.find(
      (item) => item.cosmeticId === "card-back.orbital",
    )!;
    const unlocked = await store.unlockCosmetic(
      "unlock-one",
      "economy-account",
      cosmetic,
    );
    assert.ok(
      unlocked.entitlements.some(
        (item) => item.entitlementId === cosmetic.cosmeticId,
      ),
    );
    assert.equal(
      (await store.listEconomyTransactions("economy-account")).length,
      4,
    );
    await assert.rejects(
      store.craftCard("craft-over-cap", "economy-account", economyTestCard, 2),
      /capped at 3/,
    );
  });

  void it("rewards each training scenario exactly once", async () => {
    const store = new MemoryCardForgeStore();
    await store.upsertAccount("trainee", "Trainee");
    const initial = await store.bootstrapEconomy("trainee");
    const first = await store.completeTrainingScenario(
      "completion-one",
      "trainee",
      "tutorial.focus",
      { shards: 150, styleTokens: 0 },
    );
    const duplicate = await store.completeTrainingScenario(
      "completion-two",
      "trainee",
      "tutorial.focus",
      { shards: 150, styleTokens: 0 },
    );
    assert.equal(first.firstCompletion, true);
    assert.equal(duplicate.firstCompletion, false);
    assert.equal(
      first.snapshot.wallets.find((wallet) => wallet.currencyId === "shards")!
        .balance,
      initial.wallets.find((wallet) => wallet.currencyId === "shards")!
        .balance + 150,
    );
    assert.deepEqual(await store.listTrainingCompletions("trainee"), [
      "tutorial.focus",
    ]);
  });
});
