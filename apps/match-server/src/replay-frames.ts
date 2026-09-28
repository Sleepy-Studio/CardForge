import type { PlayerId } from "@cardforge/card-schema";
import {
  stateHash,
  type Command,
  type GameEvent,
  type GameState,
  type ProjectedGameView,
  type ReplayRecord,
} from "@cardforge/rules-kernel";
import { TempoFrontEngine } from "@cardforge/rules-tempofront";

/*
 * Server-side replay reconstruction. Clients never receive the seed or deck
 * order (which would reveal every hidden card); they receive projected frames
 * produced by re-running the production engine over the accepted commands.
 */

export type ReplayPerspective = PlayerId | "public";

/** Command as shown to a viewer: opponent-private selections are redacted. */
export type ReplayCommandView =
  | (Omit<Command, "playerId"> & { readonly playerId: PlayerId })
  | {
      readonly type: "mulligan" | "resolve_choice";
      readonly playerId: PlayerId;
      readonly redacted: true;
      readonly count: number;
    };

export interface ReplayFrame {
  /** 0 is the opening state; frame N is the state after command N. */
  readonly index: number;
  readonly cycle: number;
  readonly phase: GameState["phase"];
  readonly hash: string;
  readonly command: ReplayCommandView | null;
  readonly events: readonly GameEvent[];
  readonly view: ProjectedGameView;
}

export interface ReplayReconstruction {
  readonly matchId: string;
  readonly commandCount: number;
  readonly verified: boolean;
  readonly expectedHash: string;
  readonly actualHash: string | null;
  readonly error: string | null;
  readonly frames: readonly ReplayFrame[];
}

function projectFor(
  engine: TempoFrontEngine,
  state: GameState,
  perspective: ReplayPerspective,
): ProjectedGameView {
  if (perspective !== "public") return engine.projectView(state, perspective);
  // The public view is p1's projection with p1's private zones removed too.
  const view = engine.projectView(state, "p1");
  const { hand: _hand, reserve: _reserve, ...p1 } = view.players.p1;
  void _hand;
  void _reserve;
  const choice = view.pendingChoice;
  return {
    ...view,
    players: { ...view.players, p1 },
    pendingChoice: choice
      ? {
          choiceId: choice.choiceId,
          chooserId: choice.chooserId,
          kind: choice.kind,
          optionCount: choice.optionCount,
          ...(choice.focusAmount === undefined
            ? {}
            : { focusAmount: choice.focusAmount }),
        }
      : null,
  };
}

function commandFor(
  command: Command,
  perspective: ReplayPerspective,
): ReplayCommandView {
  const hidden = perspective === "public" || command.playerId !== perspective;
  if (hidden && command.type === "mulligan")
    return {
      type: "mulligan",
      playerId: command.playerId,
      redacted: true,
      count: command.instanceIds.length,
    };
  if (hidden && command.type === "resolve_choice")
    return {
      type: "resolve_choice",
      playerId: command.playerId,
      redacted: true,
      count: command.optionIds.length,
    };
  return structuredClone(command);
}

function eventsFor(
  events: readonly GameEvent[],
  perspective: ReplayPerspective,
): readonly GameEvent[] {
  return events.map((event) =>
    event.type === "choice_resolved" && event.playerId !== perspective
      ? { ...event, optionIds: [] }
      : event,
  );
}

/**
 * Rebuilds a stored match through the production engine and verifies the
 * final canonical hash. Frames are returned for the requested perspective.
 */
export function reconstructReplay(
  replay: ReplayRecord,
  perspective: ReplayPerspective,
  engine = new TempoFrontEngine(),
): ReplayReconstruction {
  const frames: ReplayFrame[] = [];
  const base = {
    matchId: replay.matchId,
    commandCount: replay.acceptedCommands.length,
    expectedHash: replay.finalStateHash,
  };
  try {
    let state = engine.createGame({
      matchId: replay.matchId,
      seed: replay.seed,
      decks: replay.decks,
      ...(replay.leaders === undefined ? {} : { leaders: replay.leaders }),
      ...(replay.setup === undefined ? {} : { setup: replay.setup }),
    });
    if (
      replay.rulesetRevision !== state.rulesetRevision ||
      replay.contentHash !== state.contentHash ||
      replay.formatId !== state.formatId ||
      replay.formatRevision !== state.formatRevision
    )
      return {
        ...base,
        verified: false,
        actualHash: null,
        error: "Replay revisions are not available in this engine build",
        frames: [],
      };
    const push = (
      index: number,
      command: Command | null,
      events: readonly GameEvent[],
    ) =>
      frames.push({
        index,
        cycle: state.cycle,
        phase: state.phase,
        hash: stateHash(state),
        command: command ? commandFor(command, perspective) : null,
        events: eventsFor(events, perspective),
        view: projectFor(engine, state, perspective),
      });
    push(0, null, []);
    replay.acceptedCommands.forEach((command, offset) => {
      const result = engine.applyCommand(state, command);
      state = result.state;
      push(offset + 1, command, result.events);
    });
    const actualHash = stateHash(state);
    return {
      ...base,
      verified: actualHash === replay.finalStateHash,
      actualHash,
      error:
        actualHash === replay.finalStateHash
          ? null
          : "Final canonical hash does not match the stored replay",
      frames,
    };
  } catch (error) {
    return {
      ...base,
      verified: false,
      actualHash: null,
      error: `Replay reconstruction failed: ${error instanceof Error ? error.message : String(error)}`,
      frames,
    };
  }
}

/** Small bounded cache: replays are immutable once a match completes. */
export class ReplayCache {
  readonly #entries = new Map<string, ReplayReconstruction>();
  constructor(readonly capacity = 24) {}

  get(
    replay: ReplayRecord,
    perspective: ReplayPerspective,
  ): { readonly value: ReplayReconstruction; readonly cached: boolean } {
    const key = `${replay.matchId}:${perspective}:${replay.finalStateHash}:${replay.acceptedCommands.length}`;
    const hit = this.#entries.get(key);
    if (hit) {
      this.#entries.delete(key);
      this.#entries.set(key, hit);
      return { value: hit, cached: true };
    }
    const value = reconstructReplay(replay, perspective);
    this.#entries.set(key, value);
    while (this.#entries.size > this.capacity)
      this.#entries.delete(this.#entries.keys().next().value!);
    return { value, cached: false };
  }
}
