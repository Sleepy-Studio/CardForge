/** Academy and Practice rooms: authenticated, server-run bot, replayable. */
import { SmokeAccount, SnapshotFeed, assert } from "./smoke-kit.js";

interface TrainingSnapshot {
  readonly commandNumber: number;
  readonly scenario?: { readonly scenarioId: string };
  readonly opponent: { readonly kind: string };
  readonly view: {
    readonly phase: string;
    readonly players: Record<
      "p1" | "p2",
      { readonly focus: number; readonly hand?: readonly unknown[] }
    >;
  };
  readonly legalIntents: readonly Record<string, unknown>[];
}

const player = await new SmokeAccount("Trainee").register();
const deckId = await player.onboard("leader.cipher");

const room = await (
  await player.client()
).create("tempofront-training", { scenarioId: "tutorial.focus" });
const feed = new SnapshotFeed(room);
room.send("ready");
const initial = (await feed.until(() => true)) as unknown as TrainingSnapshot;
assert(initial.scenario?.scenarioId === "tutorial.focus", "scenario is pinned");
assert(
  initial.opponent.kind === "heuristic_bot" &&
    initial.view.players.p1.focus === 5,
  "scenario modifiers apply",
);
assert(initial.view.players.p2.hand === undefined, "bot hand is hidden");
room.send("command", { type: "mulligan", instanceIds: [] });
const after = (await feed.until(
  (s) => s.commandNumber >= 2,
)) as unknown as TrainingSnapshot;
assert(after.view.phase === "playing", "bot answered the mulligan");
await room.leave();

const forged = await (
  await player.client()
)
  .create("tempofront-training", {
    scenarioId: "tutorial.focus",
    accountId: "acct-someone-else",
  })
  .then(
    () => "joined",
    () => "rejected",
  );
assert(forged === "rejected", "training rooms refuse client-supplied identity");

const practice = await (
  await player.client()
).create("tempofront-training", { mode: "practice", deckId });
const practiceFeed = new SnapshotFeed(practice);
practice.send("ready");
const opening = await practiceFeed.until(() => true);
assert(opening.legalIntents.length > 0, "practice starts with legal intents");
practice.send("concede");
const ended = await practiceFeed.until((s) => s.outcome !== null);
await practice.leave();
const history = await player.api<{
  matches: { matchId: string; queue: string; result: string }[];
}>("/api/me/matches", { expect: 200 });
const entry = history.body.matches.find(
  (match) => match.matchId === ended.matchId,
);
assert(
  entry?.queue === "practice" && entry.result === "loss",
  "practice appears in history",
);
console.log(
  JSON.stringify({
    smoke: "training",
    scenario: "tutorial.focus",
    practice: ended.matchId,
    ok: true,
  }),
);
process.exit(0);
