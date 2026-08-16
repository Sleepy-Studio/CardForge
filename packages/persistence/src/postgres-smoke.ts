import assert from "node:assert/strict";
import { persistenceTestReplay } from "./fixtures.js";
import { PostgresCardForgeStore } from "./postgres-store.js";
import { createMatchTelemetry, seasonOne } from "@cardforge/competitive";

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
  console.log(
    JSON.stringify({
      accountId: "smoke-account",
      deckCards: deck.cardIds.length,
      matchId: replay.matchId,
      status: "active",
      rankedSettlement: settlement?.matchId,
    }),
  );
} finally {
  await store.close();
}
