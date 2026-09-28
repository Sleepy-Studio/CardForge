import { randomUUID } from "node:crypto";
import { Client, type Room } from "@colyseus/sdk";

/*
 * Test-only helpers that drive the public API exactly as a browser would:
 * register with a password, keep the session cookie, mint a match ticket,
 * and join rooms with it. No developer headers or database access.
 */

export const endpoint = process.env.CARDFORGE_SERVER_URL ?? "http://127.0.0.1:2567";
const origin = process.env.CARDFORGE_SMOKE_ORIGIN ?? "http://localhost:3000";

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke assertion failed: ${message}`);
}

export class SmokeAccount {
  #cookie = "";
  accountId = "";
  readonly email: string;

  constructor(
    readonly label: string,
    readonly displayName = `${label} ${randomUUID().slice(0, 4)}`,
  ) {
    this.email = `${label.toLowerCase().replace(/[^a-z0-9]/g, "")}-${randomUUID().slice(0, 8)}@smoke.test`;
  }

  async api<T = Record<string, unknown>>(
    path: string,
    init: { method?: string; body?: unknown; expect?: number } = {},
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${endpoint}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        origin,
        ...(this.#cookie ? { cookie: this.#cookie } : {}),
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      redirect: "manual",
    });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const header of setCookie) {
      const [pair] = header.split(";");
      if (pair?.startsWith("cardforge_session="))
        this.#cookie = pair.endsWith("=") ? "" : pair;
    }
    const text = await response.text();
    const body = (text ? JSON.parse(text) : {}) as T;
    if (init.expect !== undefined && response.status !== init.expect)
      throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status} (expected ${init.expect}): ${text.slice(0, 300)}`);
    return { status: response.status, body };
  }

  async register(): Promise<this> {
    const { body } = await this.api<{ account: { accountId: string } }>("/api/auth/register", {
      body: {
        email: this.email,
        password: "smoke-password-123",
        displayName: this.displayName,
        ...(process.env.CARDFORGE_SMOKE_SIGNUP_CODE
          ? { signupCode: process.env.CARDFORGE_SMOKE_SIGNUP_CODE }
          : {}),
      },
      expect: 201,
    });
    this.accountId = body.account.accountId;
    return this;
  }

  async onboard(leaderId = "leader.ember"): Promise<string> {
    const { body } = await this.api<{ deckId: string }>("/api/me/onboarding/starter", {
      body: { leaderId },
      expect: 201,
    });
    await this.api("/api/me/onboarding/complete", { body: {}, expect: 200 });
    return body.deckId;
  }

  async client(): Promise<Client> {
    const { body } = await this.api<{ ticket: string }>("/api/me/match-ticket", { body: {}, expect: 200 });
    const client = new Client(endpoint);
    client.auth.token = body.ticket;
    return client;
  }
}

export function nextMessage<T>(room: Room, type: string, timeoutMs = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
    const off = room.onMessage(type, (message) => {
      clearTimeout(timeout);
      off();
      resolve(message as T);
    });
  });
}

export interface SmokeSnapshot {
  readonly seat: "p1" | "p2";
  readonly matchId: string;
  readonly commandNumber: number;
  readonly hash: string;
  readonly legalIntents: readonly Record<string, unknown>[];
  readonly view: {
    readonly cycle: number;
    readonly winner: "p1" | "p2" | null;
    readonly players: Record<"p1" | "p2", { readonly hand?: readonly unknown[] }>;
  };
  readonly outcome: {
    readonly winnerId: "p1" | "p2";
    readonly reason: string;
    readonly reward: { readonly shards: number; readonly xp: number } | null;
  } | null;
  readonly competitive: { readonly settlement: unknown };
}

/** Tracks the latest snapshot for a room without losing messages. */
export class SnapshotFeed {
  latest: SmokeSnapshot | null = null;
  readonly errors: string[] = [];
  #waiters: ((snapshot: SmokeSnapshot) => void)[] = [];

  constructor(readonly room: Room) {
    room.onMessage("snapshot", (snapshot: SmokeSnapshot) => {
      this.latest = snapshot;
      const waiters = this.#waiters;
      this.#waiters = [];
      for (const waiter of waiters) waiter(snapshot);
    });
    room.onMessage("command_error", (error: { message?: string }) =>
      this.errors.push(error.message ?? "command error"),
    );
    room.onMessage("seat", () => undefined);
    room.onMessage("waiting", () => undefined);
    room.onMessage("presence", () => undefined);
  }

  until(predicate: (snapshot: SmokeSnapshot) => boolean, timeoutMs = 15_000): Promise<SmokeSnapshot> {
    if (this.latest && predicate(this.latest)) return Promise.resolve(this.latest);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out waiting for snapshot condition (last command ${this.latest?.commandNumber})`)),
        timeoutMs,
      );
      const check = (snapshot: SmokeSnapshot) => {
        if (predicate(snapshot)) {
          clearTimeout(timeout);
          resolve(snapshot);
        } else this.#waiters.push(check);
      };
      this.#waiters.push(check);
    });
  }
}

/**
 * Deterministic-ish policy that keeps a game moving toward a finish: take
 * the first non-pass action most of the time, otherwise pass.
 */
export function pickIntent(
  intents: readonly Record<string, unknown>[],
  step: number,
): Record<string, unknown> {
  const mulligan = intents.find((intent) => intent.type === "mulligan");
  if (mulligan) return { type: "mulligan", instanceIds: [] };
  const passResponse = intents.find((intent) => intent.type === "pass_response");
  if (passResponse) return passResponse;
  const actions = intents.filter((intent) => intent.type !== "pass");
  const strike = actions.find((intent) => intent.type === "strike");
  if (strike && step % 2 === 0) return strike;
  if (actions.length && step % 5 !== 4) return actions[step % actions.length]!;
  return intents.find((intent) => intent.type === "pass") ?? intents[0]!;
}

/** Plays both seats until the server reports an outcome. */
export async function playToCompletion(
  /** Mutable so a caller can swap in a feed after reconnecting. */
  feeds: SnapshotFeed[],
  options: { readonly maxCommands?: number; readonly onStep?: (step: number) => Promise<void> } = {},
): Promise<SmokeSnapshot> {
  const max = options.maxCommands ?? 1_500;
  for (let step = 0; step < max; step += 1) {
    const done = feeds.find((feed) => feed.latest?.outcome);
    if (done) return done.latest!;
    const newest = Math.max(...feeds.map((feed) => feed.latest?.commandNumber ?? 0));
    await Promise.all(
      feeds.map((feed) =>
        feed.until((snapshot) => snapshot.commandNumber >= newest || snapshot.outcome !== null),
      ),
    );
    const actor = feeds.find((feed) => (feed.latest?.legalIntents.length ?? 0) > 0);
    if (!actor) {
      await Promise.race(feeds.map((feed) => feed.until((snapshot) => snapshot.legalIntents.length > 0 || snapshot.outcome !== null)));
      continue;
    }
    const before = actor.latest!.commandNumber;
    actor.room.send("command", pickIntent(actor.latest!.legalIntents, step));
    await actor.until((snapshot) => snapshot.commandNumber > before || snapshot.outcome !== null);
    await options.onStep?.(step);
  }
  throw new Error("Match did not finish within the command budget");
}
