import type { PlayerId } from "@cardforge/card-schema";
import {
  stateHash,
  type Command,
  type GameEvent,
  type GameState,
  type ProjectedGameView,
  type ReplayRecord,
} from "@cardforge/rules-kernel";
import {
  defaultPrototypeLeaders,
  prototypeDecks,
  replayGame,
  TempoFrontEngine,
  type PrototypeLeaderId,
} from "@cardforge/rules-tempofront";
import { ZodError } from "zod";
import {
  clientIntentSchema,
  commandFromIntent,
  intentFromCommand,
  type ClientIntent,
} from "./intents.js";

export type SessionErrorCode =
  "MATCH_FULL" | "NOT_SEATED" | "INVALID_INTENT" | "ILLEGAL_COMMAND";

export class SessionError extends Error {
  constructor(
    readonly code: SessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionError";
  }
}

export interface MatchSnapshot {
  readonly seat: PlayerId;
  readonly commandNumber: number;
  readonly hash: string;
  readonly view: ProjectedGameView;
  readonly events: readonly GameEvent[];
  readonly legalIntents: readonly ClientIntent[];
}

export interface MatchSessionOptions {
  readonly matchId: string;
  readonly seed: number;
  readonly leaders?: Readonly<Record<PlayerId, PrototypeLeaderId>>;
  readonly decks?: Readonly<Record<PlayerId, readonly string[]>>;
}

function projectEvents(
  events: readonly GameEvent[],
  viewerId: PlayerId,
): readonly GameEvent[] {
  return events.map((event) =>
    event.type === "choice_resolved" && event.playerId !== viewerId
      ? { ...event, optionIds: [] }
      : event,
  );
}

export class AuthoritativeMatchSession {
  readonly engine = new TempoFrontEngine();
  readonly matchId: string;
  readonly seed: number;
  readonly leaders: Readonly<Record<PlayerId, PrototypeLeaderId>>;
  readonly decks: Readonly<Record<PlayerId, readonly string[]>>;
  readonly acceptedCommands: Command[] = [];
  #state: GameState;
  readonly #seats = new Map<string, PlayerId>();

  constructor(options: MatchSessionOptions) {
    this.matchId = options.matchId;
    this.seed = options.seed >>> 0;
    this.leaders = options.leaders ?? defaultPrototypeLeaders;
    this.decks = options.decks ?? {
      p1: prototypeDecks[this.leaders.p1],
      p2: prototypeDecks[this.leaders.p2],
    };
    this.#state = this.engine.createGame({
      matchId: this.matchId,
      seed: this.seed,
      decks: this.decks,
      leaders: this.leaders,
    });
  }

  static restore(replay: ReplayRecord): AuthoritativeMatchSession {
    const leaders = replay.leaders;
    if (!leaders)
      throw new Error("Stored match is missing its pinned Leader revisions");
    const known = new Set(Object.keys(prototypeDecks));
    if (!known.has(leaders.p1) || !known.has(leaders.p2))
      throw new Error("Stored match references an unavailable Leader");
    const session = new AuthoritativeMatchSession({
      matchId: replay.matchId,
      seed: replay.seed,
      leaders: leaders as Readonly<Record<PlayerId, PrototypeLeaderId>>,
      decks: replay.decks,
    });
    if (
      replay.rulesetRevision !== session.#state.rulesetRevision ||
      replay.formatId !== session.#state.formatId ||
      replay.formatRevision !== session.#state.formatRevision ||
      replay.contentHash !== session.#state.contentHash
    )
      throw new Error("Stored match revisions are unavailable");
    for (const command of replay.acceptedCommands) {
      const result = session.engine.applyCommand(session.#state, command);
      session.#state = result.state;
      session.acceptedCommands.push(command);
    }
    if (stateHash(session.#state) !== replay.finalStateHash)
      throw new Error("Stored match replay hash does not match");
    return session;
  }

  get state(): GameState {
    return structuredClone(this.#state);
  }

  join(connectionId: string): PlayerId {
    const existing = this.#seats.get(connectionId);
    if (existing) return existing;
    const occupied = new Set(this.#seats.values());
    const seat = (["p1", "p2"] as const).find(
      (candidate) => !occupied.has(candidate),
    );
    if (!seat)
      throw new SessionError(
        "MATCH_FULL",
        "This match already has two players.",
      );
    this.#seats.set(connectionId, seat);
    return seat;
  }

  seatFor(connectionId: string): PlayerId {
    const seat = this.#seats.get(connectionId);
    if (!seat)
      throw new SessionError(
        "NOT_SEATED",
        "The connection does not own a match seat.",
      );
    return seat;
  }

  snapshot(
    connectionId: string,
    events: readonly GameEvent[] = [],
  ): MatchSnapshot {
    const seat = this.seatFor(connectionId);
    return {
      seat,
      commandNumber: this.#state.commandNumber,
      hash: stateHash(this.#state),
      view: this.engine.projectView(this.#state, seat),
      events: projectEvents(events, seat),
      legalIntents: this.engine
        .getLegalCommands(this.#state, seat)
        .map(intentFromCommand),
    };
  }

  activePlayers(): readonly PlayerId[] {
    return (["p1", "p2"] as const).filter(
      (playerId) => this.engine.getLegalCommands(this.#state, playerId).length,
    );
  }

  submit(connectionId: string, payload: unknown): readonly GameEvent[] {
    const seat = this.seatFor(connectionId);
    return this.submitForPlayer(seat, payload);
  }

  submitForPlayer(playerId: PlayerId, payload: unknown): readonly GameEvent[] {
    let intent;
    try {
      intent = clientIntentSchema.parse(payload);
    } catch (error) {
      if (error instanceof ZodError)
        throw new SessionError(
          "INVALID_INTENT",
          "Command payload failed validation.",
        );
      throw error;
    }
    const command = commandFromIntent(playerId, intent);
    try {
      const result = this.engine.applyCommand(this.#state, command);
      this.#state = result.state;
      this.acceptedCommands.push(command);
      return result.events;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Illegal command"))
        throw new SessionError(
          "ILLEGAL_COMMAND",
          "Command is not legal in the current state.",
        );
      throw error;
    }
  }

  submitTimeout(playerId: PlayerId): readonly GameEvent[] {
    const legal = this.engine.getLegalCommands(this.#state, playerId);
    const fallback =
      legal.find((command) => command.type === "mulligan") ??
      legal.find((command) => command.type === "pass_response") ??
      legal.find((command) => command.type === "pass") ??
      legal[0];
    if (!fallback) return [];
    const result = this.engine.applyCommand(this.#state, fallback);
    this.#state = result.state;
    this.acceptedCommands.push(fallback);
    return result.events;
  }

  replay(): ReplayRecord {
    return {
      replayVersion: 1,
      matchId: this.matchId,
      seed: this.seed,
      rulesetRevision: this.#state.rulesetRevision,
      formatId: this.#state.formatId,
      formatRevision: this.#state.formatRevision,
      contentHash: this.#state.contentHash,
      decks: this.decks,
      leaders: this.leaders,
      acceptedCommands: [...this.acceptedCommands],
      finalStateHash: stateHash(this.#state),
    };
  }

  verifyReplay(): boolean {
    const replay = this.replay();
    return stateHash(replayGame(this.engine, replay)) === replay.finalStateHash;
  }
}
