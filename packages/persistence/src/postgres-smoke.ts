import assert from "node:assert/strict";
import { persistenceTestReplay } from "./fixtures.js";
import { PostgresCardForgeStore } from "./postgres-store.js";
import { createMatchTelemetry, seasonOne } from "@cardforge/competitive";
import { cosmeticCatalog } from "@cardforge/economy";
import type { CardDefinition } from "@cardforge/card-schema";
import { launchLiveOps } from "@cardforge/live-ops";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const store = new PostgresCardForgeStore(databaseUrl);
try {
  await store.migrate();
  await store.upsertAccount("smoke-account", "Persistence Smoke");
  const deck = {
    deckId: "smoke-deck",
    accountId: "smoke-account",
    gameId: "cardforge",
    formatId: "standard",
    leaderId: "leader.one",
    name: "Smoke Deck",
    revision: 1,
    cardIds: ["entity.one", "entity.one", "tactic.one"],
  } as const;
  await store.saveDeck(deck);
  assert.deepEqual(await store.getDeck("smoke-account", "smoke-deck"), deck);

  const replay = persistenceTestReplay("smoke-match");
  await store.saveMatch({ status: "active", replay });
  assert.deepEqual(await store.getMatch("smoke-match"), {
    status: "active",
    replay,
  });
  const rankedAccount = `smoke-ranked-a-${process.pid}`;
  const rankedRival = `smoke-ranked-b-${process.pid}`;
  await store.upsertAccount(rankedAccount, "Persistence Ranked");
  await store.upsertAccount(rankedRival, "Persistence Rival");
  const rankedReplay = persistenceTestReplay(`smoke-ranked-${process.pid}`);
  const participants = {
    p1: {
      playerId: "p1",
      accountId: rankedAccount,
      leaderId: "leader.ember",
      aspects: ["force"],
    },
    p2: {
      playerId: "p2",
      accountId: rankedRival,
      leaderId: "leader.citadel",
      aspects: ["bastion"],
    },
  } as const;
  const telemetry = createMatchTelemetry({
    replay: rankedReplay,
    queue: "ranked",
    seasonId: seasonOne.seasonId,
    participants,
    winnerId: "p1",
    victoryReason: "integrity",
    startingInitiative: "p2",
    cycles: 8,
  });
  const settlement = await store.completeRankedMatch({
    matchId: rankedReplay.matchId,
    seasonId: seasonOne.seasonId,
    participants,
    winnerId: "p1",
    cycles: 8,
    telemetry,
  });
  assert.equal(settlement?.ratingDelta.p1, 16);
  assert.equal(
    await store.completeRankedMatch({
      matchId: rankedReplay.matchId,
      seasonId: seasonOne.seasonId,
      participants,
      winnerId: "p1",
      cycles: 8,
      telemetry,
    }),
    null,
  );
  const economyAccount = `smoke-economy-${process.pid}`;
  await store.upsertAccount(economyAccount, "Persistence Collector");
  const economyCard: CardDefinition = {
    cardId: "entity.persistence-smoke",
    revision: 1,
    name: "Persistence Smoke",
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
  const crafted = await store.craftCard(
    `smoke-craft-${process.pid}`,
    economyAccount,
    economyCard,
    1,
  );
  const duplicateCraft = await store.craftCard(
    `smoke-craft-${process.pid}`,
    economyAccount,
    economyCard,
    1,
  );
  assert.deepEqual(duplicateCraft, crafted);
  const cosmetic = cosmeticCatalog.find(
    (item) => item.cosmeticId === "card-back.orbital",
  )!;
  const unlocked = await store.unlockCosmetic(
    `smoke-unlock-${process.pid}`,
    economyAccount,
    cosmetic,
  );
  assert.ok(
    unlocked.entitlements.some(
      (item) => item.entitlementId === cosmetic.cosmeticId,
    ),
  );
  const training = await store.completeTrainingScenario(
    `smoke-training-${process.pid}`,
    economyAccount,
    "tutorial.focus",
    { shards: 150, styleTokens: 0 },
  );
  const trainingDuplicate = await store.completeTrainingScenario(
    `smoke-training-duplicate-${process.pid}`,
    economyAccount,
    "tutorial.focus",
    { shards: 150, styleTokens: 0 },
  );
  assert.equal(training.firstCompletion, true);
  assert.equal(trainingDuplicate.firstCompletion, false);
  assert.deepEqual(await store.listTrainingCompletions(economyAccount), [
    "tutorial.focus",
  ]);
  const smokeLiveOps = {
    ...launchLiveOps,
    configId: `liveops.smoke-${process.pid}`,
  };
  await store.saveLiveOpsDefinition(smokeLiveOps);
  assert.ok(
    (await store.listLiveOpsDefinitions()).some(
      (definition) => definition.configId === smokeLiveOps.configId,
    ),
  );
  const supportCase = await store.createSupportCase({
    caseId: `case-smoke-${process.pid}`,
    accountId: economyAccount,
    summary: "Persistence smoke support case",
  });
  const resolvedCase = await store.updateSupportCase({
    caseId: supportCase.caseId,
    status: "resolved",
    note: "Verified by smoke test.",
  });
  assert.equal(resolvedCase.status, "resolved");
  const audit = await store.appendAudit({
    auditId: `audit-smoke-${process.pid}`,
    actorId: "persistence-smoke",
    action: "support.resolve",
    targetId: supportCase.caseId,
    payload: { status: "resolved" },
  });
  assert.equal(audit.targetId, supportCase.caseId);
  console.log(
    JSON.stringify({
      accountId: "smoke-account",
      deckCards: deck.cardIds.length,
      matchId: replay.matchId,
      status: "active",
      rankedSettlement: settlement?.matchId,
      craftedCards: crafted.cards.length,
      entitlements: unlocked.entitlements.length,
      training: training.scenarioId,
      supportCase: supportCase.caseId,
    }),
  );
} finally {
  await store.close();
}
