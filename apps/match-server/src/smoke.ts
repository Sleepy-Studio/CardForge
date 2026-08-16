import { Client, type Room } from "@colyseus/sdk";

interface SnapshotMessage {
  readonly seat: "p1" | "p2";
  readonly commandNumber: number;
  readonly hash: string;
  readonly view: {
    readonly players: Record<
      "p1" | "p2",
      { readonly hand?: readonly unknown[]; readonly handCount: number }
    >;
  };
  readonly legalIntents: readonly Record<string, unknown>[];
}

interface CommandErrorMessage {
  readonly code: string;
  readonly message: string;
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
const firstClient = new Client(endpoint);
const firstRoom = await firstClient.joinOrCreate("tempofront");
const secondClient = new Client(endpoint);
const secondRoom = await secondClient.joinById(firstRoom.roomId);

const firstSeat = nextMessage<{ readonly seat: string }>(firstRoom, "seat");
const firstInitial = nextMessage<SnapshotMessage>(firstRoom, "snapshot");
const secondSeat = nextMessage<{ readonly seat: string }>(secondRoom, "seat");
const secondInitial = nextMessage<SnapshotMessage>(secondRoom, "snapshot");
firstRoom.send("ready");
secondRoom.send("ready");
const [
  firstSeatMessage,
  firstInitialSnapshot,
  secondSeatMessage,
  secondInitialSnapshot,
] = await Promise.all([firstSeat, firstInitial, secondSeat, secondInitial]);
if (
  firstSeatMessage.seat !== "p1" ||
  secondSeatMessage.seat !== "p2" ||
  firstInitialSnapshot.commandNumber !== 0 ||
  secondInitialSnapshot.commandNumber !== 0
)
  throw new Error(
    "Initial ready handshake returned an invalid seat or snapshot",
  );

const invalidError = nextMessage<CommandErrorMessage>(
  firstRoom,
  "command_error",
);
firstRoom.send("command", { type: "pass", playerId: "p2" });
const rejected = await invalidError;
if (rejected.code !== "INVALID_INTENT")
  throw new Error(
    `Forged identity was not rejected: ${JSON.stringify(rejected)}`,
  );

const firstSnapshot = nextMessage<SnapshotMessage>(firstRoom, "snapshot");
const secondSnapshot = nextMessage<SnapshotMessage>(secondRoom, "snapshot");
const firstMulligan = firstInitialSnapshot.legalIntents.find(
  (intent) =>
    intent.type === "mulligan" &&
    Array.isArray(intent.instanceIds) &&
    intent.instanceIds.length === 0,
);
if (!firstMulligan || "playerId" in firstMulligan)
  throw new Error("Projected legal intents omitted a safe empty mulligan");
firstRoom.send("command", firstMulligan);
const [p1, p2] = await Promise.all([firstSnapshot, secondSnapshot]);
if (p1.seat !== "p1" || p2.seat !== "p2")
  throw new Error(`Unexpected seats: ${p1.seat}, ${p2.seat}`);
if (p1.hash !== p2.hash || p1.commandNumber !== 1 || p2.commandNumber !== 1)
  throw new Error("Projected snapshots do not describe the same command batch");
if (
  p1.view.players.p1.hand?.length !== 5 ||
  p1.view.players.p2.hand !== undefined
)
  throw new Error("Player 1 projection leaked or omitted a private hand");
if (
  p2.view.players.p2.hand?.length !== 5 ||
  p2.view.players.p1.hand !== undefined
)
  throw new Error("Player 2 projection leaked or omitted a private hand");

await Promise.all([firstRoom.leave(), secondRoom.leave()]);
console.log(
  JSON.stringify({
    roomId: firstRoom.roomId,
    rejected: rejected.code,
    commandNumber: p1.commandNumber,
    sharedHash: p1.hash,
    privateHands: { p1: 5, p2: 5 },
  }),
);
