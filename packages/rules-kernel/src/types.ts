import type {
  CardDefinition,
  FrontId,
  PlayerId,
  SlotId,
} from "@cardforge/card-schema";

export interface CardInstance {
  readonly instanceId: string;
  readonly cardId: string;
  readonly revision: number;
  readonly ownerId: PlayerId;
  controllerId: PlayerId;
  damage: number;
  ready: boolean;
  barrier: boolean;
  shiftsThisCycle: number;
}

export interface FrontState {
  readonly slots: Record<PlayerId, Record<SlotId, CardInstance | null>>;
}

export interface PlayerState {
  readonly playerId: PlayerId;
  integrity: number;
  maxFocus: number;
  focus: number;
  time: number;
  dominion: number;
  fatigue: number;
  passed: boolean;
  readonly deck: CardInstance[];
  readonly hand: CardInstance[];
  readonly discard: CardInstance[];
}

export interface GameState {
  readonly matchId: string;
  readonly rulesetRevision: string;
  readonly contentHash: string;
  readonly rng: { readonly seed: number; index: number };
  cycle: number;
  initiative: PlayerId;
  nextInstance: number;
  commandNumber: number;
  winner: PlayerId | null;
  victoryReason: "integrity" | "dominion" | null;
  readonly players: Record<PlayerId, PlayerState>;
  readonly fronts: Record<FrontId, FrontState>;
}

export type Command =
  | {
      readonly type: "play_card";
      readonly playerId: PlayerId;
      readonly instanceId: string;
      readonly front?: FrontId;
      readonly slot?: SlotId;
      readonly targetId?: string;
    }
  | {
      readonly type: "strike";
      readonly playerId: PlayerId;
      readonly attackerId: string;
      readonly targetId: string;
    }
  | {
      readonly type: "shift";
      readonly playerId: PlayerId;
      readonly entityId: string;
      readonly toFront: FrontId;
      readonly toSlot: SlotId;
    }
  | { readonly type: "pass"; readonly playerId: PlayerId };

export type GameEvent =
  | {
      readonly type: "card_played";
      readonly playerId: PlayerId;
      readonly instanceId: string;
    }
  | {
      readonly type: "entity_deployed";
      readonly playerId: PlayerId;
      readonly instanceId: string;
      readonly front: FrontId;
      readonly slot: SlotId;
    }
  | {
      readonly type: "damage_dealt";
      readonly sourceId: string;
      readonly targetId: string;
      readonly amount: number;
    }
  | { readonly type: "entity_defeated"; readonly instanceId: string }
  | {
      readonly type: "entity_shifted";
      readonly instanceId: string;
      readonly from: FrontId;
      readonly to: FrontId;
    }
  | { readonly type: "player_passed"; readonly playerId: PlayerId }
  | {
      readonly type: "dominion_gained";
      readonly playerId: PlayerId;
      readonly total: number;
    }
  | { readonly type: "cycle_started"; readonly cycle: number }
  | {
      readonly type: "game_won";
      readonly playerId: PlayerId;
      readonly reason: "integrity" | "dominion";
    };

export interface CommandResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly hash: string;
}

export interface ReplayRecord {
  readonly replayVersion: 1;
  readonly matchId: string;
  readonly seed: number;
  readonly rulesetRevision: string;
  readonly contentHash: string;
  readonly decks: Readonly<Record<PlayerId, readonly string[]>>;
  readonly acceptedCommands: readonly Command[];
  readonly finalStateHash: string;
}

export interface ProjectedPlayerView {
  readonly playerId: PlayerId;
  readonly integrity: number;
  readonly maxFocus: number;
  readonly focus: number;
  readonly time: number;
  readonly dominion: number;
  readonly deckCount: number;
  readonly handCount: number;
  readonly hand?: readonly CardInstance[];
  readonly discard: readonly CardInstance[];
}

export interface ProjectedGameView {
  readonly matchId: string;
  readonly cycle: number;
  readonly initiative: PlayerId;
  readonly viewer: PlayerId;
  readonly players: Record<PlayerId, ProjectedPlayerView>;
  readonly fronts: GameState["fronts"];
  readonly winner: PlayerId | null;
}

export interface RulesEngine {
  readonly cards: ReadonlyMap<string, CardDefinition>;
  createGame(input: {
    matchId: string;
    seed: number;
    decks: Readonly<Record<PlayerId, readonly string[]>>;
  }): GameState;
  getLegalCommands(state: GameState, playerId: PlayerId): readonly Command[];
  applyCommand(state: GameState, command: Command): CommandResult;
  projectView(state: GameState, playerId: PlayerId): ProjectedGameView;
}
