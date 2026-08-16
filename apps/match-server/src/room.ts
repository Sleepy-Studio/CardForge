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
import {
  createCompetitiveProfile,
  createMatchTelemetry,
  seasonOne,
  type RankedParticipant,
  type RankedSettlement,
} from "@cardforge/competitive";
import type { PlayerId } from "@cardforge/card-schema";
import { proofCardMap } from "@cardforge/rules-tempofront";

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
  protected readonly queue: "casual" | "ranked" = "casual";
  #match!: AuthoritativeMatchSession;
  #actionClock!: ActionClock;
  #clockTimer: { clear(): void } | null = null;
  #seed!: number;
  readonly #selectedDecks = new Map<string, DeckRecord>();
  #startingInitiative: PlayerId = "p1";
  #settlement: RankedSettlement | null = null;
  #telemetryStored = false;

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
      if (this.queue === "ranked") {
        let profile = await cardForgeStore.getCompetitiveProfile(
          deck.accountId,
          seasonOne.seasonId,
        );
        if (!profile) {
          profile = createCompetitiveProfile(
            deck.accountId,
            seasonOne.seasonId,
          );
          await cardForgeStore.saveCompetitiveProfile(profile);
        }
        if (!profile.unlockedLeaderIds.includes(deck.leaderId))
          throw new Error(
            `Leader is not unlocked for ranked play: ${deck.leaderId}`,
          );
      }
    }
    if (this.queue === "ranked" && !selection.success)
      throw new Error("Ranked matchmaking requires a saved deck");
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
      if (this.queue === "ranked" && p1?.accountId === p2?.accountId)
        throw new Error("Ranked opponents must use different accounts");
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
      this.#startingInitiative = this.#match.state.initiative;
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
      competitive: {
        queue: this.queue,
        ...(this.queue === "ranked" ? { season: seasonOne } : {}),
        settlement: this.#settlement,
      },
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
    if (!this.#match.state.winner || this.#telemetryStored) return;
    const participants = this.#participants();
    const victoryReason = this.#match.state.victoryReason;
    if (!victoryReason) return;
    const telemetry = createMatchTelemetry({
      replay: this.#match.replay(),
      queue: this.queue,
      ...(this.queue === "ranked" ? { seasonId: seasonOne.seasonId } : {}),
      participants,
      winnerId: this.#match.state.winner,
      victoryReason,
      startingInitiative: this.#startingInitiative,
      cycles: this.#match.state.cycle,
    });
    if (this.queue === "ranked")
      this.#settlement = await cardForgeStore.completeRankedMatch({
        matchId: this.roomId,
        seasonId: seasonOne.seasonId,
        participants,
        winnerId: this.#match.state.winner,
        cycles: this.#match.state.cycle,
        telemetry,
      });
    else await cardForgeStore.saveTelemetry(telemetry);
    this.#telemetryStored = true;
  }

  #participants(): Readonly<Record<PlayerId, RankedParticipant>> {
    const result = {} as Record<PlayerId, RankedParticipant>;
    for (const client of this.clients) {
      const playerId = this.#match.seatFor(client.sessionId);
      const deck = this.#selectedDecks.get(client.sessionId);
      const leaderId = this.#match.state.players[playerId].leader.cardId;
      const leader = proofCardMap.get(leaderId);
      result[playerId] = {
        playerId,
        accountId: deck?.accountId ?? `guest-${client.sessionId}`,
        leaderId,
        aspects: leader?.aspects ?? [],
      };
    }
    return result;
  }
}

export class TempoFrontRankedRoom extends TempoFrontRoom {
  protected override readonly queue = "ranked" as const;
}
