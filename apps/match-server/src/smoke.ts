/**
 * Fast two-client room smoke: authenticated seats, forged identity refused,
 * shared canonical hash, and private hands.
 */
import { SmokeAccount, SnapshotFeed, assert } from "./smoke-kit.js";

const one = await new SmokeAccount("Seat One").register();
const two = await new SmokeAccount("Seat Two").register();
const [deckOne, deckTwo] = await Promise.all([one.onboard("leader.ember"), two.onboard("leader.hollow")]);

const firstRoom = await (await one.client()).joinOrCreate("tempofront", { deckId: deckOne });
const first = new SnapshotFeed(firstRoom);
firstRoom.send("ready");
const secondRoom = await (await two.client()).joinById(firstRoom.roomId, { deckId: deckTwo });
const second = new SnapshotFeed(secondRoom);
secondRoom.send("ready");
const [a, b] = await Promise.all([first.until(() => true), second.until(() => true)]);
assert(a.seat !== b.seat && a.commandNumber === 0 && a.hash === b.hash, "handshake seats both players");

firstRoom.send("command", { type: "pass", playerId: b.seat });
await new Promise((resolve) => setTimeout(resolve, 300));
assert(first.errors.length === 1, "a forged playerId is rejected");

const mulligan = a.legalIntents.find(
  (intent) => intent.type === "mulligan" && Array.isArray(intent.instanceIds) && intent.instanceIds.length === 0,
);
assert(mulligan && !("playerId" in mulligan), "legal intents carry no identity");
firstRoom.send("command", mulligan);
const [p, q] = await Promise.all([
  first.until((snapshot) => snapshot.commandNumber === 1),
  second.until((snapshot) => snapshot.commandNumber === 1),
]);
assert(p.hash === q.hash, "both seats share one canonical hash");
assert(p.view.players[p.seat].hand?.length === 5 && !p.view.players[q.seat].hand, "seat one sees only its hand");
assert(q.view.players[q.seat].hand?.length === 5 && !q.view.players[p.seat].hand, "seat two sees only its hand");
firstRoom.send("concede");
await Promise.all([first.until((s) => s.outcome !== null), second.until((s) => s.outcome !== null)]);
await Promise.all([firstRoom.leave(), secondRoom.leave()]);
console.log(JSON.stringify({ smoke: "rooms", roomId: firstRoom.roomId, sharedHash: p.hash, ok: true }));
process.exit(0);
