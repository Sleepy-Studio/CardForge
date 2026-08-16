import assert from "node:assert/strict";
import { Client, type Room } from "@colyseus/sdk";
import { proofFormat, prototypeDecks } from "@cardforge/rules-tempofront";
import type { MatchSnapshot } from "./session.js";
import { AuthoritativeMatchSession } from "./session.js";
import { PostgresCardForgeStore } from "@cardforge/persistence";

const endpoint = process.env.CARDFORGE_SERVER_URL ?? "http://127.0.0.1:2567";

async function saveDeck(
  accountId: string,
  deckId: string,
  leaderId: keyof typeof prototypeDecks,
): Promise<void> {
  const headers = {
    "content-type": "application/json",
    "x-cardforge-account-id": accountId,
  };
  const account = await fetch(`${endpoint}/api/accounts/${accountId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ displayName: accountId }),
  });
  assert.equal(account.status, 204);
  const deck = await fetch(
    `${endpoint}/api/accounts/${accountId}/decks/${deckId}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        gameId: "cardforge-proof",
        formatId: proofFormat.formatId,
        leaderId,
        name: deckId,
        revision: 1,
        cardIds: prototypeDecks[leaderId],
      }),
    },
  );
  assert.equal(deck.status, 204, await deck.text());
}

function nextSnapshot(room: Room): Promise<MatchSnapshot> {
  return new Promise((resolve) => room.onMessage("snapshot", resolve));
}

await saveDeck("selected-account-one", "selected-deck-one", "leader.rootbound");
await saveDeck("selected-account-two", "selected-deck-two", "leader.skydancer");

const first = await new Client(endpoint).joinOrCreate("tempofront", {
  accountId: "selected-account-one",
  deckId: "selected-deck-one",
});
const second = await new Client(endpoint).joinById(first.roomId, {
  accountId: "selected-account-two",
  deckId: "selected-deck-two",
});
first.onMessage("seat", () => {});
second.onMessage("seat", () => {});
const firstSnapshot = nextSnapshot(first);
const secondSnapshot = nextSnapshot(second);
first.send("ready");
second.send("ready");
const [p1, p2] = await Promise.all([firstSnapshot, secondSnapshot]);
assert.equal(p1.view.players.p1.leader.cardId, "leader.rootbound");
assert.equal(p2.view.players.p2.leader.cardId, "leader.skydancer");
assert.equal(p1.hash, p2.hash);

let recoveredHash: string | null = null;
if (process.env.DATABASE_URL) {
  const store = new PostgresCardForgeStore(process.env.DATABASE_URL);
  const record = await store.getMatch(first.roomId);
  assert.ok(record);
  recoveredHash = AuthoritativeMatchSession.restore(record.replay).replay()
    .finalStateHash;
  assert.equal(recoveredHash, p1.hash);
  await store.close();
}
await Promise.all([first.leave(), second.leave()]);

console.log(
  JSON.stringify({
    roomId: first.roomId,
    p1Leader: p1.view.players.p1.leader.cardId,
    p2Leader: p2.view.players.p2.leader.cardId,
    sharedHash: p1.hash,
    recoveredHash,
  }),
);
