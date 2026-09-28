import { randomBytes, randomUUID } from "node:crypto";
import { Room, ServerError, type Client } from "@colyseus/core";
import { z } from "zod";
import type { Command, GameEvent } from "@cardforge/rules-kernel";
import { monoStarterLeaders } from "@cardforge/competitive";
import { prototypeDecks, type PrototypeLeaderId } from "@cardforge/rules-tempofront";
import {
  trainingMatchSetup,
  trainingScenarios,
  type TrainingScenario,
} from "@cardforge/training";
import { deckLegalityErrors, isKnownLeader } from "./game-service.js";
import { intentFromCommand } from "./intents.js";
import { logger, type Logger } from "./logger.js";
import { emptyActivity, participantStats } from "./match-stats.js";
import { metrics } from "./metrics.js";
import { authenticateRoomJoin, identityOf, type RoomIdentity } from "./room-auth.js";
import { AuthoritativeMatchSession, SessionError } from "./session.js";
import { cardForgeStore } from "./store.js";

const scenarioOptions = z
  .object({ scenarioId: z.string().regex(/^[a-z0-9.-]{3,80}$/) })
  .strict();

const practiceOptions = z
  .object({
    mode: z.literal("practice"),
    deckId: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/).optional(),
    opponentLeaderId: z.string().regex(/^leader\.[a-z_]{2,40}$/).optional(),
  })
  .strict();

const botConnectionId = "__cardforge_training_bot__";

function serverSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

export function chooseTrainingBotCommand(
  commands: readonly Command[],
): Command | null {
  return (
    commands.find(
      (command) =>
        command.type === "mulligan" && command.instanceIds.length === 0,
    ) ??
    commands.find((command) => command.type === "pass_response") ??
    commands.find((command) => command.type === "strike") ??
    commands.find((command) => command.type === "play_card") ??
    commands.find((command) => command.type === "activate_ability") ??
    commands.find((command) => command.type === "shift") ??
    commands.find((command) => command.type === "prepare_card") ??
    commands.find((command) => command.type === "pass") ??
    commands[0] ??
    null
  );
}

type TrainingPlan =
  | { readonly kind: "scenario"; readonly scenario: TrainingScenario }
  | {
      readonly kind: "practice";
      readonly deckId: string | null;
      readonly opponentLeaderId: PrototypeLeaderId;
    };

/**
 * Single-player authoritative room for Academy scenarios and Practice. The
 * bot submits ordinary intents through the same session as a human, so every
 * command is replayable. Identity comes only from the verified ticket.
 */
export class TempoFrontTrainingRoom extends Room {
  override maxClients = 1;
  #match!: AuthoritativeMatchSession;
  #plan!: TrainingPlan;
  #identity: RoomIdentity | null = null;
  #humanConnectionId: string | null = null;
  #completion: {
    readonly firstCompletion: boolean;
    readonly scenarioId: string;
  } | null = null;
  #finished = false;
  #outcomeRecorded = false;
  #log: Logger = logger;

  static override onAuth(token: string): Promise<RoomIdentity> {
    return authenticateRoomJoin(token);
  }

  override messages = {
    ready: (client: Client) => {
      client.send("seat", { seat: "p1" });
      client.send("snapshot", this.#snapshot());
    },
    command: async (client: Client, payload: unknown) => {
      try {
        if (this.#finished) {
          client.send("command_error", {
            code: "SCENARIO_COMPLETE",
            message: "This match has already ended.",
          });
          return;
        }
        const events = [...this.#match.submit(client.sessionId, payload)];
        events.push(...this.#runBot());
        await this.#persistAndReward();
        client.send("snapshot", this.#snapshot(events));
      } catch (error) {
        if (error instanceof SessionError) {
          metrics.commandsRejected.inc({ code: error.code });
          client.send("command_error", { code: error.code, message: error.message });
          return;
        }
        throw error;
      }
    },
    concede: async (client: Client) => {
      if (this.#finished) return;
      this.#finished = true;
      await this.#recordPracticeOutcome("p2", "concession");
      client.send("snapshot", this.#snapshot());
    },
  };

  override onCreate(options: unknown): void {
    const scenario = scenarioOptions.safeParse(options);
    const practice = practiceOptions.safeParse(options);
    if (scenario.success) {
      const found = trainingScenarios.find(
        (candidate) => candidate.scenarioId === scenario.data.scenarioId,
      );
      if (!found) throw new ServerError(404, "That scenario does not exist.");
      this.#plan = { kind: "scenario", scenario: found };
    } else if (practice.success) {
      const opponent = practice.data.opponentLeaderId;
      const opponentLeaderId: PrototypeLeaderId =
        opponent && isKnownLeader(opponent)
          ? opponent
          : monoStarterLeaders[randomBytes(1)[0]! % monoStarterLeaders.length]!;
      this.#plan = {
        kind: "practice",
        deckId: practice.data.deckId ?? null,
        opponentLeaderId,
      };
    } else throw new ServerError(400, "Training room options are malformed.");
    this.#log = logger.child({ matchId: this.roomId, queue: this.#plan.kind });
  }

  override async onJoin(client: Client): Promise<void> {
    if (this.#humanConnectionId) throw new ServerError(409, "This room is occupied.");
    const identity = identityOf(client);
    this.#identity = identity;
    await cardForgeStore.getEconomySnapshot(identity.accountId);
    const plan = this.#plan;
    if (plan.kind === "scenario") {
      this.#match = new AuthoritativeMatchSession({
        matchId: this.roomId,
        seed: serverSeed(),
        leaders: { p1: plan.scenario.playerLeaderId, p2: plan.scenario.opponentLeaderId },
        decks: {
          p1: prototypeDecks[plan.scenario.playerLeaderId],
          p2: prototypeDecks[plan.scenario.opponentLeaderId],
        },
        setup: trainingMatchSetup(plan.scenario),
      });
    } else {
      // Practice never grants rewards, so any legal saved deck may be used,
      // including one with cards still to be crafted.
      const deck = plan.deckId ? await cardForgeStore.getDeck(identity.accountId, plan.deckId) : null;
      if (plan.deckId && !deck) throw new ServerError(404, "That deck no longer exists.");
      if (deck && deckLegalityErrors(deck.leaderId, deck.cardIds).length)
        throw new ServerError(422, "That deck is not legal yet.");
      const playerLeaderId = (deck?.leaderId ?? "leader.ember") as PrototypeLeaderId;
      this.#match = new AuthoritativeMatchSession({
        matchId: this.roomId,
        seed: serverSeed(),
        leaders: { p1: playerLeaderId, p2: plan.opponentLeaderId },
        decks: {
          p1: deck?.cardIds ?? prototypeDecks[playerLeaderId],
          p2: prototypeDecks[plan.opponentLeaderId],
        },
      });
      await cardForgeStore.saveMatch({ status: "active", replay: this.#match.replay() });
      await cardForgeStore.recordMatchStart({
        matchId: this.roomId,
        queue: "practice",
        participants: [
          {
            seat: "p1",
            accountId: identity.accountId,
            displayName: identity.displayName,
            deckId: deck?.deckId ?? null,
            deckName: deck?.name ?? "Starter deck",
            leaderId: playerLeaderId,
          },
          {
            seat: "p2",
            accountId: null,
            displayName: "Practice Automaton",
            deckId: null,
            deckName: null,
            leaderId: plan.opponentLeaderId,
          },
        ],
      });
    }
    this.#humanConnectionId = client.sessionId;
    this.#match.join(client.sessionId);
    this.#match.join(botConnectionId);
    metrics.wsJoins.inc({ room: plan.kind });
    await this.#persistAndReward();
    await this.lock();
  }

  override async onDrop(client: Client): Promise<void> {
    metrics.wsDrops.inc({ room: this.#plan.kind });
    await this.allowReconnection(client, 60);
  }

  override onReconnect(client: Client): void {
    metrics.wsReconnects.inc({ room: this.#plan.kind });
    this.#humanConnectionId = client.sessionId;
    client.send("seat", { seat: "p1" });
    client.send("snapshot", this.#snapshot());
  }

  #runBot(): readonly GameEvent[] {
    const events: GameEvent[] = [];
    for (let operation = 0; operation < 16 && !this.#match.state.winner; operation += 1) {
      const legal = this.#match.engine.getLegalCommands(this.#match.state, "p2");
      const humanLegal = this.#match.engine.getLegalCommands(this.#match.state, "p1");
      if (!legal.length || humanLegal.length) break;
      const command = chooseTrainingBotCommand(legal);
      if (!command) break;
      events.push(...this.#match.submitForPlayer("p2", intentFromCommand(command)));
    }
    return events;
  }

  #objectiveSatisfied(): boolean {
    if (this.#plan.kind === "practice") return false;
    const state = this.#match.state;
    const objective = this.#plan.scenario.objective;
    if (objective.type === "survive_cycles")
      return state.cycle >= objective.cycles && state.winner !== "p2";
    if (state.winner !== "p1") return false;
    if (objective.type === "win_match") return true;
    return state.victoryReason === objective.type.replace("win_", "");
  }

  async #recordPracticeOutcome(
    winnerId: "p1" | "p2",
    reason: "integrity" | "dominion" | "concession",
  ): Promise<void> {
    if (this.#plan.kind !== "practice" || this.#outcomeRecorded) return;
    this.#outcomeRecorded = true;
    await cardForgeStore.saveMatch({ status: "complete", replay: this.#match.replay() });
    const activity = { p1: emptyActivity(), p2: emptyActivity() };
    await cardForgeStore.recordMatchOutcome({
      matchId: this.roomId,
      winnerId,
      reason,
      cycles: this.#match.state.cycle,
      stats: participantStats(this.#match.replay(), activity, this.#match.engine),
    });
    this.#log.info("practice completed", { winnerId, reason });
  }

  async #persistAndReward(): Promise<void> {
    const state = this.#match.state;
    const completed = this.#objectiveSatisfied();
    this.#finished = this.#finished || completed || state.winner !== null;
    await cardForgeStore.saveMatch({
      status: this.#finished ? "complete" : "active",
      replay: this.#match.replay(),
    });
    if (state.winner && state.victoryReason)
      await this.#recordPracticeOutcome(state.winner, state.victoryReason);
    if (!completed || this.#completion || this.#plan.kind !== "scenario" || !this.#identity) return;
    const scenario = this.#plan.scenario;
    const result = await cardForgeStore.completeTrainingScenario(
      `training-room:${this.roomId}`,
      this.#identity.accountId,
      scenario.scenarioId,
      { shards: scenario.reward.shards, styleTokens: scenario.reward.styleTokens },
    );
    this.#completion = { firstCompletion: result.firstCompletion, scenarioId: result.scenarioId };
    void cardForgeStore
      .recordProductEvent({
        eventId: `evt:${randomUUID()}`,
        accountId: this.#identity.accountId,
        name: "scenario_completed",
        properties: { scenarioId: scenario.scenarioId, kind: scenario.kind },
      })
      .catch(() => undefined);
  }

  #snapshot(events: readonly GameEvent[] = []) {
    if (!this.#humanConnectionId) return null;
    const snapshot = this.#match.snapshot(this.#humanConnectionId, events);
    const state = this.#match.state;
    const plan = this.#plan;
    return {
      ...snapshot,
      matchId: this.roomId,
      legalIntents: this.#finished
        ? []
        : this.#match.engine.getLegalCommands(state, "p1").map((command) => intentFromCommand(command)),
      ...(plan.kind === "scenario" ? { scenario: plan.scenario } : {}),
      opponent: {
        kind: "heuristic_bot",
        label: plan.kind === "practice" ? "Practice Automaton" : "Field Automaton",
      },
      players: {
        p1: { displayName: this.#identity?.displayName ?? "You", leaderId: state.players.p1.leader.cardId },
        p2: {
          displayName: plan.kind === "practice" ? "Practice Automaton" : "Field Automaton",
          leaderId: state.players.p2.leader.cardId,
        },
      },
      clock: {
        serverNowMs: Date.now(),
        actionDurationMs: 0,
        deadlines: { p1: null, p2: null },
      },
      competitive: { queue: plan.kind === "practice" ? "practice" : "pve", settlement: null },
      outcome:
        plan.kind === "practice" && this.#finished
          ? {
              winnerId: state.winner ?? "p2",
              reason: state.victoryReason ?? "concession",
              reward: null,
            }
          : null,
      completion: this.#completion,
      finished: this.#finished,
    };
  }
}
