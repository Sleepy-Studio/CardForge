import assert from "node:assert/strict";
import {
  defaultTheme,
  proofFormat,
  prototypeDecks,
} from "@cardforge/rules-tempofront";

const endpoint = process.env.CARDFORGE_SERVER_URL ?? "http://127.0.0.1:2567";
const accountId = "storage-smoke-account";
const headers = {
  "content-type": "application/json",
  "x-cardforge-account-id": accountId,
};

const accountResponse = await fetch(`${endpoint}/api/accounts/${accountId}`, {
  method: "PUT",
  headers,
  body: JSON.stringify({ displayName: "Storage Smoke" }),
});
assert.equal(accountResponse.status, 204);

const deckResponse = await fetch(
  `${endpoint}/api/accounts/${accountId}/decks/storage-smoke-deck`,
  {
    method: "PUT",
    headers,
    body: JSON.stringify({
      gameId: defaultTheme.gameId,
      formatId: proofFormat.formatId,
      leaderId: "leader.vanguard",
      name: "Storage Smoke Deck",
      revision: 1,
      cardIds: prototypeDecks["leader.vanguard"],
    }),
  },
);
assert.equal(deckResponse.status, 204, await deckResponse.text());

const listResponse = await fetch(
  `${endpoint}/api/accounts/${accountId}/decks`,
  { headers },
);
assert.equal(listResponse.status, 200);
const result = (await listResponse.json()) as {
  readonly decks: readonly { readonly cardIds: readonly string[] }[];
};
assert.equal(result.decks.length, 1);
assert.equal(result.decks[0]?.cardIds.length, 40);

const forbidden = await fetch(`${endpoint}/api/accounts/${accountId}/decks`);
assert.equal(forbidden.status, 403);

console.log(
  JSON.stringify({
    accountId,
    deckCount: result.decks.length,
    cardCount: result.decks[0]?.cardIds.length,
    crossAccountStatus: forbidden.status,
  }),
);
