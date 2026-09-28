import { randomBytes, randomUUID } from "node:crypto";
import { CloseCode, Room, ServerError, type Client } from "@colyseus/core";
import { z } from "zod";
import type { PlayerId } from "@cardforge/card-schema";
import {
  createMatchTelemetry,
  seasonOne,
  type MatchOutcomeReason,
  type RankedParticipant,
  type RankedSettlement,
} from "@cardforge/competitive";
import { matchShardReward } from "@cardforge/economy";
import {
  InviteError,
  type DeckRecord,
  type MatchRewardReceipt,
} from "@cardforge/persistence";
import type { GameEvent } from "@cardforge/rules-kernel";
import {
  proofCardMap,
  type PrototypeLeaderId,
} from "@cardforge/rules-tempofront";
import { ActionClock } from "./action-clock.js";
import { config } from "./config.js";
import {
  PlayabilityError,
  currentLiveOps,
  requirePlayableDeck,
} from "./game-service.js";
import { logger, type Logger } from "./logger.js";
import {
  emptyActivity,
  participantStats,
  type SeatActivity,
} from "./match-stats.js";
import { gauge, metrics } from "./metrics.js";
import { RateLimiter } from "./rate-limit.js";
import { retryWithBackoff } from "./retry.js";
import {
  authenticateRoomJoin,
  identityOf,
  type RoomIdentity,
} from "./room-auth.js";
import { AuthoritativeMatchSession, SessionError } from "./session.js";
import { cardForgeStore } from "./store.js";

export type OnlineQueue = "casual" | "ranked" | "friend";

const joinOptionsSchema = z
  .object({
    deckId: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/),
    inviteCode: z
      .string()
      .regex(/^[A-HJ-NP-Z2-9]{6}$/)
      .optional(),
  })
  .strict();

const reconnectSeconds =
  Number.parseInt(process.env.CARDFORGE_RECONNECT_SECONDS ?? "60", 10) || 60;

/** Rooms waiting for an opponent, by queue, for the queue-size gauge. */
const waitingRooms = new Map<string, OnlineQueue>();
gauge(
  "cardforge_queue_waiting",
  "Players waiting for an opponent, by queue",
  () => {
    const counts = new Map<string, number>([
      ['{queue="casual"}', 0],
      ['{queue="ranked"}', 0],
      ['{queue="friend"}', 0],
    ]);
    for (const queue of waitingRooms.values())
      counts.set(
        `{queue="${queue}"}`,
        (counts.get(`{queue="${queue}"}`) ?? 0) + 1,
      );
    return counts;
  },
);
let activeMatches = 0;
const settlementAttempts = 5;
const settlementRetryMs = 500;
gauge(
  "cardforge_matches_active",
  "Matches in progress on this process",
  () => activeMatches,
);
let connectedClients = 0;
gauge("cardforge_ws_clients", "Connected room clients", () => connectedClients);

function serverSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

interface SeatInfo {
  readonly identity: RoomIdentity;
  readonly deck: DeckRecord;
  readonly joinedAt: number;
}

export interface MatchResult {
  readonly winnerId: PlayerId;
  readonly reason: MatchOutcomeReason;
  readonly settlement: RankedSettlement | null;
  readonly rewards: Partial<Record<PlayerId, MatchRewardReceipt | null>>;
}

export class TempoFrontRoom extends Room {
  override maxClients = 2;
  protected readonly queue: OnlineQueue = "casual";
  #match!: AuthoritativeMatchSession;
  #actionClock!: ActionClock;
  #clockTimer: { clear(): void } | null = null;
  #seed!: number;
  #inviteCode: string | null = null;
  readonly #seats = new Map<string, SeatInfo>();
  readonly #activity: Record<PlayerId, SeatActivity> = {
    p1: emptyActivity(),
    p2: emptyActivity(),
  };
  #startingInitiative: PlayerId = "p1";
  #started = false;
  #result: MatchResult | null = null;
  #finishing: Promise<void> | null = null;
  #countedActive = false;
  #persistChain: Promise<void> = Promise.resolve();
  #log: Logger = logger;
  /** Per-connection message budget; humans need far less than this. */
  readonly #messageBudget = new RateLimiter(config.roomMessageLimit, 5_000);

  #withinBudget(client: Client): boolean {
    if (this.#messageBudget.take(client.sessionId)) return true;
    metrics.commandsRejected.inc({ code: "RATE_LIMITED" });
    client.send("command_error", {
      code: "RATE_LIMITED",
      message: "Slow down — too many actions at once.",
    });
    return false;
  }

  static override onAuth(token: string): Promise<RoomIdentity> {
    return authenticateRoomJoin(token);
  }

  override messages = {
    ready: (client: Client) => {
      if (!this.#started) {
        client.send("waiting", this.#waitingState());
        return;
      }
      client.send("seat", { seat: this.#match.seatFor(client.sessionId) });
      client.send("snapshot", this.#snapshot(client));
    },
    command: async (client: Client, payload: unknown) => {
      if (!this.#withinBudget(client)) return;
      if (!this.#started || this.#result) {
        client.send("command_error", {
          code: this.#result ? "MATCH_OVER" : "MATCH_NOT_READY",
          message: this.#result
            ? "This match has ended."
            : "Your opponent has not joined yet.",
        });
        return;
      }
      try {
        const seat = this.#match.seatFor(client.sessionId);
        const deadline = this.#actionClock.snapshot().deadlines[seat];
        const events = this.#match.submit(client.sessionId, payload);
        this.#activity[seat].actions += 1;
        if (deadline !== null)
          this.#activity[seat].actionMsTotal += Math.max(
            0,
            Date.now() - (deadline - this.#actionClock.actionDurationMs),
          );
        await this.#afterCommands(events);
      } catch (error) {
        if (error instanceof SessionError) {
          metrics.commandsRejected.inc({ code: error.code });
          client.send("command_error", {
            code: error.code,
            message: error.message,
          });
          return;
        }
        throw error;
      }
    },
    concede: async (client: Client) => {
      if (!this.#started || this.#result) return;
      const seat = this.#match.seatFor(client.sessionId);
      await this.#finish(seat === "p1" ? "p2" : "p1", "concession");
    },
  };

  override async onCreate(options: unknown): Promise<void> {
    this.#seed = serverSeed();
    this.#log = logger.child({ matchId: this.roomId, queue: this.queue });
    if (this.queue === "friend") {
      const code = z
        .object({ inviteCode: z.string() })
        .passthrough()
        .safeParse(options);
      if (!code.success)
        throw new ServerError(400, "An invite code is required.");
      const invite = await cardForgeStore.getInvite(code.data.inviteCode);
      if (
        !invite ||
        invite.status === "started" ||
        invite.status === "cancelled"
      )
        throw new ServerError(404, "This invite is no longer valid.");
      this.#inviteCode = invite.code;
      // Close the room when the invite expires without a second player.
      this.clock.setTimeout(
        () => {
          if (!this.#started) void this.disconnect(CloseCode.CONSENTED);
        },
        Math.max(1_000, Date.parse(invite.expiresAt) - Date.now()),
      );
    }
    if (this.queue === "ranked") {
      const liveOps = await currentLiveOps(cardForgeStore);
      if (liveOps.featureFlags["queue.ranked"] === false)
        throw new ServerError(503, "Ranked play is closed right now.");
    }
    this.#match = new AuthoritativeMatchSession({
      matchId: this.roomId,
      seed: this.#seed,
    });
    this.#actionClock = new ActionClock(config.actionClockMs);
    await this.#persist();
    this.#log.info("room created");
  }

  override async onJoin(client: Client, options: unknown): Promise<void> {
    const identity = identityOf(client);
    const selection = joinOptionsSchema.safeParse(options ?? {});
    if (!selection.success)
      throw new ServerError(400, "Choose a deck before joining.");
    if (
      [...this.#seats.values()].some(
        (seat) => seat.identity.accountId === identity.accountId,
      )
    )
      throw new ServerError(
        409,
        "You are already in this match from another tab.",
      );
    if (this.queue === "friend") {
      if (selection.data.inviteCode !== this.#inviteCode)
        throw new ServerError(404, "This invite is no longer valid.");
      try {
        await cardForgeStore.admitToInvite(
          this.#inviteCode,
          identity.accountId,
        );
      } catch (error) {
        if (error instanceof InviteError)
          throw new ServerError(
            4404,
            error.code === "INVITE_EXPIRED"
              ? "This invite has expired. Ask your friend for a new one."
              : "This invite has already been used.",
          );
        throw error;
      }
    }
    let deck: DeckRecord;
    try {
      deck = await requirePlayableDeck(
        cardForgeStore,
        identity.accountId,
        selection.data.deckId,
      );
    } catch (error) {
      if (error instanceof PlayabilityError)
        throw new ServerError(422, error.message);
      throw error;
    }
    this.#seats.set(client.sessionId, { identity, deck, joinedAt: Date.now() });
    this.#match.join(client.sessionId);
    connectedClients += 1;
    metrics.wsJoins.inc({ room: this.queue });
    this.#log.info("player joined", { accountId: identity.accountId });
    if (this.#seats.size >= this.maxClients) await this.#start();
    else waitingRooms.set(this.roomId, this.queue);
  }

  override async onDrop(client: Client): Promise<void> {
    connectedClients = Math.max(0, connectedClients - 1);
    if (!this.#started || this.#result) return;
    const seat = this.#match.seatFor(client.sessionId);
    this.#activity[seat].disconnects += 1;
    metrics.wsDrops.inc({ room: this.queue });
    this.#log.warn("player dropped", { seat });
    this.#broadcastPresence(seat, "reconnecting");
    await this.allowReconnection(client, reconnectSeconds);
  }

  override onReconnect(client: Client): void {
    connectedClients += 1;
    const seat = this.#match.seatFor(client.sessionId);
    this.#activity[seat].reconnects += 1;
    metrics.wsReconnects.inc({ room: this.queue });
    this.#log.info("player reconnected", { seat });
    this.#broadcastPresence(seat, "connected");
    client.send("seat", { seat });
    client.send("snapshot", this.#snapshot(client));
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const wasDrop = code !== CloseCode.CONSENTED;
    if (!wasDrop) connectedClients = Math.max(0, connectedClients - 1);
    if (!this.#started) {
      this.#seats.delete(client.sessionId);
      waitingRooms.delete(this.roomId);
      return;
    }
    if (this.#result) return;
    const seat = this.#match.seatFor(client.sessionId);
    // Leaving an unfinished match forfeits it: deliberately (concession) or
    // by failing to return inside the reconnect window (abandonment).
    await this.#finish(
      seat === "p1" ? "p2" : "p1",
      wasDrop ? "abandonment" : "concession",
    );
  }

  override async onDispose(): Promise<void> {
    this.#clockTimer?.clear();
    waitingRooms.delete(this.roomId);
    this.#endActiveMatch();
    await this.#persistChain;
    await this.#finishing;
  }

  async #start(): Promise<void> {
    const seatInfo = (seat: PlayerId) =>
      [...this.#seats.entries()].find(
        ([sessionId]) => this.#match.seatFor(sessionId) === seat,
      )?.[1];
    const p1 = seatInfo("p1");
    const p2 = seatInfo("p2");
    if (!p1 || !p2) throw new ServerError(500, "Could not seat both players.");
    const leaders = {
      p1: p1.deck.leaderId as PrototypeLeaderId,
      p2: p2.deck.leaderId as PrototypeLeaderId,
    };
    const connections = [...this.#seats.keys()];
    this.#match = new AuthoritativeMatchSession({
      matchId: this.roomId,
      seed: this.#seed,
      leaders,
      decks: { p1: p1.deck.cardIds, p2: p2.deck.cardIds },
    });
    for (const sessionId of connections) this.#match.join(sessionId);
    this.#startingInitiative = this.#match.state.initiative;
    const now = Date.now();
    this.#activity.p1.queueWaitMs = now - p1.joinedAt;
    this.#activity.p2.queueWaitMs = now - p2.joinedAt;
    this.#started = true;
    waitingRooms.delete(this.roomId);
    activeMatches += 1;
    this.#countedActive = true;
    await this.lock();
    await this.#persist();
    await cardForgeStore.recordMatchStart({
      matchId: this.roomId,
      queue: this.queue,
      participants: (["p1", "p2"] as const).map((seat) => {
        const info = seat === "p1" ? p1 : p2;
        return {
          seat,
          accountId: info.identity.accountId,
          displayName: info.identity.displayName,
          deckId: info.deck.deckId,
          deckName: info.deck.name,
          leaderId: info.deck.leaderId,
        };
      }),
    });
    if (this.#inviteCode)
      await cardForgeStore.markInviteStarted(this.#inviteCode, this.roomId);
    for (const info of [p1, p2])
      void cardForgeStore
        .recordProductEvent({
          eventId: `evt:${randomUUID()}`,
          accountId: info.identity.accountId,
          name: "match_started",
          properties: { matchId: this.roomId, queue: this.queue },
        })
        .catch(() => undefined);
    metrics.matchesStarted.inc({ queue: this.queue });
    this.#log.info("match started", {
      p1: p1.identity.accountId,
      p2: p2.identity.accountId,
      leaders,
    });
    this.#syncClock();
    for (const client of this.clients) {
      client.send("seat", { seat: this.#match.seatFor(client.sessionId) });
      client.send("snapshot", this.#snapshot(client));
    }
  }

  async #afterCommands(events: readonly GameEvent[]): Promise<void> {
    await this.#persist();
    const state = this.#match.state;
    if (state.winner && state.victoryReason) {
      this.#broadcast(events);
      await this.#finish(state.winner, state.victoryReason);
      return;
    }
    this.#syncClock();
    this.#broadcast(events);
  }

  /**
   * Records the outcome, telemetry, settlement, and rewards exactly once.
   * Every step is guarded by a receipt, so a failed attempt is retried from
   * the top; if all attempts fail, players still see the decided result and
   * operators get a critical alert to reconcile.
   */
  #finish(winnerId: PlayerId, reason: MatchOutcomeReason): Promise<void> {
    this.#finishing ??= retryWithBackoff(
      (attempt) => this.#settle(winnerId, reason, attempt > 1),
      {
        attempts: settlementAttempts,
        baseDelayMs: settlementRetryMs,
        onRetry: (error, attempt) =>
          this.#log.warn("match settlement attempt failed; retrying", {
            error,
            attempt,
          }),
      },
    ).catch((error: unknown) => {
      metrics.integrityFailures.inc({ kind: "settlement" });
      this.#log.critical("match settlement failed", {
        error,
        winnerId,
        reason,
        attempts: settlementAttempts,
      });
      this.#endActiveMatch();
      this.#complete({ winnerId, reason, settlement: null, rewards: {} });
    });
    return this.#finishing;
  }

  #endActiveMatch(): void {
    if (this.#countedActive) activeMatches = Math.max(0, activeMatches - 1);
    this.#countedActive = false;
  }

  #complete(result: MatchResult): void {
    this.#result = result;
    metrics.matchesCompleted.inc({ queue: this.queue, reason: result.reason });
    this.#log.info("match completed", {
      winnerId: result.winnerId,
      reason: result.reason,
      cycles: this.#match.state.cycle,
      commands: this.#match.replay().acceptedCommands.length,
    });
    this.#broadcast([]);
  }

  async #settle(
    winnerId: PlayerId,
    reason: MatchOutcomeReason,
    retry: boolean,
  ): Promise<void> {
    this.#clockTimer?.clear();
    await this.#persist();
    const state = this.#match.state;
    const replay = this.#match.replay();
    const participants = this.#participants();
    const stats = participantStats(replay, this.#activity, this.#match.engine);
    const firstRecord = await cardForgeStore.recordMatchOutcome({
      matchId: this.roomId,
      winnerId,
      reason,
      cycles: state.cycle,
      stats,
    });
    // A retry resumes when an earlier attempt recorded this same outcome.
    const resumed =
      !firstRecord &&
      retry &&
      (await cardForgeStore
        .getMatchMeta(this.roomId)
        .then((meta) => meta?.winnerId === winnerId && meta.reason === reason));
    if (!firstRecord && !resumed) {
      metrics.integrityFailures.inc({ kind: "duplicate_outcome" });
      this.#log.critical(
        "match outcome already recorded; skipping settlement",
        { winnerId, reason },
      );
      return;
    }
    this.#endActiveMatch();
    const telemetry = createMatchTelemetry({
      replay,
      queue: this.queue,
      ...(this.queue === "ranked" ? { seasonId: seasonOne.seasonId } : {}),
      participants,
      winnerId,
      victoryReason: reason,
      startingInitiative: this.#startingInitiative,
      cycles: state.cycle,
    });
    let settlement: RankedSettlement | null = null;
    if (this.queue === "ranked") {
      settlement = await cardForgeStore.completeRankedMatch({
        matchId: this.roomId,
        seasonId: seasonOne.seasonId,
        participants,
        winnerId,
        cycles: state.cycle,
        telemetry,
      });
      if (!settlement && !retry) {
        metrics.integrityFailures.inc({ kind: "duplicate_ranked_settlement" });
        this.#log.critical(
          "ranked settlement already existed for a fresh outcome",
          { winnerId },
        );
      }
    } else await cardForgeStore.saveTelemetry(telemetry);
    const earlyExit =
      (reason === "concession" || reason === "abandonment") && state.cycle < 3;
    const rewards: Partial<Record<PlayerId, MatchRewardReceipt | null>> = {};
    for (const seat of ["p1", "p2"] as const) {
      const participant = participants[seat];
      const won = seat === winnerId;
      rewards[seat] = await cardForgeStore.settleMatchReward({
        matchId: this.roomId,
        accountId: participant.accountId,
        queue: this.queue,
        seasonId: seasonOne.seasonId,
        participant,
        won,
        cycles: state.cycle,
        shards: matchShardReward(
          this.queue,
          won,
          earlyExit ? "conceded_early" : "played",
        ),
        grantUnrankedXp: this.queue === "casual" && !earlyExit,
      });
      if (rewards[seat] === null && !retry) {
        metrics.integrityFailures.inc({ kind: "duplicate_reward" });
        this.#log.critical("match reward already settled", {
          seat,
          accountId: participant.accountId,
        });
      }
    }
    // Emitted once, after the attempt that finished every settlement step.
    for (const seat of ["p1", "p2"] as const)
      void cardForgeStore
        .recordProductEvent({
          eventId: `evt:${randomUUID()}`,
          accountId: participants[seat].accountId,
          name: "match_completed",
          properties: {
            matchId: this.roomId,
            queue: this.queue,
            result: seat === winnerId ? "win" : "loss",
            reason,
          },
        })
        .catch(() => undefined);
    this.#complete({ winnerId, reason, settlement, rewards });
  }

  #participants(): Readonly<Record<PlayerId, RankedParticipant>> {
    const result = {} as Record<PlayerId, RankedParticipant>;
    for (const [sessionId, info] of this.#seats) {
      const playerId = this.#match.seatFor(sessionId);
      const leaderId = this.#match.state.players[playerId].leader.cardId;
      result[playerId] = {
        playerId,
        accountId: info.identity.accountId,
        leaderId,
        aspects: proofCardMap.get(leaderId)?.aspects ?? [],
      };
    }
    return result;
  }

  #waitingState() {
    return {
      queue: this.queue,
      roomId: this.roomId,
      ...(this.#inviteCode ? { inviteCode: this.#inviteCode } : {}),
      ...(this.queue === "ranked" ? { season: seasonOne } : {}),
    };
  }

  #publicPlayers() {
    const players: Partial<
      Record<PlayerId, { displayName: string; leaderId: string }>
    > = {};
    for (const [sessionId, info] of this.#seats)
      players[this.#match.seatFor(sessionId)] = {
        displayName: info.identity.displayName,
        leaderId: info.deck.leaderId,
      };
    return players;
  }

  #snapshot(client: Client, events: readonly GameEvent[] = []) {
    const seat = this.#match.seatFor(client.sessionId);
    const matchSnapshot = this.#match.snapshot(client.sessionId, events);
    const result = this.#result;
    return {
      ...matchSnapshot,
      matchId: this.roomId,
      legalIntents: this.#started && !result ? matchSnapshot.legalIntents : [],
      clock: this.#actionClock.snapshot(),
      players: this.#publicPlayers(),
      competitive: {
        queue: this.queue,
        ...(this.queue === "ranked" ? { season: seasonOne } : {}),
        settlement: result?.settlement ?? null,
      },
      outcome: result
        ? {
            winnerId: result.winnerId,
            reason: result.reason,
            reward: result.rewards[seat] ?? null,
          }
        : null,
    };
  }

  #broadcast(events: readonly GameEvent[]) {
    for (const recipient of this.clients)
      recipient.send("snapshot", this.#snapshot(recipient, events));
  }

  #broadcastPresence(seat: PlayerId, status: "reconnecting" | "connected") {
    for (const recipient of this.clients)
      recipient.send("presence", {
        seat,
        status,
        graceSeconds: reconnectSeconds,
      });
  }

  #syncClock(): void {
    this.#actionClock.reconcile(
      this.#started && !this.#result ? this.#match.activePlayers() : [],
    );
    this.#clockTimer?.clear();
    const delay = this.#actionClock.nextDelayMs();
    if (delay === null) return;
    this.#clockTimer = this.clock.setTimeout(() => {
      if (this.#result) return;
      const expired = this.#actionClock.expiredPlayers();
      for (const playerId of expired) this.#activity[playerId].timeouts += 1;
      const events = expired.flatMap((playerId) =>
        this.#match.submitTimeout(playerId),
      );
      void this.#afterCommands(events).catch((error: unknown) =>
        this.#log.error("timeout handling failed", { error }),
      );
    }, delay + 1);
  }

  /** Serialised so a slower earlier write can never overwrite a later one. */
  #persist(): Promise<void> {
    const record = {
      status: this.#match.state.winner
        ? ("complete" as const)
        : ("active" as const),
      replay: this.#match.replay(),
    };
    this.#persistChain = this.#persistChain
      .catch(() => undefined)
      .then(() => cardForgeStore.saveMatch(record));
    return this.#persistChain;
  }
}

export class TempoFrontRankedRoom extends TempoFrontRoom {
  protected override readonly queue = "ranked" as const;
}

export class TempoFrontFriendRoom extends TempoFrontRoom {
  protected override readonly queue = "friend" as const;
}
