import { randomBytes } from "node:crypto";
import { Room, type Client } from "@colyseus/core";
import type { GameEvent } from "@cardforge/rules-kernel";
import { ActionClock } from "./action-clock.js";
import { AuthoritativeMatchSession, SessionError } from "./session.js";

function serverSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

export class TempoFrontRoom extends Room {
  override maxClients = 2;
  #match!: AuthoritativeMatchSession;
  #actionClock!: ActionClock;
  #clockTimer: { clear(): void } | null = null;

  override messages = {
    ready: (client: Client) => {
      client.send("seat", { seat: this.#match.seatFor(client.sessionId) });
      this.#syncClock();
      this.#broadcast([]);
    },
    command: (client: Client, payload: unknown) => {
      try {
        const events = this.#match.submit(client.sessionId, payload);
        this.#syncClock();
        this.#broadcast(events);
      } catch (error) {
        if (error instanceof SessionError) {
          client.send("command_error", {
            code: error.code,
            message: error.message,
          });
          return;
        }
        throw error;
      }
    },
  };

  override onCreate(): void {
    this.#match = new AuthoritativeMatchSession({
      matchId: this.roomId,
      seed: serverSeed(),
    });
    const configuredDuration = Number.parseInt(
      process.env.CARDFORGE_ACTION_CLOCK_MS ?? "30000",
      10,
    );
    this.#actionClock = new ActionClock(
      Number.isSafeInteger(configuredDuration) && configuredDuration > 0
        ? configuredDuration
        : 30_000,
    );
  }

  override async onJoin(client: Client): Promise<void> {
    this.#match.join(client.sessionId);
    this.#syncClock();
    if (this.clients.length >= this.maxClients) await this.lock();
  }

  override async onDrop(client: Client): Promise<void> {
    await this.allowReconnection(client, 30);
  }

  override onReconnect(client: Client): void {
    client.send("snapshot", this.#snapshot(client));
  }

  override onDispose(): void {
    this.#clockTimer?.clear();
  }

  #snapshot(client: Client, events: readonly GameEvent[] = []) {
    return {
      ...this.#match.snapshot(client.sessionId, events),
      clock: this.#actionClock.snapshot(),
    };
  }

  #broadcast(events: Parameters<AuthoritativeMatchSession["snapshot"]>[1]) {
    for (const recipient of this.clients)
      recipient.send("snapshot", this.#snapshot(recipient, events));
  }

  #syncClock(): void {
    this.#actionClock.reconcile(
      this.clients.length >= this.maxClients ? this.#match.activePlayers() : [],
    );
    this.#clockTimer?.clear();
    const delay = this.#actionClock.nextDelayMs();
    if (delay === null) return;
    this.#clockTimer = this.clock.setTimeout(() => {
      const events = this.#actionClock
        .expiredPlayers()
        .flatMap((playerId) => this.#match.submitTimeout(playerId));
      this.#syncClock();
      this.#broadcast(events);
    }, delay + 1);
  }
}
