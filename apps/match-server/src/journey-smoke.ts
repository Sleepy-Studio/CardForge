/**
 * M7 Definition-of-Done smoke. Drives a running match server exactly as two
 * browsers would: register, onboard, edit a deck, play casual (with a real
 * disconnect/reconnect), ranked, and a friend invite match, then verify
 * history, exactly-once rewards/settlement, and verified replays.
 *
 *   CARDFORGE_SERVER_URL=http://127.0.0.1:2567 node dist/journey-smoke.js
 */
import type { Room } from "@colyseus/sdk";
import {
  SmokeAccount,
  SnapshotFeed,
  assert,
  endpoint,
  playToCompletion,
} from "./smoke-kit.js";

interface DeckView {
  readonly deckId: string;
  readonly name: string;
  readonly leaderId: string;
  readonly cardIds: readonly string[];
  readonly status: { readonly playable: boolean; readonly legal: boolean; readonly missing: readonly unknown[] };
}
interface Wallet {
  readonly currencyId: string;
  readonly balance: number;
}
interface HistoryEntry {
  readonly matchId: string;
  readonly queue: string;
  readonly result: string | null;
  readonly reason: string | null;
  readonly opponent: { readonly displayName: string } | null;
  readonly ratingDelta: number | null;
  readonly reward: { readonly shards: number; readonly xp: number } | null;
}

const log = (step: string, detail: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ smoke: "journey", step, ...detail }));

async function shards(account: SmokeAccount): Promise<number> {
  const { body } = await account.api<{ snapshot: { wallets: Wallet[] } }>("/api/me/economy", { expect: 200 });
  return body.snapshot.wallets.find((wallet) => wallet.currencyId === "shards")!.balance;
}

async function joinPair(
  roomName: string,
  host: { account: SmokeAccount; deckId: string },
  guest: { account: SmokeAccount; deckId: string },
  extra: Record<string, unknown> = {},
): Promise<[SnapshotFeed, SnapshotFeed]> {
  const hostRoom = await (await host.account.client()).joinOrCreate(roomName, { deckId: host.deckId, ...extra });
  const hostFeed = new SnapshotFeed(hostRoom);
  hostRoom.send("ready");
  const guestRoom = await (await guest.account.client()).joinOrCreate(roomName, { deckId: guest.deckId, ...extra });
  const guestFeed = new SnapshotFeed(guestRoom);
  guestRoom.send("ready");
  assert(hostRoom.roomId === guestRoom.roomId, `${roomName} paired both players`);
  await Promise.all([hostFeed.until(() => true), guestFeed.until(() => true)]);
  return [hostFeed, guestFeed];
}

async function leaveAll(rooms: readonly Room[]): Promise<void> {
  await Promise.all(rooms.map((room) => room.leave().catch(() => undefined)));
}

// --- Identity boundary -----------------------------------------------------
const anonymous = new SmokeAccount("Anon");
assert((await anonymous.api("/api/me")).status === 401, "anonymous /api/me is rejected");
const forged = await fetch(`${endpoint}/api/me/decks`, { headers: { "x-cardforge-account-id": "acct-anything" } });
assert(forged.status === 401, "legacy account header grants nothing");
const legacyRoute = await fetch(`${endpoint}/api/accounts/whoever/decks`, { headers: { "x-cardforge-account-id": "whoever" } });
assert(legacyRoute.status === 404, "legacy account-scoped routes are gone");
const crossOrigin = await fetch(`${endpoint}/api/auth/login`, {
  method: "POST",
  headers: { origin: "https://evil.example", "content-type": "application/json" },
  body: JSON.stringify({ email: "a@b.c", password: "x" }),
});
assert(crossOrigin.status === 403, "state-changing requests from foreign origins are refused");

const alice = await new SmokeAccount("Alice").register();
const bruno = await new SmokeAccount("Bruno").register();
const carol = await new SmokeAccount("Carol").register();
assert(alice.accountId.startsWith("acct-"), "server assigns account IDs");
const duplicate = await new SmokeAccount("Alice").api("/api/auth/register", {
  body: { email: alice.email, password: "another-password-1", displayName: "Copycat" },
});
assert(duplicate.status === 409, "duplicate email is rejected");
const badLogin = await new SmokeAccount("Mallory").api("/api/auth/login", {
  body: { email: alice.email, password: "wrong-password-000" },
});
assert(badLogin.status === 401, "wrong password is rejected");
log("identity", { alice: alice.accountId, bruno: bruno.accountId });

// --- WebSocket identity ------------------------------------------------------
{
  const { Client } = await import("@colyseus/sdk");
  const noTicket = new Client(endpoint);
  const rejected = await noTicket.joinOrCreate("tempofront", { deckId: "starter-ember" }).then(
    () => false,
    () => true,
  );
  assert(rejected, "rooms reject joins without a ticket");
  const spoofed = new Client(endpoint);
  spoofed.auth.token = "eyJzdWIiOiJhY2N0LWFsaWNlIn0.forged";
  assert(
    await spoofed.joinOrCreate("tempofront", { deckId: "starter-ember" }).then(() => false, () => true),
    "rooms reject forged tickets",
  );
  const withAccountOption = await (await alice.client())
    .joinOrCreate("tempofront", { deckId: "starter-ember", accountId: bruno.accountId })
    .then(() => false, () => true);
  assert(withAccountOption, "rooms reject client-supplied account identity");
}

// --- Onboarding --------------------------------------------------------------
const starters = await alice.api<{ starters: { leaderId: string }[] }>("/api/onboarding/starters", { expect: 200 });
assert(starters.body.starters.length === 6, "six starter Leaders are offered");
const aliceStarter = await alice.onboard("leader.ember");
const brunoStarter = await bruno.onboard("leader.citadel");
const carolStarter = await carol.onboard("leader.vector");
const second = await alice.api("/api/me/onboarding/starter", { body: { leaderId: "leader.hollow" } });
assert(second.status === 409, "a starter can be chosen only once");
const aliceDecks = await alice.api<{ decks: DeckView[] }>("/api/me/decks", { expect: 200 });
const starterDeck = aliceDecks.body.decks.find((deck) => deck.deckId === aliceStarter)!;
assert(starterDeck.status.playable, "starter deck is legal, owned, and unlocked");
const economy = await alice.api<{ snapshot: { cards: { quantity: number }[] } }>("/api/me/economy", { expect: 200 });
assert(economy.body.snapshot.cards.reduce((total, card) => total + card.quantity, 0) === 40, "starter collection holds the 40 deck cards");
log("onboarding", { aliceStarter, brunoStarter, carolStarter });

// --- Deck editing ------------------------------------------------------------
const edited = await alice.api<{ deck: DeckView }>("/api/me/decks/alice-main", {
  method: "PUT",
  body: { name: "Alice Main", leaderId: starterDeck.leaderId, cardIds: starterDeck.cardIds },
  expect: 200,
});
assert(edited.body.deck.status.playable, "an edited copy of the starter is playable");
const illegal = await alice.api<{ error: string }>("/api/me/decks/alice-bad", {
  method: "PUT",
  body: { name: "Too small", leaderId: starterDeck.leaderId, cardIds: starterDeck.cardIds.slice(1) },
});
assert(illegal.status === 422 && illegal.body.error === "ILLEGAL_DECK", "illegal decks are rejected server-side");
const unowned = await alice.api<{ deck: DeckView }>("/api/me/decks/alice-citadel", {
  method: "PUT",
  body: { name: "Borrowed", leaderId: "leader.citadel", cardIds: (await bruno.api<{ decks: DeckView[] }>("/api/me/decks")).body.decks[0]!.cardIds },
  expect: 200,
});
assert(!unowned.body.deck.status.playable && unowned.body.deck.status.missing.length > 0, "decks with unowned cards save but are not playable");
const refused = await (await alice.client()).joinOrCreate("tempofront", { deckId: "alice-citadel" }).then(
  () => "joined",
  (error: Error) => error.message,
);
assert(/missing/i.test(refused), `queue refuses decks with missing cards (${refused})`);
log("deckbuilder");

// --- Casual match with disconnect/reconnect ----------------------------------
const aliceShardsBefore = await shards(alice);
const casualFeeds = await joinPair(
  "tempofront",
  { account: alice, deckId: "alice-main" },
  { account: bruno, deckId: brunoStarter },
);
let [aliceFeed] = casualFeeds;
const [, brunoFeed] = casualFeeds;
assert(aliceFeed.latest!.seat !== brunoFeed.latest!.seat, "seats are distinct");
assert(aliceFeed.latest!.hash === brunoFeed.latest!.hash, "both seats share the canonical hash");
assert(!aliceFeed.latest!.view.players[brunoFeed.latest!.seat].hand, "the rival hand is hidden");
const casualMatchId = aliceFeed.latest!.matchId;
let reconnected = false;
const casualResult = await playToCompletion(casualFeeds, {
  onStep: async (step) => {
    if (step !== 12 || reconnected) return;
    reconnected = true;
    const room = aliceFeed.room;
    room.reconnection.enabled = false;
    const token = room.reconnectionToken;
    room.connection.close(4010, "smoke drop");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { Client } = await import("@colyseus/sdk");
    const again = await new Client(endpoint).reconnect(token);
    aliceFeed = new SnapshotFeed(again);
    casualFeeds[0] = aliceFeed;
    const restored = await aliceFeed.until(() => true);
    assert(restored.hash === brunoFeed.latest!.hash, "reconnected seat receives the current authoritative state");
    log("reconnect", { commandNumber: restored.commandNumber });
  },
});
assert(reconnected, "the casual match exercised a reconnect");
await Promise.all([aliceFeed.until((s) => s.outcome !== null), brunoFeed.until((s) => s.outcome !== null)]);
const aliceWon = aliceFeed.latest!.outcome!.winnerId === aliceFeed.latest!.seat;
const aliceReward = aliceFeed.latest!.outcome!.reward;
assert(aliceReward && aliceReward.shards === (aliceWon ? 60 : 30), "casual reward is reported to the player");
assert((await shards(alice)) === aliceShardsBefore + aliceReward.shards, "reward was credited exactly once");
await leaveAll([aliceFeed.room, brunoFeed.room]);
log("casual", { matchId: casualMatchId, reason: casualResult.outcome?.reason, commands: casualResult.commandNumber });

// --- Ranked match -------------------------------------------------------------
const [rankedA, rankedB] = await joinPair(
  "tempofront-ranked",
  { account: alice, deckId: "alice-main" },
  { account: bruno, deckId: brunoStarter },
);
const rankedMatchId = rankedA.latest!.matchId;
await playToCompletion([rankedA, rankedB]);
await Promise.all([rankedA.until((s) => s.outcome !== null), rankedB.until((s) => s.outcome !== null)]);
assert(rankedA.latest!.competitive.settlement, "ranked settlement is attached to the result");
await leaveAll([rankedA.room, rankedB.room]);
const aliceProfile = await alice.api<{ profile: { wins: number; losses: number; rank: { label: string } } }>("/api/me/competitive-profile", { expect: 200 });
assert(aliceProfile.body.profile.wins + aliceProfile.body.profile.losses === 1, "ranked settled exactly once");
log("ranked", { matchId: rankedMatchId, rank: aliceProfile.body.profile.rank.label });

// --- Friend challenge ---------------------------------------------------------
const invite = await alice.api<{ invite: { code: string }; url: string }>("/api/me/invites", { body: {}, expect: 201 });
const code = invite.body.invite.code;
assert(invite.body.url.endsWith(`/join/${code}`), "invite URL uses /join/CODE");
const preview = await bruno.api<{ invite: { hostDisplayName: string; available: boolean } }>(`/api/invites/${code}`, { expect: 200 });
assert(preview.body.invite.available && preview.body.invite.hostDisplayName === alice.displayName, "guest sees who invited them");
const [friendA, friendB] = await joinPair(
  "tempofront-friend",
  { account: alice, deckId: "alice-main" },
  { account: bruno, deckId: brunoStarter },
  { inviteCode: code },
);
const intruder = await (await carol.client())
  .joinOrCreate("tempofront-friend", { deckId: carolStarter, inviteCode: code })
  .then(() => "joined", (error: Error) => error.message);
assert(intruder !== "joined", "a third account cannot use a spent invite");
const friendMatchId = friendA.latest!.matchId;
const friendShards = await shards(alice);
friendA.room.send("concede");
await Promise.all([friendA.until((s) => s.outcome !== null), friendB.until((s) => s.outcome !== null)]);
assert(friendB.latest!.outcome!.reason === "concession", "concession ends the match");
assert(friendB.latest!.outcome!.winnerId === friendB.latest!.seat, "the conceding player loses");
assert((await shards(alice)) === friendShards, "friend matches grant no currency");
await leaveAll([friendA.room, friendB.room]);
const spent = await carol.api<{ invite: { available: boolean; status: string } }>(`/api/invites/${code}`, { expect: 200 });
assert(!spent.body.invite.available && spent.body.invite.status === "started", "invite is single-use");
log("friend", { matchId: friendMatchId, code });

// --- History and replays --------------------------------------------------------
const history = await alice.api<{ matches: HistoryEntry[] }>("/api/me/matches", { expect: 200 });
const byId = new Map(history.body.matches.map((entry) => [entry.matchId, entry]));
for (const [matchId, queue] of [[casualMatchId, "casual"], [rankedMatchId, "ranked"], [friendMatchId, "friend"]] as const) {
  const entry = byId.get(matchId);
  assert(entry?.queue === queue && entry.result, `${queue} match appears in history with a result`);
  assert(entry.opponent?.displayName === bruno.displayName, `${queue} history shows the opponent`);
}
assert(byId.get(rankedMatchId)!.ratingDelta !== null, "ranked history shows the rating change");
assert(byId.get(casualMatchId)!.reward?.shards === aliceReward.shards, "history shows the reward once");

const replay = await alice.api<{
  verification: { verified: boolean };
  totalFrames: number;
  frames: { index: number; view: { players: Record<string, { hand?: unknown }> } }[];
  perspective: string;
}>(`/api/matches/${casualMatchId}/replay`, { expect: 200 });
assert(replay.body.verification.verified, "casual replay reconstructs to the stored canonical hash");
assert(replay.body.totalFrames === casualResult.commandNumber + 1, "one frame per accepted command");
const rivalSeat = replay.body.perspective === "p1" ? "p2" : "p1";
assert(!replay.body.frames[1]!.view.players[rivalSeat]!.hand, "replay keeps the rival hand hidden");
const peek = await alice.api(`/api/matches/${casualMatchId}/replay?perspective=${rivalSeat}`);
assert(peek.status === 403, "a player cannot view the rival perspective");
assert((await carol.api(`/api/matches/${casualMatchId}/replay`)).status === 404, "non-participants cannot load replays");
const rankedReplay = await bruno.api<{ verification: { verified: boolean } }>(`/api/matches/${rankedMatchId}/replay?perspective=public`, { expect: 200 });
assert(rankedReplay.body.verification.verified, "ranked replay verifies");
log("history-and-replay", { frames: replay.body.totalFrames });

// --- Home, quests, and logout ----------------------------------------------------
const home = await alice.api<{ quests: { questId: string; progress: number }[]; recentMatches: unknown[] }>("/api/me/home", { expect: 200 });
assert(home.body.quests.find((quest) => quest.questId === "daily.take-action")!.progress === 2, "quests count casual and ranked matches only");
assert(home.body.recentMatches.length >= 3, "home lists recent matches");
await alice.api("/api/auth/logout", { body: {}, expect: 204 });
assert((await alice.api("/api/me")).status === 401, "logout ends the session");
const login = await alice.api("/api/auth/login", { body: { email: alice.email, password: "smoke-password-123" } });
assert(login.status === 200, "the player can sign back in");

log("complete", { ok: true });
process.exit(0);
