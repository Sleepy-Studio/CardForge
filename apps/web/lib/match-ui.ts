import type {
  CardDefinition,
  FrontId,
  PlayerId,
  SlotId,
} from "@cardforge/card-schema";
import type {
  CardInstance,
  Command,
  GameEvent,
  GameState,
} from "@cardforge/rules-kernel";
import {
  defaultPrototypeLeaders,
  prototypeDecks,
  prototypeLeaderOptions,
  prototypeCards,
  type PrototypeLeaderId,
  TempoFrontEngine,
} from "@cardforge/rules-tempofront";

export const browserEngine = new TempoFrontEngine();
export const browserStarterDecks = prototypeDecks;
export const browserLeaderOptions = prototypeLeaderOptions;
export const browserCardPoolSize = prototypeCards.length;

export type BrowserLineup = Readonly<Record<PlayerId, PrototypeLeaderId>>;

export interface DisplayTerms {
  readonly entity: string;
  readonly leader: string;
  readonly front: string;
  readonly dominion: string;
}

const defaultDisplayTerms: DisplayTerms = {
  entity: "Entity",
  leader: "Leader",
  front: "Front",
  dominion: "Dominion",
};

export const defaultBrowserLineup: BrowserLineup = defaultPrototypeLeaders;

export function createBrowserMatch(
  seed = 20260816,
  leaders: BrowserLineup = defaultBrowserLineup,
): GameState {
  return browserEngine.createGame({
    matchId: `browser-${seed}`,
    seed,
    decks: {
      p1: prototypeDecks[leaders.p1],
      p2: prototypeDecks[leaders.p2],
    },
    leaders,
  });
}

export function activePlayer(state: GameState): PlayerId | null {
  if (state.winner) return null;
  if (state.phase === "mulligan")
    return state.players.p1.mulliganSubmitted ? "p2" : "p1";
  if (state.pendingChoice) return state.pendingChoice.chooserId;
  if (state.pendingAction)
    return state.pendingAction.phase === "response"
      ? state.pendingAction.actorId === "p1"
        ? "p2"
        : "p1"
      : state.pendingAction.actorId;
  if (browserEngine.getLegalCommands(state, "p1").length > 0) return "p1";
  if (browserEngine.getLegalCommands(state, "p2").length > 0) return "p2";
  return null;
}

export function commandTime(state: GameState, command: Command): number {
  if (command.type === "play_card") {
    const instance = findInstance(state, command.instanceId);
    return instance
      ? (browserEngine.cards.get(instance.cardId)?.playTime ?? 0)
      : 0;
  }
  if (command.type === "prepare_card") return 1;
  if (command.type === "strike") {
    const instance = findInstance(state, command.attackerId);
    return instance
      ? (browserEngine.cards.get(instance.cardId)?.strikeTime ?? 3)
      : 3;
  }
  if (command.type === "shift") {
    const instance = findInstance(state, command.entityId);
    return instance &&
      browserEngine.cards.get(instance.cardId)?.keywords?.mobile === true
      ? 1
      : 2;
  }
  if (command.type === "activate_ability") {
    const instance = findInstance(state, command.sourceId);
    const ability = instance
      ? browserEngine.cards
          .get(instance.cardId)
          ?.abilities?.find((item) => item.abilityId === command.abilityId)
      : undefined;
    return ability?.timeCost ?? 0;
  }
  if (command.type === "play_reaction") {
    const instance = findInstance(state, command.instanceId);
    const definition = instance
      ? browserEngine.cards.get(instance.cardId)
      : undefined;
    return (
      definition?.abilities?.find((ability) => ability.type === "reaction")
        ?.tempoDebt ??
      definition?.playTime ??
      0
    );
  }
  return 0;
}

export function commandLabel(
  state: GameState,
  command: Command,
  terms: Partial<DisplayTerms> = {},
): string {
  const display = { ...defaultDisplayTerms, ...terms };
  const nameFor = (instanceId: string): string => {
    const instance = findInstance(state, instanceId);
    return instance
      ? (browserEngine.cards.get(instance.cardId)?.name ?? instance.cardId)
      : instanceId;
  };
  switch (command.type) {
    case "mulligan":
      return `Confirm mulligan (${command.instanceIds.length})`;
    case "resolve_choice":
      return `Choose ${command.optionIds.join(" + ")}`;
    case "pass_response":
      return "Pass response";
    case "play_reaction":
      return `Respond with ${nameFor(command.instanceId)}`;
    case "play_card": {
      const destination = command.front
        ? ` → ${command.front}${command.slot ? ` ${command.slot}` : ""}`
        : command.targetId
          ? ` → ${nameFor(command.targetId)}`
          : command.targetIds
            ? ` → ${command.targetIds.length} targets`
            : "";
      return `Play ${nameFor(command.instanceId)}${destination}`;
    }
    case "prepare_card":
      return `Prepare ${nameFor(command.instanceId)}`;
    case "activate_ability":
      return `${command.sourceId.endsWith("-leader") ? "Command" : "Activate"} — ${nameFor(command.sourceId)}`;
    case "strike":
      return `Strike ${command.targetId === "leader" ? display.leader : nameFor(command.targetId)}`;
    case "shift":
      return `Shift → ${command.toFront} ${command.toSlot}`;
    case "pass":
      return "Lock in and pass";
  }
}

export function eventLabel(
  event: GameEvent,
  terms: Partial<DisplayTerms> = {},
): string {
  const display = { ...defaultDisplayTerms, ...terms };
  switch (event.type) {
    case "mulligan_submitted":
      return `${event.playerId} replaced ${event.count} card${event.count === 1 ? "" : "s"}`;
    case "mulligan_complete":
      return "Mulligans complete";
    case "choice_created":
      return `${event.playerId} must resolve ${event.choiceKind}`;
    case "choice_resolved":
      return `${event.playerId} chose ${event.optionIds.join(", ")}`;
    case "damage_replaced":
      return `${event.replacement} prevented ${event.prevented}`;
    case "action_declared":
      return `${event.playerId} declared ${event.actionType}`;
    case "reaction_played":
      return `${event.playerId} played a depth-${event.chainDepth} Reaction`;
    case "response_passed":
      return `${event.playerId} passed response priority`;
    case "action_canceled":
      return `${event.playerId}'s ${event.actionType} was canceled`;
    case "action_resolved":
      return `${event.playerId}'s ${event.actionType} resolved`;
    case "card_played":
      return `${event.playerId} committed a card`;
    case "card_prepared":
      return `${event.playerId} prepared a card`;
    case "ability_activated":
      return `${event.playerId} activated ${event.abilityId}`;
    case "status_added":
      return `${event.statusId} ${event.value} applied`;
    case "entity_deployed":
      return `${event.playerId} deployed to ${event.front}`;
    case "damage_dealt":
      return `${event.amount} damage dealt`;
    case "entity_defeated":
      return `An ${display.entity} was defeated`;
    case "entity_shifted":
      return `${display.entity} shifted ${event.from} → ${event.to}`;
    case "front_control_resolved":
      return `${event.front} ${display.front}: ${event.controllerId ?? "contested"} (${event.p1Presence}–${event.p2Presence})`;
    case "player_passed":
      return `${event.playerId} passed for the Cycle`;
    case "dominion_gained":
      return `${event.playerId} gained ${display.dominion} (${event.total}/6)`;
    case "cycle_started":
      return `Cycle ${event.cycle} started`;
    case "game_won":
      return `${event.playerId} won by ${event.reason}`;
  }
}

export type PresentationTone =
  "motion" | "impact" | "guard" | "objective" | "victory";

export interface BoardAnchor {
  readonly playerId?: PlayerId;
  readonly front?: FrontId;
  readonly slot?: SlotId;
  readonly leader?: boolean;
}

export interface PresentationCue {
  readonly id: string;
  readonly kind:
    | "deploy"
    | "shift"
    | "strike"
    | "damage"
    | "guard"
    | "defeat"
    | "control"
    | "dominion"
    | "victory";
  readonly label: string;
  readonly detail: string;
  readonly tone: PresentationTone;
  readonly source?: BoardAnchor;
  readonly target?: BoardAnchor;
}

export interface PresentationBatch {
  readonly sequence: number;
  readonly cues: readonly PresentationCue[];
}

function boardAnchor(
  state: GameState,
  instanceId: string,
): BoardAnchor | undefined {
  for (const front of ["left", "center", "right"] as const)
    for (const playerId of ["p1", "p2"] as const)
      for (const slot of ["vanguard", "support"] as const)
        if (
          state.fronts[front].slots[playerId][slot]?.instanceId === instanceId
        )
          return { front, playerId, slot };
  return undefined;
}

function instanceName(
  before: GameState,
  after: GameState,
  instanceId: string,
): string {
  const instance =
    findInstance(after, instanceId) ?? findInstance(before, instanceId);
  return instance
    ? (browserEngine.cards.get(instance.cardId)?.name ?? instance.cardId)
    : "Entity";
}

function leaderTarget(
  before: GameState,
  after: GameState,
  sourceId: string,
): BoardAnchor {
  const source = boardAnchor(after, sourceId) ?? boardAnchor(before, sourceId);
  const sourcePlayer =
    source?.playerId ?? findInstance(after, sourceId)?.controllerId;
  return {
    playerId: sourcePlayer === "p2" ? "p1" : "p2",
    leader: true,
  };
}

export function presentationCues(
  events: readonly GameEvent[],
  before: GameState,
  after: GameState,
  terms: Partial<DisplayTerms> = {},
): readonly PresentationCue[] {
  const display = { ...defaultDisplayTerms, ...terms };
  return events.flatMap((event, index): readonly PresentationCue[] => {
    const id = `${after.commandNumber}-${index}-${event.type}`;
    switch (event.type) {
      case "entity_deployed":
        return [
          {
            id,
            kind: "deploy",
            label: "DEPLOY",
            detail: `${instanceName(before, after, event.instanceId)} → ${event.front.toUpperCase()} ${event.slot.toUpperCase()}`,
            tone: "motion",
            target: {
              playerId: event.playerId,
              front: event.front,
              slot: event.slot,
            },
          },
        ];
      case "entity_shifted":
        return [
          {
            id,
            kind: "shift",
            label: "SHIFT",
            detail: `${instanceName(before, after, event.instanceId)} // ${event.from.toUpperCase()} → ${event.to.toUpperCase()}`,
            tone: "motion",
            source: boardAnchor(before, event.instanceId),
            target: boardAnchor(after, event.instanceId),
          },
        ];
      case "action_declared":
        if (
          event.actionType !== "strike" ||
          after.pendingAction?.main.type !== "strike"
        )
          return [];
        return [
          {
            id,
            kind: "strike",
            label: "STRIKE",
            detail: `${event.playerId.toUpperCase()} COMMITTED`,
            tone: "impact",
            source:
              boardAnchor(after, after.pendingAction.main.attackerId) ??
              boardAnchor(before, after.pendingAction.main.attackerId),
            target:
              after.pendingAction.main.targetId === "leader"
                ? {
                    playerId: event.playerId === "p1" ? "p2" : "p1",
                    leader: true,
                  }
                : (boardAnchor(after, after.pendingAction.main.targetId) ??
                  boardAnchor(before, after.pendingAction.main.targetId)),
          },
        ];
      case "damage_replaced":
        return [
          {
            id,
            kind: "guard",
            label: event.replacement.toUpperCase(),
            detail: `${event.prevented} DAMAGE PREVENTED`,
            tone: "guard",
            source:
              boardAnchor(after, event.sourceId) ??
              boardAnchor(before, event.sourceId),
            target:
              boardAnchor(after, event.targetId) ??
              boardAnchor(before, event.targetId),
          },
        ];
      case "damage_dealt": {
        const source =
          boardAnchor(after, event.sourceId) ??
          boardAnchor(before, event.sourceId);
        const target =
          event.targetId === "leader"
            ? leaderTarget(before, after, event.sourceId)
            : (boardAnchor(after, event.targetId) ??
              boardAnchor(before, event.targetId));
        return [
          {
            id,
            kind: "damage",
            label: "IMPACT",
            detail: `${event.amount} DAMAGE`,
            tone: "impact",
            source,
            target,
          },
        ];
      }
      case "entity_defeated":
        return [
          {
            id,
            kind: "defeat",
            label: "DEFEATED",
            detail: instanceName(before, after, event.instanceId),
            tone: "impact",
            target: boardAnchor(before, event.instanceId),
          },
        ];
      case "front_control_resolved":
        return [
          {
            id,
            kind: "control",
            label: `${event.front.toUpperCase()} ${display.front.toUpperCase()}`,
            detail: event.controllerId
              ? `${event.controllerId.toUpperCase()} CONTROL // ${event.p1Presence}–${event.p2Presence}`
              : `CONTESTED // ${event.p1Presence}–${event.p2Presence}`,
            tone: "objective",
            target: { front: event.front },
          },
        ];
      case "dominion_gained":
        return [
          {
            id,
            kind: "dominion",
            label: display.dominion.toUpperCase(),
            detail: `${event.playerId.toUpperCase()} // ${event.total}/6`,
            tone: "objective",
            target: { playerId: event.playerId, leader: true },
          },
        ];
      case "game_won":
        return [
          {
            id,
            kind: "victory",
            label: "MATCH DECIDED",
            detail: `${event.playerId.toUpperCase()} // ${event.reason.toUpperCase()}`,
            tone: "victory",
            target: { playerId: event.playerId, leader: true },
          },
        ];
      default:
        return [];
    }
  });
}

export function chooseBotCommand(
  state: GameState,
  commands: readonly Command[],
): Command {
  if (commands.length === 0) throw new Error("Bot has no legal command");
  const ofType = <T extends Command["type"]>(type: T) =>
    commands.filter(
      (command): command is Extract<Command, { type: T }> =>
        command.type === type,
    );
  const mulligan = ofType("mulligan").find(
    (command) => command.instanceIds.length === 0,
  );
  if (mulligan) return mulligan;
  const choice = ofType("resolve_choice")[0];
  if (choice) return choice;
  const responsePass = ofType("pass_response")[0];
  if (responsePass) {
    const reaction = ofType("play_reaction")[0];
    return reaction && state.commandNumber % 3 === 0 ? reaction : responsePass;
  }
  return (
    ofType("strike").find((command) => command.targetId === "leader") ??
    ofType("play_card").find((command) => {
      const instance = findInstance(state, command.instanceId);
      return (
        instance && browserEngine.cards.get(instance.cardId)?.type === "entity"
      );
    }) ??
    ofType("strike")[0] ??
    ofType("play_card")[0] ??
    ofType("activate_ability")[0] ??
    ofType("shift")[0] ??
    ofType("prepare_card")[0] ??
    ofType("pass")[0] ??
    commands[0]
  );
}

export function findInstance(
  state: GameState,
  instanceId: string,
): CardInstance | null {
  const visit = (instance: CardInstance): CardInstance | null => {
    if (instance.instanceId === instanceId) return instance;
    for (const attachment of instance.attachments) {
      const found = visit(attachment);
      if (found) return found;
    }
    return null;
  };
  for (const player of Object.values(state.players)) {
    for (const instance of [
      player.leader,
      ...player.hand,
      ...player.deck,
      ...player.discard,
      ...player.relics,
      ...(player.reserve ? [player.reserve] : []),
    ]) {
      const found = visit(instance);
      if (found) return found;
    }
  }
  for (const front of Object.values(state.fronts)) {
    if (front.site) {
      const found = visit(front.site);
      if (found) return found;
    }
    for (const slots of Object.values(front.slots))
      for (const instance of Object.values(slots)) {
        if (!instance) continue;
        const found = visit(instance);
        if (found) return found;
      }
  }
  return null;
}

export function definitionForInstance(
  state: GameState,
  instanceId: string | null,
): CardDefinition | null {
  if (!instanceId) return null;
  const instance = findInstance(state, instanceId);
  return instance ? (browserEngine.cards.get(instance.cardId) ?? null) : null;
}
