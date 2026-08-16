import type {
  CardDefinition,
  EffectNode,
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
  nextChoice: number;
  winner: PlayerId | null;
  victoryReason: "integrity" | "dominion" | null;
  pendingAction: PendingAction | null;
  pendingChoice: PendingChoice | null;
  readonly effectQueue: QueuedEffect[];
  readonly players: Record<PlayerId, PlayerState>;
  readonly fronts: Record<FrontId, FrontState>;
}

export type MainActionCommand =
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

export type ResponseCommand =
  | {
      readonly type: "play_reaction";
      readonly playerId: PlayerId;
      readonly instanceId: string;
      readonly targetId?: string;
    }
  | { readonly type: "pass_response"; readonly playerId: PlayerId };

export interface ResolveChoiceCommand {
  readonly type: "resolve_choice";
  readonly playerId: PlayerId;
  readonly choiceId: string;
  readonly optionIds: readonly string[];
}

export type Command =
  MainActionCommand | ResponseCommand | ResolveChoiceCommand;

export type ResolvableMainAction = Exclude<MainActionCommand, { type: "pass" }>;

export interface PendingReaction {
  readonly playerId: PlayerId;
  readonly card: CardInstance;
  readonly targetId?: string;
}

export interface PendingAction {
  readonly actorId: PlayerId;
  readonly main: ResolvableMainAction;
  readonly committedCard?: CardInstance;
  phase: "response" | "counter_response";
  response: PendingReaction | null;
  counterResponse: PendingReaction | null;
}

export interface QueuedEffect {
  readonly source: CardInstance;
  readonly controllerId: PlayerId;
  readonly effect: EffectNode;
  readonly chosenTargetId?: string;
  readonly sourceFront?: FrontId;
}

export type PendingChoice =
  | {
      readonly choiceId: string;
      readonly chooserId: PlayerId;
      readonly kind: "select_card";
      readonly options: readonly CardInstance[];
      readonly minimum: 1;
      readonly maximum: 1;
    }
  | {
      readonly choiceId: string;
      readonly chooserId: PlayerId;
      readonly kind: "optional_focus";
      readonly amount: number;
      readonly continuation: readonly QueuedEffect[];
    };

export type GameEvent =
  | {
      readonly type: "choice_created";
      readonly playerId: PlayerId;
      readonly choiceId: string;
      readonly choiceKind: PendingChoice["kind"];
      readonly optionCount: number;
    }
  | {
      readonly type: "choice_resolved";
      readonly playerId: PlayerId;
      readonly choiceId: string;
      readonly optionIds: readonly string[];
    }
  | {
      readonly type: "damage_replaced";
      readonly sourceId: string;
      readonly targetId: string;
      readonly replacement: "barrier" | "armor";
      readonly prevented: number;
    }
  | {
      readonly type: "action_declared";
      readonly playerId: PlayerId;
      readonly actionType: ResolvableMainAction["type"];
    }
  | {
      readonly type: "reaction_played";
      readonly playerId: PlayerId;
      readonly instanceId: string;
      readonly chainDepth: 1 | 2;
    }
  | {
      readonly type: "response_passed";
      readonly playerId: PlayerId;
      readonly chainDepth: 1 | 2;
    }
  | {
      readonly type: "action_canceled";
      readonly playerId: PlayerId;
      readonly actionType: ResolvableMainAction["type"] | "reaction";
    }
  | {
      readonly type: "action_resolved";
      readonly playerId: PlayerId;
      readonly actionType: ResolvableMainAction["type"];
    }
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
  readonly pendingAction: PendingAction | null;
  readonly pendingChoice: ProjectedPendingChoice | null;
  readonly winner: PlayerId | null;
}

export interface ProjectedPendingChoice {
  readonly choiceId: string;
  readonly chooserId: PlayerId;
  readonly kind: PendingChoice["kind"];
  readonly optionCount: number;
  readonly cardOptions?: readonly CardInstance[];
  readonly optionIds?: readonly string[];
  readonly focusAmount?: number;
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
