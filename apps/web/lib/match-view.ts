import type { FrontId, PlayerId } from "@cardforge/card-schema";
import type {
  Command,
  GameEvent,
  ProjectedGameView,
} from "@cardforge/rules-kernel";
import { glossaryById, statusEntry } from "@cardforge/rules-tempofront";
import { cardMap } from "./cards";
import { commandTime, findInstance, type BoardLike } from "./match-ui";
import type { BoardIntent } from "@/components/board-canvas";

/*
 * View-model for server-authoritative play. Everything is derived from the
 * projected view and the server's list of legal intents; the client never
 * computes legality itself, it only helps the player pick from that list.
 */

type Distribute<T> = T extends unknown ? Omit<T, "playerId"> : never;
export type Intent = Distribute<Command>;

export function opponentOf(seat: PlayerId): PlayerId {
  return seat === "p1" ? "p2" : "p1";
}

export function asCommand(intent: Intent, seat: PlayerId): Command {
  return { ...intent, playerId: seat };
}

/** The card or Entity an intent acts with, if any. */
export function intentSource(intent: Intent): string | null {
  switch (intent.type) {
    case "play_card":
    case "prepare_card":
    case "play_reaction":
      return intent.instanceId;
    case "strike":
      return intent.attackerId;
    case "shift":
      return intent.entityId;
    case "activate_ability":
      return intent.sourceId;
    default:
      return null;
  }
}

export function intentsFor(
  intents: readonly Intent[],
  selectedId: string | null,
): readonly Intent[] {
  if (!selectedId) return [];
  return intents.filter((intent) => intentSource(intent) === selectedId);
}

export interface Highlights {
  readonly slots: ReadonlySet<string>;
  readonly targets: ReadonlySet<string>;
  readonly fronts: ReadonlySet<FrontId>;
  readonly leaderTargeted: boolean;
}

export function highlightsFor(intents: readonly Intent[]): Highlights {
  const slots = new Set<string>();
  const targets = new Set<string>();
  const fronts = new Set<FrontId>();
  let leaderTargeted = false;
  for (const intent of intents) {
    if (intent.type === "play_card" && intent.front && intent.slot)
      slots.add(`${intent.front}:${intent.slot}`);
    if (intent.type === "play_card" && intent.front && !intent.slot)
      fronts.add(intent.front);
    if (intent.type === "shift")
      slots.add(`${intent.toFront}:${intent.toSlot}`);
    if (intent.type === "strike") {
      if (intent.targetId === "leader") leaderTargeted = true;
      else targets.add(intent.targetId);
    }
    if (
      intent.type === "play_card" ||
      intent.type === "play_reaction" ||
      intent.type === "activate_ability"
    ) {
      if (intent.targetId) targets.add(intent.targetId);
      for (const target of intent.targetIds ?? []) targets.add(target);
    }
  }
  return { slots, targets, fronts, leaderTargeted };
}

/** Maps a board click (or drop) to the one matching legal intent. */
export function intentForBoard(
  intents: readonly Intent[],
  board: BoardIntent,
): Intent | null {
  if (board.entityId) {
    const targeted = intents.find(
      (intent) =>
        ((intent.type === "strike" ||
          intent.type === "play_card" ||
          intent.type === "play_reaction" ||
          intent.type === "activate_ability") &&
          intent.targetId === board.entityId) ||
        (intent.type !== "strike" &&
          "targetIds" in intent &&
          intent.targetIds?.length === 1 &&
          intent.targetIds[0] === board.entityId),
    );
    if (targeted) return targeted;
  }
  return (
    intents.find((intent) => {
      if (intent.type === "shift")
        return intent.toFront === board.front && intent.toSlot === board.slot;
      if (intent.type !== "play_card" || !intent.front) return false;
      return (
        intent.front === board.front &&
        (intent.slot === board.slot || (!intent.slot && !board.entityId))
      );
    }) ?? null
  );
}

/** Intents that need no board destination (e.g. an untargeted Tactic). */
export function directIntents(intents: readonly Intent[]): readonly Intent[] {
  return intents.filter(
    (intent) =>
      (intent.type === "play_card" &&
        !intent.front &&
        !intent.targetId &&
        !intent.targetIds) ||
      intent.type === "prepare_card" ||
      (intent.type === "activate_ability" &&
        !intent.targetId &&
        !intent.targetIds) ||
      (intent.type === "play_reaction" &&
        !intent.targetId &&
        !intent.targetIds) ||
      (intent.type === "strike" && intent.targetId === "leader") ||
      (intent.type === "play_card" &&
        Boolean(intent.targetIds && intent.targetIds.length > 1)),
  );
}

export function timeCost(
  view: ProjectedGameView,
  seat: PlayerId,
  intent: Intent,
): number {
  return commandTime(view, asCommand(intent, seat));
}

export function focusCost(view: ProjectedGameView, intent: Intent): number {
  const source = intentSource(intent);
  const instance = source ? findInstance(view, source) : null;
  const card = instance ? cardMap.get(instance.cardId) : undefined;
  if (!card) return 0;
  if (intent.type === "activate_ability")
    return (
      card.abilities?.find((ability) => ability.abilityId === intent.abilityId)
        ?.focusCost ?? 0
    );
  if (intent.type === "play_card" || intent.type === "play_reaction") {
    const fromReserve =
      view.players[view.viewer].reserve?.instanceId === source;
    return Math.max(
      0,
      card.focusCost - (fromReserve ? (card.prepareDiscount ?? 0) : 0),
    );
  }
  return 0;
}

/** Name plus board position, to tell apart two copies of the same card. */
export function targetName(
  view: BoardLike,
  instanceId: string | undefined | null,
): string {
  const name = nameOf(view, instanceId);
  if (!instanceId || instanceId === "leader") return name;
  for (const front of ["left", "center", "right"] as const)
    for (const playerId of ["p1", "p2"] as const)
      for (const slot of ["vanguard", "support"] as const)
        if (view.fronts[front].slots[playerId][slot]?.instanceId === instanceId)
          return `${name} (${front} ${slot})`;
  return name;
}

export function nameOf(
  view: BoardLike,
  instanceId: string | undefined | null,
): string {
  if (!instanceId) return "";
  if (instanceId === "leader") return "the enemy Leader";
  const instance = findInstance(view, instanceId);
  return instance ? (cardMap.get(instance.cardId)?.name ?? "a card") : "a card";
}

export function intentLabel(
  view: ProjectedGameView,
  intent: Intent,
  terms: Readonly<Record<string, string>>,
): string {
  const entity = terms.entity ?? "Entity";
  const board = view as unknown as BoardLike;
  switch (intent.type) {
    case "mulligan":
      return intent.instanceIds.length
        ? `Replace ${intent.instanceIds.length} card(s)`
        : "Keep this hand";
    case "resolve_choice":
      return "Confirm choice";
    case "pass_response":
      return "Let it resolve";
    case "play_reaction":
      return `Respond with ${nameOf(board, intent.instanceId)}${intent.targetId ? ` → ${targetName(board, intent.targetId)}` : ""}`;
    case "play_card":
      if (intent.front)
        return `Deploy ${nameOf(board, intent.instanceId)} → ${intent.front} ${intent.slot ?? ""}`.trim();
      if (intent.targetId)
        return `Play ${nameOf(board, intent.instanceId)} → ${targetName(board, intent.targetId)}`;
      if (intent.targetIds?.length)
        return `Play ${nameOf(board, intent.instanceId)} → ${intent.targetIds.map((id) => targetName(board, id)).join(", ")}`;
      return `Play ${nameOf(board, intent.instanceId)}`;
    case "prepare_card":
      return `Prepare ${nameOf(board, intent.instanceId)}`;
    case "activate_ability":
      return `${intent.sourceId.endsWith("-leader") ? "Use Command" : "Activate"}: ${nameOf(board, intent.sourceId)}${
        intent.targetId ? ` → ${targetName(board, intent.targetId)}` : ""
      }`;
    case "strike":
      return intent.targetId === "leader"
        ? `Strike the enemy ${terms.leader ?? "Leader"}`
        : `Strike ${targetName(board, intent.targetId)}`;
    case "shift":
      return `Shift ${entity} → ${intent.toFront} ${intent.toSlot}`;
    case "pass":
      return "Pass for this Cycle";
  }
}

export type Priority =
  | "mulligan"
  | "your_action"
  | "your_response"
  | "your_counter"
  | "your_choice"
  | "opponent"
  | "finished";

export function priorityOf(
  view: ProjectedGameView,
  seat: PlayerId,
  intents: readonly Intent[],
): Priority {
  if (view.winner) return "finished";
  if (!intents.length) return "opponent";
  if (intents.some((intent) => intent.type === "mulligan")) return "mulligan";
  if (intents.some((intent) => intent.type === "resolve_choice"))
    return "your_choice";
  if (intents.some((intent) => intent.type === "pass_response"))
    return view.pendingAction?.actorId === seat
      ? "your_counter"
      : "your_response";
  return "your_action";
}

/** What the pending action is, in words, for Response prompts. */
export function pendingActionText(
  view: ProjectedGameView,
  seatNames: Readonly<Record<PlayerId, string>>,
): string | null {
  const pending = view.pendingAction;
  if (!pending) return null;
  const board = view as unknown as BoardLike;
  const who = seatNames[pending.actorId];
  const card = pending.committedCard
    ? cardMap.get(pending.committedCard.cardId)?.name
    : undefined;
  switch (pending.main.type) {
    case "play_card":
      return `${who} is playing ${card ?? "a card"}`;
    case "strike":
      return `${who} is striking ${nameOf(board, pending.main.targetId)} with ${nameOf(board, pending.main.attackerId)}`;
    case "shift":
      return `${who} is shifting ${nameOf(board, pending.main.entityId)} to ${pending.main.toFront}`;
    case "activate_ability":
      return `${who} is activating ${nameOf(board, pending.main.sourceId)}`;
    case "prepare_card":
      return `${who} is preparing a card`;
  }
}

/** Player-facing narration: names instead of seat IDs, themed terms. */
export function narrate(
  event: GameEvent,
  view: BoardLike,
  seatNames: Readonly<Record<PlayerId, string>>,
  terms: Readonly<Record<string, string>>,
): string | null {
  const who = (playerId: PlayerId) => seatNames[playerId];
  const front = (id: string) => `${id} ${terms.front ?? "Front"}`;
  switch (event.type) {
    case "mulligan_submitted":
      return `${who(event.playerId)} replaced ${event.count} card${event.count === 1 ? "" : "s"}.`;
    case "mulligan_complete":
      return "Opening hands are locked in.";
    case "reaction_played":
      return `${who(event.playerId)} responded with ${nameOf(view, event.instanceId)}.`;
    case "action_canceled":
      return `${who(event.playerId)}'s action was canceled.`;
    case "entity_deployed":
      return `${who(event.playerId)} deployed ${nameOf(view, event.instanceId)} to ${front(event.front)}.`;
    case "entity_shifted":
      return `${nameOf(view, event.instanceId)} shifted to ${front(event.to)}.`;
    case "damage_dealt":
      return event.amount > 0
        ? `${nameOf(view, event.sourceId) || "An effect"} dealt ${event.amount} to ${nameOf(view, event.targetId) || "a target"}.`
        : null;
    case "damage_replaced": {
      const entry =
        event.replacement === "protected"
          ? statusEntry("protected")
          : glossaryById.get(`keyword.${event.replacement}`);
      return `${entry?.name ?? event.replacement} prevented ${event.prevented} damage.`;
    }
    case "entity_defeated":
      return `${nameOf(view, event.instanceId) || (terms.entity ?? "An Entity")} was defeated.`;
    case "status_added":
      return `${nameOf(view, event.targetId)} is ${statusEntry(event.statusId)?.name ?? event.statusId}.`;
    case "front_control_resolved":
      return `${front(event.front)}: ${event.controllerId ? `${who(event.controllerId)} controls` : "contested"} (${event.p1Presence}–${event.p2Presence}).`;
    case "dominion_gained":
      return `${who(event.playerId)} gained ${terms.dominion ?? "Dominion"} (${event.total}/6).`;
    case "player_passed":
      return `${who(event.playerId)} passed for the Cycle.`;
    case "cycle_started":
      return `Cycle ${event.cycle} begins.`;
    case "game_won":
      return `${who(event.playerId)} won by ${event.reason === "dominion" ? (terms.dominion ?? "Dominion") : (terms.integrity ?? "Integrity")}.`;
    default:
      return null;
  }
}
