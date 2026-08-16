import { Client, type Room } from "@colyseus/sdk";

interface TrainingSnapshot {
  readonly seat: "p1";
  readonly commandNumber: number;
  readonly scenario: { readonly scenarioId: string };
  readonly opponent: { readonly kind: string };
  readonly view: {
    readonly phase: string;
    readonly players: {
      readonly p1: {
        readonly focus: number;
        readonly hand?: readonly unknown[];
      };
      readonly p2: { readonly hand?: readonly unknown[] };
    };
  };
  readonly legalIntents: readonly Record<string, unknown>[];
}

function nextMessage<T>(room: Room, type: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      3_000,
    );
    room.onMessage(type, (message) => {
      clearTimeout(timeout);
      resolve(message as T);
    });
  });
}

const endpoint = process.env.CARDFORGE_SERVER_URL ?? "http://127.0.0.1:2567";
const accountId = `training-smoke-${process.pid}`;
const accountResponse = await fetch(`${endpoint}/api/accounts/${accountId}`, {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    "x-cardforge-account-id": accountId,
  },
  body: JSON.stringify({ displayName: "Training Smoke" }),
});
if (!accountResponse.ok)
  throw new Error("Could not provision training account");

const client = new Client(endpoint);
const room = await client.joinOrCreate("tempofront-training", {
  accountId,
  scenarioId: "tutorial.focus",
});
const seatMessage = nextMessage<{ readonly seat: string }>(room, "seat");
const initialMessage = nextMessage<TrainingSnapshot>(room, "snapshot");
room.send("ready");
const [seat, initial] = await Promise.all([seatMessage, initialMessage]);
if (
  seat.seat !== "p1" ||
  initial.seat !== "p1" ||
  initial.scenario.scenarioId !== "tutorial.focus" ||
  initial.opponent.kind !== "heuristic_bot" ||
  initial.view.players.p1.focus !== 5 ||
  initial.view.players.p2.hand !== undefined
)
  throw new Error(`Training projection is invalid: ${JSON.stringify(initial)}`);
const mulligan = initial.legalIntents.find(
  (intent) =>
    intent.type === "mulligan" &&
    Array.isArray(intent.instanceIds) &&
    intent.instanceIds.length === 0,
);
if (!mulligan) throw new Error("Training room omitted an empty mulligan");
const afterMessage = nextMessage<TrainingSnapshot>(room, "snapshot");
room.send("command", mulligan);
const after = await afterMessage;
if (after.commandNumber < 2 || after.view.phase !== "playing")
  throw new Error(
    `Training bot did not answer the mulligan: ${JSON.stringify(after)}`,
  );
await room.leave();
console.log(
  JSON.stringify({
    roomId: room.roomId,
    scenarioId: initial.scenario.scenarioId,
    commandNumber: after.commandNumber,
    phase: after.view.phase,
  }),
);
