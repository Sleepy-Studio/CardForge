import assert from "node:assert/strict";
import { persistenceTestReplay } from "./fixtures.js";
import { PostgresCardForgeStore } from "./postgres-store.js";

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
  console.log(
    JSON.stringify({
      accountId: "smoke-account",
      deckCards: deck.cardIds.length,
      matchId: replay.matchId,
      status: "active",
    }),
  );
} finally {
  await store.close();
}
