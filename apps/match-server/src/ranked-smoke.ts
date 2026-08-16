import assert from "node:assert/strict";
import { Client, type Room } from "@colyseus/sdk";
import { seasonOne } from "@cardforge/competitive";
import { proofFormat, prototypeDecks } from "@cardforge/rules-tempofront";

const endpoint = process.env.CARDFORGE_SERVER_URL ?? "http://127.0.0.1:2567";

interface RankedSnapshot {
  readonly hash: string;
  readonly competitive: {
    readonly queue: string;
    readonly season: { readonly seasonId: string };
  };
  readonly view: {
    readonly players: Record<
      "p1" | "p2",
      { readonly leader: { readonly cardId: string } }
    >;
  };
}

async function saveDeck(
  accountId: string,
  deckId: string,
  leaderId: "leader.ember" | "leader.citadel",
): Promise<void> {
  const headers = {
    "content-type": "application/json",
    "x-cardforge-account-id": accountId,
  };
  assert.equal(
    (
      await fetch(`${endpoint}/api/accounts/${accountId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ displayName: accountId }),
      })
    ).status,
    204,
  );
  const response = await fetch(
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
  assert.equal(response.status, 204, await response.text());
  const profile = await fetch(
    `${endpoint}/api/accounts/${accountId}/competitive-profile`,
    { headers },
  );
  assert.equal(profile.status, 200);
  const body = (await profile.json()) as {
    profile: { unlockedLeaderIds: readonly string[] };
  };
  assert.ok(body.profile.unlockedLeaderIds.includes(leaderId));
}

function nextSnapshot(room: Room): Promise<RankedSnapshot> {
  return new Promise((resolve) => room.onMessage("snapshot", resolve));
}

const suffix = String(process.pid);
const p1Account = `ranked-alpha-${suffix}`;
const p2Account = `ranked-beta-${suffix}`;
await saveDeck(p1Account, "ranked-ember", "leader.ember");
await saveDeck(p2Account, "ranked-citadel", "leader.citadel");

const first = await new Client(endpoint).joinOrCreate("tempofront-ranked", {
  accountId: p1Account,
  deckId: "ranked-ember",
});
const second = await new Client(endpoint).joinById(first.roomId, {
  accountId: p2Account,
  deckId: "ranked-citadel",
});
first.onMessage("seat", () => {});
second.onMessage("seat", () => {});
const p1Snapshot = nextSnapshot(first);
const p2Snapshot = nextSnapshot(second);
first.send("ready");
second.send("ready");
const [p1, p2] = await Promise.all([p1Snapshot, p2Snapshot]);
assert.equal(p1.competitive.queue, "ranked");
assert.equal(p2.competitive.season.seasonId, seasonOne.seasonId);
assert.equal(p1.view.players.p1.leader.cardId, "leader.ember");
assert.equal(p2.view.players.p2.leader.cardId, "leader.citadel");
assert.equal(p1.hash, p2.hash);

const overview = await fetch(`${endpoint}/api/competitive/overview`);
assert.equal(overview.status, 200);
const overviewBody = (await overview.json()) as {
  season: { seasonId: string };
};
assert.equal(overviewBody.season.seasonId, seasonOne.seasonId);

await Promise.all([first.leave(), second.leave()]);
console.log(
  JSON.stringify({
    roomId: first.roomId,
    queue: p1.competitive.queue,
    seasonId: p1.competitive.season.seasonId,
    leaders: [
      p1.view.players.p1.leader.cardId,
      p2.view.players.p2.leader.cardId,
    ],
    sharedHash: p1.hash,
  }),
);
