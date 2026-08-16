import { randomBytes } from "node:crypto";
import { Room, type Client } from "@colyseus/core";
import type { GameEvent } from "@cardforge/rules-kernel";
import { ActionClock } from "./action-clock.js";
import { AuthoritativeMatchSession, SessionError } from "./session.js";
import { cardForgeStore } from "./store.js";
import { z } from "zod";
import {
  defaultPrototypeLeaders,
  prototypeDecks,
  type PrototypeLeaderId,
} from "@cardforge/rules-tempofront";
import type { DeckRecord } from "@cardforge/persistence";

const joinOptionsSchema = z
  .object({
    accountId: z.string().min(3).max(80),
    deckId: z.string().min(3).max(80),
  })
  .strict();

function serverSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

export class TempoFrontRoom extends Room {
  override maxClients = 2;
  #match!: AuthoritativeMatchSession;
  #actionClock!: ActionClock;
  #clockTimer: { clear(): void } | null = null;
  #seed!: number;
  readonly #selectedDecks = new Map<string, DeckRecord>();

  override messages = {
    ready: (client: Client) => {
      client.send("seat", { seat: this.#match.seatFor(client.sessionId) });
      this.#syncClock();
      this.#broadcast([]);
    },
    command: async (client: Client, payload: unknown) => {
      try {
        if (this.clients.length < this.maxClients) {
          client.send("command_error", {
            code: "MATCH_NOT_READY",
            message: "The second seat has not joined yet.",
          });
          return;
        }
        const events = this.#match.submit(client.sessionId, payload);
        await this.#persist();
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

  override async onCreate(): Promise<void> {
    this.#seed = serverSeed();
    this.#match = new AuthoritativeMatchSession({
      matchId: this.roomId,
      seed: this.#seed,
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
    await this.#persist();
  }

  override async onJoin(client: Client, options: unknown): Promise<void> {
    const selection = joinOptionsSchema.safeParse(options);
    if (!selection.success && Object.keys((options as object) ?? {}).length)
      throw new Error("Saved deck selection is malformed");
    if (selection.success) {
      const deck = await cardForgeStore.getDeck(
        selection.data.accountId,
        selection.data.deckId,
      );
      if (!deck)
        throw new Error(
          `Selected deck does not exist: ${selection.data.accountId}/${selection.data.deckId}`,
        );
      this.#selectedDecks.set(client.sessionId, deck);
    }
    this.#match.join(client.sessionId);
    if (this.clients.length >= this.maxClients) {
      const selectedBySeat = new Map(
        this.clients.map((roomClient) => [
          this.#match.seatFor(roomClient.sessionId),
          this.#selectedDecks.get(roomClient.sessionId),
        ]),
      );
      const p1 = selectedBySeat.get("p1");
      const p2 = selectedBySeat.get("p2");
      const leaderIds = {
        p1: (p1?.leaderId ?? defaultPrototypeLeaders.p1) as PrototypeLeaderId,
        p2: (p2?.leaderId ?? defaultPrototypeLeaders.p2) as PrototypeLeaderId,
      };
      if (
        !(leaderIds.p1 in prototypeDecks) ||
        !(leaderIds.p2 in prototypeDecks)
      )
        throw new Error("Selected deck uses an unavailable Leader");
      this.#match = new AuthoritativeMatchSession({
        matchId: this.roomId,
        seed: this.#seed,
        leaders: leaderIds,
        decks: {
          p1: p1?.cardIds ?? prototypeDecks[leaderIds.p1],
          p2: p2?.cardIds ?? prototypeDecks[leaderIds.p2],
        },
      });
      for (const roomClient of this.clients)
        this.#match.join(roomClient.sessionId);
      await this.#persist();
    }
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
    const matchSnapshot = this.#match.snapshot(client.sessionId, events);
    return {
      ...matchSnapshot,
      legalIntents:
        this.clients.length >= this.maxClients
          ? matchSnapshot.legalIntents
          : [],
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
      void this.#persist().then(() => {
        this.#syncClock();
        this.#broadcast(events);
      });
    }, delay + 1);
  }

  async #persist(): Promise<void> {
    await cardForgeStore.saveMatch({
      status: this.#match.state.winner ? "complete" : "active",
      replay: this.#match.replay(),
    });
  }
}
