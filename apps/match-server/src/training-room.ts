import { randomBytes } from "node:crypto";
import { Room, type Client } from "@colyseus/core";
import { z } from "zod";
import type { Command, GameEvent } from "@cardforge/rules-kernel";
import { prototypeDecks } from "@cardforge/rules-tempofront";
import {
  trainingMatchSetup,
  trainingScenarios,
  type TrainingScenario,
} from "@cardforge/training";
import { intentFromCommand } from "./intents.js";
import { AuthoritativeMatchSession, SessionError } from "./session.js";
import { cardForgeStore } from "./store.js";

const trainingOptions = z
  .object({
    accountId: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/),
    scenarioId: z.string().regex(/^[a-z0-9.-]{3,80}$/),
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

export class TempoFrontTrainingRoom extends Room {
  override maxClients = 1;
  #match!: AuthoritativeMatchSession;
  #scenario!: TrainingScenario;
  #accountId!: string;
  #humanConnectionId: string | null = null;
  #completion: {
    readonly firstCompletion: boolean;
    readonly scenarioId: string;
  } | null = null;
  #finished = false;

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
            message: "This scenario has already ended.",
          });
          return;
        }
        const events = [...this.#match.submit(client.sessionId, payload)];
        events.push(...this.#runBot());
        await this.#persistAndReward();
        client.send("snapshot", this.#snapshot(events));
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

  override async onCreate(options: unknown): Promise<void> {
    const parsed = trainingOptions.safeParse(options);
    if (!parsed.success) throw new Error("Training room options are malformed");
    const scenario = trainingScenarios.find(
      (candidate) => candidate.scenarioId === parsed.data.scenarioId,
    );
    if (!scenario) throw new Error("Training scenario does not exist");
    await cardForgeStore.getEconomySnapshot(parsed.data.accountId);
    this.#scenario = scenario;
    this.#accountId = parsed.data.accountId;
    this.#match = new AuthoritativeMatchSession({
      matchId: this.roomId,
      seed: serverSeed(),
      leaders: {
        p1: scenario.playerLeaderId,
        p2: scenario.opponentLeaderId,
      },
      decks: {
        p1: prototypeDecks[scenario.playerLeaderId],
        p2: prototypeDecks[scenario.opponentLeaderId],
      },
      setup: trainingMatchSetup(scenario),
    });
    await this.#persistAndReward();
  }

  override async onJoin(client: Client): Promise<void> {
    if (this.#humanConnectionId)
      throw new Error("Training room is already occupied");
    this.#humanConnectionId = client.sessionId;
    this.#match.join(client.sessionId);
    this.#match.join(botConnectionId);
    await this.lock();
  }

  override async onDrop(client: Client): Promise<void> {
    await this.allowReconnection(client, 30);
  }

  override onReconnect(client: Client): void {
    this.#humanConnectionId = client.sessionId;
    client.send("snapshot", this.#snapshot());
  }

  #runBot(): readonly GameEvent[] {
    const events: GameEvent[] = [];
    for (
      let operation = 0;
      operation < 16 && !this.#match.state.winner;
      operation += 1
    ) {
      const legal = this.#match.engine.getLegalCommands(
        this.#match.state,
        "p2",
      );
      const humanLegal = this.#match.engine.getLegalCommands(
        this.#match.state,
        "p1",
      );
      if (!legal.length || humanLegal.length) break;
      const command = chooseTrainingBotCommand(legal);
      if (!command) break;
      events.push(
        ...this.#match.submitForPlayer("p2", intentFromCommand(command)),
      );
    }
    return events;
  }

  #objectiveSatisfied(): boolean {
    const state = this.#match.state;
    const objective = this.#scenario.objective;
    if (objective.type === "survive_cycles")
      return state.cycle >= objective.cycles && state.winner !== "p2";
    if (state.winner !== "p1") return false;
    if (objective.type === "win_match") return true;
    return state.victoryReason === objective.type.replace("win_", "");
  }

  async #persistAndReward(): Promise<void> {
    const completed = this.#objectiveSatisfied();
    this.#finished = completed || this.#match.state.winner !== null;
    await cardForgeStore.saveMatch({
      status: this.#finished ? "complete" : "active",
      replay: this.#match.replay(),
    });
    if (!completed || this.#completion) return;
    const result = await cardForgeStore.completeTrainingScenario(
      `training-room:${this.roomId}`,
      this.#accountId,
      this.#scenario.scenarioId,
      {
        shards: this.#scenario.reward.shards,
        styleTokens: this.#scenario.reward.styleTokens,
      },
    );
    this.#completion = {
      firstCompletion: result.firstCompletion,
      scenarioId: result.scenarioId,
    };
  }

  #snapshot(events: readonly GameEvent[] = []) {
    if (!this.#humanConnectionId) return null;
    const snapshot = this.#match.snapshot(this.#humanConnectionId, events);
    const legalCommands = this.#match.engine.getLegalCommands(
      this.#match.state,
      "p1",
    );
    return {
      ...snapshot,
      legalIntents: legalCommands.map((command) => intentFromCommand(command)),
      scenario: this.#scenario,
      opponent: { kind: "heuristic_bot", label: "Field Automaton" },
      clock: {
        serverNowMs: Date.now(),
        actionDurationMs: 0,
        deadlines: { p1: null, p2: null },
      },
      competitive: { queue: "pve" },
      completion: this.#completion,
      finished: this.#finished,
    };
  }
}
