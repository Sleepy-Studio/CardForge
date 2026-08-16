import type {
  AbilityDefinition,
  CardDefinition,
  EffectNode,
  FrontId,
  PlayerId,
  SlotId,
  TargetRef,
} from "@cardforge/card-schema";
import type {
  CardInstance,
  Command,
  CommandResult,
  GameEvent,
  GameState,
  PendingAction,
  PendingReaction,
  ProjectedGameView,
  QueuedEffect,
  ReplayRecord,
  RulesEngine,
} from "@cardforge/rules-kernel";
import { shuffle, stateHash } from "@cardforge/rules-kernel";
import { proofCardMap, proofContentHash } from "./cards.js";
import { tempoFrontRules } from "./ruleset.js";

const playerIds = ["p1", "p2"] as const;
const frontIds = ["left", "center", "right"] as const;
const slotIds = ["vanguard", "support"] as const;
const maximumQueuedEffects = 64;
const maximumResolvedEffects = 128;
const maximumEffectsPerAbility = 16;
const maximumEffectGraphDepth = 8;

function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === "p1" ? "p2" : "p1";
}

function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value))
    throw new Error(`${label} must be an integer`);
}

function emptyFront() {
  return {
    slots: {
      p1: { vanguard: null, support: null },
      p2: { vanguard: null, support: null },
    },
  };
}

function definitionFor(
  cards: ReadonlyMap<string, CardDefinition>,
  instance: CardInstance,
): CardDefinition {
  const definition = cards.get(instance.cardId);
  if (!definition || definition.revision !== instance.revision)
    throw new Error(
      `Missing pinned definition ${instance.cardId}@${instance.revision}`,
    );
  return definition;
}

function locateEntity(
  state: GameState,
  instanceId: string,
): { front: FrontId; slot: SlotId; entity: CardInstance } | null {
  for (const front of frontIds) {
    for (const playerId of playerIds) {
      for (const slot of slotIds) {
        const entity = state.fronts[front].slots[playerId][slot];
        if (entity?.instanceId === instanceId) return { front, slot, entity };
      }
    }
  }
  return null;
}

function currentPlayer(state: GameState): PlayerId | null {
  const available = playerIds.filter(
    (playerId) =>
      !state.players[playerId].passed &&
      state.players[playerId].time < tempoFrontRules.timelineLength,
  );
  if (available.length === 0) return null;
  if (available.length === 1) return available[0]!;
  const [p1, p2] = available;
  const p1Time = state.players[p1!].time;
  const p2Time = state.players[p2!].time;
  if (p1Time === p2Time) return state.initiative;
  return p1Time < p2Time ? p1! : p2!;
}

function makeInstance(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
): CardInstance {
  const definition = proofCardMap.get(cardId);
  if (!definition) throw new Error(`Unknown card ${cardId}`);
  const instance: CardInstance = {
    instanceId: `${playerId}-${state.nextInstance}`,
    cardId,
    revision: definition.revision,
    ownerId: playerId,
    controllerId: playerId,
    damage: 0,
    ready: false,
    barrier: false,
    shiftsThisCycle: 0,
  };
  state.nextInstance += 1;
  return instance;
}

function nextChoiceId(state: GameState): string {
  const choiceId = `choice-${state.nextChoice}`;
  state.nextChoice += 1;
  return choiceId;
}

function checkWin(state: GameState, events: GameEvent[]): void {
  if (state.winner) return;
  for (const playerId of playerIds) {
    const opponentId = opponentOf(playerId);
    if (state.players[opponentId].integrity <= 0) {
      state.winner = playerId;
      state.victoryReason = "integrity";
      events.push({ type: "game_won", playerId, reason: "integrity" });
      return;
    }
  }
}

function drawCard(
  state: GameState,
  playerId: PlayerId,
  events: GameEvent[],
): void {
  const player = state.players[playerId];
  const card = player.deck.shift();
  if (!card) {
    player.fatigue += 1;
    player.integrity -= player.fatigue;
    checkWin(state, events);
    return;
  }
  if (player.hand.length >= tempoFrontRules.handLimit)
    player.discard.push(card);
  else player.hand.push(card);
}

function dealEntityDamage(
  cards: ReadonlyMap<string, CardDefinition>,
  target: CardInstance,
  amount: number,
  sourceId: string,
  events: GameEvent[],
): void {
  assertInteger(amount, "Damage");
  if (amount <= 0) return;
  let applied = amount;
  if (target.barrier) {
    target.barrier = false;
    events.push({
      type: "damage_replaced",
      sourceId,
      targetId: target.instanceId,
      replacement: "barrier",
      prevented: applied,
    });
    applied = 0;
  }
  if (applied > 0) {
    const armor = definitionFor(cards, target).keywords?.armor;
    if (typeof armor === "number") {
      const beforeArmor = applied;
      applied = Math.max(0, applied - armor);
      events.push({
        type: "damage_replaced",
        sourceId,
        targetId: target.instanceId,
        replacement: "armor",
        prevented: beforeArmor - applied,
      });
    }
  }
  target.damage += applied;
  events.push({
    type: "damage_dealt",
    sourceId,
    targetId: target.instanceId,
    amount: applied,
  });
}

function processDefeats(
  cards: ReadonlyMap<string, CardDefinition>,
  state: GameState,
  events: GameEvent[],
): void {
  const defeated: Array<{
    front: FrontId;
    slot: SlotId;
    playerId: PlayerId;
    entity: CardInstance;
    definition: CardDefinition;
  }> = [];
  for (const front of frontIds) {
    for (const playerId of playerIds) {
      for (const slot of slotIds) {
        const entity = state.fronts[front].slots[playerId][slot];
        if (!entity) continue;
        const definition = definitionFor(cards, entity);
        if (entity.damage >= (definition.vitality ?? 0))
          defeated.push({ front, slot, playerId, entity, definition });
      }
    }
  }
  for (const item of defeated)
    state.fronts[item.front].slots[item.playerId][item.slot] = null;
  for (const item of defeated) {
    state.players[item.entity.ownerId].discard.push(item.entity);
    events.push({
      type: "entity_defeated",
      instanceId: item.entity.instanceId,
    });
  }
  for (const item of defeated) {
    for (const ability of item.definition.abilities?.filter(
      (candidate) => candidate.trigger === "on_defeat",
    ) ?? []) {
      enqueueAbility(
        state,
        item.playerId,
        item.entity,
        ability,
        undefined,
        item.front,
      );
    }
  }
}

function resolveTarget(
  state: GameState,
  playerId: PlayerId,
  source: CardInstance,
  target: TargetRef,
  chosenTargetId: string | undefined,
): CardInstance | "friendly_leader" | "enemy_leader" | null {
  if (target.kind === "friendly_leader") return "friendly_leader";
  if (target.kind === "enemy_leader") return "enemy_leader";
  if (target.kind === "self") return source;
  if (!chosenTargetId) return null;
  const located = locateEntity(state, chosenTargetId);
  if (!located) return null;
  if (
    target.kind === "chosen_friendly_entity" &&
    located.entity.controllerId !== playerId
  )
    return null;
  if (
    target.kind === "chosen_enemy_entity" &&
    located.entity.controllerId === playerId
  )
    return null;
  return located.entity;
}

function firstOpenSlot(
  state: GameState,
  playerId: PlayerId,
  preferredFront?: FrontId,
): { front: FrontId; slot: SlotId } | null {
  const fronts = preferredFront
    ? [preferredFront, ...frontIds.filter((front) => front !== preferredFront)]
    : frontIds;
  for (const front of fronts) {
    for (const slot of slotIds) {
      if (!state.fronts[front].slots[playerId][slot]) return { front, slot };
    }
  }
  return null;
}

function shiftAutomatically(
  state: GameState,
  entity: CardInstance,
  events: GameEvent[],
): void {
  const located = locateEntity(state, entity.instanceId);
  if (!located) return;
  const index = frontIds.indexOf(located.front);
  const candidates = [frontIds[index - 1], frontIds[index + 1]].filter(
    (front): front is FrontId => front !== undefined,
  );
  for (const front of candidates) {
    for (const slot of slotIds) {
      if (state.fronts[front].slots[entity.controllerId][slot]) continue;
      state.fronts[located.front].slots[entity.controllerId][located.slot] =
        null;
      state.fronts[front].slots[entity.controllerId][slot] = entity;
      events.push({
        type: "entity_shifted",
        instanceId: entity.instanceId,
        from: located.front,
        to: front,
      });
      return;
    }
  }
}

function resolveEffect(
  cards: ReadonlyMap<string, CardDefinition>,
  state: GameState,
  playerId: PlayerId,
  source: CardInstance,
  effect: EffectNode,
  chosenTargetId: string | undefined,
  events: GameEvent[],
  sourceFront?: FrontId,
): void {
  if (effect.op === "cancel_previous_chain_link") return;
  if (effect.op === "draw") {
    for (let count = 0; count < effect.amount; count += 1)
      drawCard(state, playerId, events);
    return;
  }
  if (effect.op === "spawn") {
    const destination = firstOpenSlot(state, playerId, sourceFront);
    if (!destination) return;
    const token = makeInstance(state, playerId, effect.tokenCardId);
    state.fronts[destination.front].slots[playerId][destination.slot] = token;
    events.push({
      type: "entity_deployed",
      playerId,
      instanceId: token.instanceId,
      front: destination.front,
      slot: destination.slot,
    });
    return;
  }
  if (effect.op === "salvage") {
    const discard = state.players[playerId].discard;
    const index = discard.findIndex(
      (card) =>
        effect.cardType === undefined ||
        definitionFor(cards, card).type === effect.cardType,
    );
    if (
      index >= 0 &&
      state.players[playerId].hand.length < tempoFrontRules.handLimit
    )
      state.players[playerId].hand.push(discard.splice(index, 1)[0]!);
    return;
  }
  if (effect.op === "scout") {
    const player = state.players[playerId];
    const options = player.deck.splice(0, effect.amount);
    if (options.length === 0) return;
    const choiceId = nextChoiceId(state);
    state.pendingChoice = {
      choiceId,
      chooserId: playerId,
      kind: "select_card",
      options,
      minimum: 1,
      maximum: 1,
    };
    events.push({
      type: "choice_created",
      playerId,
      choiceId,
      choiceKind: "select_card",
      optionCount: options.length,
    });
    return;
  }
  if (effect.op === "optional_focus") {
    if (state.players[playerId].focus < effect.amount) return;
    const choiceId = nextChoiceId(state);
    const continuation = effect.effects.map((nestedEffect) => ({
      source,
      controllerId: playerId,
      effect: nestedEffect,
      ...(chosenTargetId === undefined ? {} : { chosenTargetId }),
      ...(sourceFront === undefined ? {} : { sourceFront }),
    }));
    state.pendingChoice = {
      choiceId,
      chooserId: playerId,
      kind: "optional_focus",
      amount: effect.amount,
      continuation,
    };
    events.push({
      type: "choice_created",
      playerId,
      choiceId,
      choiceKind: "optional_focus",
      optionCount: 2,
    });
    return;
  }
  const target = resolveTarget(
    state,
    playerId,
    source,
    effect.target,
    chosenTargetId,
  );
  if (!target) return;
  if (effect.op === "deal_damage") {
    if (target === "enemy_leader") {
      state.players[opponentOf(playerId)].integrity -= effect.amount;
      events.push({
        type: "damage_dealt",
        sourceId: source.instanceId,
        targetId: "leader",
        amount: effect.amount,
      });
    } else if (target !== "friendly_leader")
      dealEntityDamage(cards, target, effect.amount, source.instanceId, events);
  } else if (effect.op === "heal") {
    if (target === "friendly_leader")
      state.players[playerId].integrity = Math.min(
        tempoFrontRules.startingIntegrity,
        state.players[playerId].integrity + effect.amount,
      );
    else if (target !== "enemy_leader")
      target.damage = Math.max(0, target.damage - effect.amount);
  } else if (effect.op === "shift") {
    if (typeof target !== "string") shiftAutomatically(state, target, events);
  } else if (effect.op === "add_barrier") {
    if (typeof target !== "string") target.barrier = true;
  }
  processDefeats(cards, state, events);
  checkWin(state, events);
}

function enqueueAbility(
  state: GameState,
  playerId: PlayerId,
  source: CardInstance,
  ability: AbilityDefinition,
  chosenTargetId: string | undefined,
  sourceFront?: FrontId,
): void {
  for (const effect of ability.effects) {
    if (state.effectQueue.length >= maximumQueuedEffects)
      throw new Error(
        `Effect queue exceeded ${maximumQueuedEffects} pending operations`,
      );
    const queued: QueuedEffect = {
      source,
      controllerId: playerId,
      effect,
      ...(chosenTargetId === undefined ? {} : { chosenTargetId }),
      ...(sourceFront === undefined ? {} : { sourceFront }),
    };
    state.effectQueue.push(queued);
  }
}

function drainEffectQueue(
  cards: ReadonlyMap<string, CardDefinition>,
  state: GameState,
  events: GameEvent[],
): void {
  let resolved = 0;
  while (
    state.effectQueue.length > 0 &&
    !state.winner &&
    !state.pendingChoice
  ) {
    if (resolved >= maximumResolvedEffects)
      throw new Error(
        `Effect resolution exceeded ${maximumResolvedEffects} operations`,
      );
    const queued = state.effectQueue.shift()!;
    resolveEffect(
      cards,
      state,
      queued.controllerId,
      queued.source,
      queued.effect,
      queued.chosenTargetId,
      events,
      queued.sourceFront,
    );
    resolved += 1;
  }
}

function requiresTarget(
  definition: CardDefinition,
): "friendly" | "enemy" | "any" | null {
  for (const effect of definition.abilities?.flatMap(
    (ability) => ability.effects,
  ) ?? []) {
    if (!("target" in effect)) continue;
    if (effect.target.kind === "chosen_friendly_entity") return "friendly";
    if (effect.target.kind === "chosen_enemy_entity") return "enemy";
    if (effect.target.kind === "chosen_entity") return "any";
  }
  return null;
}

function allEntities(state: GameState, side?: PlayerId): CardInstance[] {
  const result: CardInstance[] = [];
  for (const front of frontIds) {
    for (const playerId of playerIds) {
      if (side && side !== playerId) continue;
      for (const slot of slotIds) {
        const entity = state.fronts[front].slots[playerId][slot];
        if (entity) result.push(entity);
      }
    }
  }
  return result;
}

function calculatePresence(
  cards: ReadonlyMap<string, CardDefinition>,
  state: GameState,
  playerId: PlayerId,
  front: FrontId,
): number {
  return slotIds.reduce((total, slot) => {
    const entity = state.fronts[front].slots[playerId][slot];
    return total + (entity ? (definitionFor(cards, entity).presence ?? 0) : 0);
  }, 0);
}

function advanceCycle(
  cards: ReadonlyMap<string, CardDefinition>,
  state: GameState,
  events: GameEvent[],
): void {
  let p1Controlled = 0;
  let p2Controlled = 0;
  for (const front of frontIds) {
    const p1 = calculatePresence(cards, state, "p1", front);
    const p2 = calculatePresence(cards, state, "p2", front);
    if (p1 > p2) p1Controlled += 1;
    else if (p2 > p1) p2Controlled += 1;
  }
  const scorer = p1Controlled >= 2 ? "p1" : p2Controlled >= 2 ? "p2" : null;
  if (scorer) {
    state.players[scorer].dominion += 1;
    events.push({
      type: "dominion_gained",
      playerId: scorer,
      total: state.players[scorer].dominion,
    });
    if (state.players[scorer].dominion >= tempoFrontRules.dominionToWin) {
      state.winner = scorer;
      state.victoryReason = "dominion";
      events.push({ type: "game_won", playerId: scorer, reason: "dominion" });
      return;
    }
  }
  state.cycle += 1;
  state.initiative = opponentOf(state.initiative);
  for (const playerId of playerIds) {
    const player = state.players[playerId];
    player.maxFocus = Math.min(
      tempoFrontRules.maximumFocus,
      player.maxFocus + 1,
    );
    player.focus = player.maxFocus;
    player.time = 0;
    player.passed = false;
    for (const entity of allEntities(state, playerId)) {
      entity.ready = true;
      entity.shiftsThisCycle = 0;
    }
    drawCard(state, playerId, events);
  }
  events.push({ type: "cycle_started", cycle: state.cycle });
}

function legalStrikeTargets(
  cards: ReadonlyMap<string, CardDefinition>,
  state: GameState,
  attacker: CardInstance,
): string[] {
  const located = locateEntity(state, attacker.instanceId);
  if (!located) return [];
  const definition = definitionFor(cards, attacker);
  if (
    !attacker.ready ||
    definition.keywords?.structure ||
    (located.slot === "support" && !definition.keywords?.ranged)
  )
    return [];
  const enemyId = opponentOf(attacker.controllerId);
  const enemyVanguard = state.fronts[located.front].slots[enemyId].vanguard;
  const enemySupport = state.fronts[located.front].slots[enemyId].support;
  if (definition.keywords?.ranged) {
    const targets = [enemyVanguard, enemySupport]
      .filter((entity): entity is CardInstance => entity !== null)
      .map((entity) => entity.instanceId);
    return targets.length > 0 ? targets : ["leader"];
  }
  if (enemyVanguard) return [enemyVanguard.instanceId];
  if (enemySupport) return [enemySupport.instanceId];
  return ["leader"];
}

function reactionAbility(definition: CardDefinition): AbilityDefinition {
  const ability = definition.abilities?.find(
    (candidate) => candidate.type === "reaction",
  );
  if (!ability) throw new Error(`${definition.cardId} has no Reaction ability`);
  return ability;
}

function reactionCancelsPrevious(definition: CardDefinition): boolean {
  return reactionAbility(definition).effects.some(
    (effect) => effect.op === "cancel_previous_chain_link",
  );
}

function enqueueReactionEffects(
  cards: ReadonlyMap<string, CardDefinition>,
  state: GameState,
  reaction: PendingReaction,
): void {
  const definition = definitionFor(cards, reaction.card);
  const ability = reactionAbility(definition);
  const filtered: AbilityDefinition = {
    ...ability,
    effects: ability.effects.filter(
      (effect) => effect.op !== "cancel_previous_chain_link",
    ),
  };
  enqueueAbility(
    state,
    reaction.playerId,
    reaction.card,
    filtered,
    reaction.targetId,
  );
}

function resolveMainAction(
  cards: ReadonlyMap<string, CardDefinition>,
  state: GameState,
  pending: PendingAction,
  events: GameEvent[],
): void {
  const command = pending.main;
  const player = state.players[pending.actorId];
  if (command.type === "play_card") {
    const card = pending.committedCard!;
    const definition = definitionFor(cards, card);
    if (definition.type === "entity") {
      const front = command.front!;
      const slot = command.slot!;
      if (state.fronts[front].slots[pending.actorId][slot]) {
        player.discard.push(card);
        events.push({
          type: "action_canceled",
          playerId: pending.actorId,
          actionType: command.type,
        });
        return;
      }
      card.ready = definition.keywords?.rapid === true;
      card.barrier = definition.keywords?.barrier === true;
      state.fronts[front].slots[pending.actorId][slot] = card;
      events.push({
        type: "entity_deployed",
        playerId: pending.actorId,
        instanceId: card.instanceId,
        front,
        slot,
      });
      for (const ability of definition.abilities?.filter(
        (candidate) => candidate.trigger === "on_deploy",
      ) ?? [])
        enqueueAbility(
          state,
          pending.actorId,
          card,
          ability,
          command.targetId,
          front,
        );
    } else {
      for (const ability of definition.abilities ?? [])
        enqueueAbility(state, pending.actorId, card, ability, command.targetId);
      player.discard.push(card);
    }
    drainEffectQueue(cards, state, events);
  } else if (command.type === "shift") {
    const located = locateEntity(state, command.entityId);
    if (
      !located ||
      state.fronts[command.toFront].slots[pending.actorId][command.toSlot]
    ) {
      events.push({
        type: "action_canceled",
        playerId: pending.actorId,
        actionType: command.type,
      });
      return;
    }
    state.fronts[located.front].slots[pending.actorId][located.slot] = null;
    state.fronts[command.toFront].slots[pending.actorId][command.toSlot] =
      located.entity;
    located.entity.shiftsThisCycle += 1;
    events.push({
      type: "entity_shifted",
      instanceId: located.entity.instanceId,
      from: located.front,
      to: command.toFront,
    });
  } else {
    const located = locateEntity(state, command.attackerId);
    if (!located) {
      events.push({
        type: "action_canceled",
        playerId: pending.actorId,
        actionType: command.type,
      });
      return;
    }
    const attacker = located.entity;
    const attackerDefinition = definitionFor(cards, attacker);
    if (command.targetId === "leader") {
      const damage = attackerDefinition.power ?? 0;
      state.players[opponentOf(pending.actorId)].integrity -= damage;
      events.push({
        type: "damage_dealt",
        sourceId: attacker.instanceId,
        targetId: "leader",
        amount: damage,
      });
    } else {
      const defenderLocation = locateEntity(state, command.targetId);
      if (!defenderLocation) {
        events.push({
          type: "action_canceled",
          playerId: pending.actorId,
          actionType: command.type,
        });
        return;
      }
      const defender = defenderLocation.entity;
      const defenderDefinition = definitionFor(cards, defender);
      dealEntityDamage(
        cards,
        defender,
        attackerDefinition.power ?? 0,
        attacker.instanceId,
        events,
      );
      const canRetaliate =
        defenderDefinition.keywords?.ranged === true ||
        (defenderLocation.slot === "vanguard" && located.slot === "vanguard");
      if (canRetaliate)
        dealEntityDamage(
          cards,
          attacker,
          defenderDefinition.power ?? 0,
          defender.instanceId,
          events,
        );
      processDefeats(cards, state, events);
      drainEffectQueue(cards, state, events);
    }
    checkWin(state, events);
  }
  events.push({
    type: "action_resolved",
    playerId: pending.actorId,
    actionType: command.type,
  });
}

function resolvePendingChain(
  cards: ReadonlyMap<string, CardDefinition>,
  state: GameState,
  events: GameEvent[],
): void {
  const pending = state.pendingAction!;
  let responseCanceled = false;
  let mainCanceled = false;
  if (pending.counterResponse) {
    const definition = definitionFor(cards, pending.counterResponse.card);
    responseCanceled = reactionCancelsPrevious(definition);
    enqueueReactionEffects(cards, state, pending.counterResponse);
    drainEffectQueue(cards, state, events);
    state.players[pending.counterResponse.playerId].discard.push(
      pending.counterResponse.card,
    );
  }
  if (pending.response) {
    if (responseCanceled) {
      events.push({
        type: "action_canceled",
        playerId: pending.response.playerId,
        actionType: "reaction",
      });
    } else {
      const definition = definitionFor(cards, pending.response.card);
      mainCanceled = reactionCancelsPrevious(definition);
      enqueueReactionEffects(cards, state, pending.response);
      drainEffectQueue(cards, state, events);
    }
    state.players[pending.response.playerId].discard.push(
      pending.response.card,
    );
  }
  if (mainCanceled) {
    if (pending.committedCard)
      state.players[pending.committedCard.ownerId].discard.push(
        pending.committedCard,
      );
    events.push({
      type: "action_canceled",
      playerId: pending.actorId,
      actionType: pending.main.type,
    });
  } else if (!state.winner) resolveMainAction(cards, state, pending, events);
  state.pendingAction = null;
  if (!state.pendingChoice) state.effectQueue.length = 0;
}

export function validateContentDefinitions(
  cards: ReadonlyMap<string, CardDefinition>,
): void {
  const validateEffect = (
    definition: CardDefinition,
    ability: AbilityDefinition,
    effect: EffectNode,
    depth: number,
  ): void => {
    if (depth > maximumEffectGraphDepth)
      throw new Error(
        `${definition.cardId}/${ability.abilityId} exceeds effect depth ${maximumEffectGraphDepth}`,
      );
    if (
      effect.op === "spawn" &&
      (!cards.has(effect.tokenCardId) ||
        cards.get(effect.tokenCardId)?.generatedOnly !== true)
    )
      throw new Error(
        `${definition.cardId} references invalid Token ${effect.tokenCardId}`,
      );
    if (effect.op === "optional_focus") {
      assertInteger(
        effect.amount,
        `${definition.cardId}/${ability.abilityId} optional Focus`,
      );
      if (effect.amount <= 0)
        throw new Error(
          `${definition.cardId} has a non-positive optional cost`,
        );
      if (effect.effects.length > maximumEffectsPerAbility)
        throw new Error(
          `${definition.cardId}/${ability.abilityId} optional branch exceeds ${maximumEffectsPerAbility} effects`,
        );
      for (const nested of effect.effects)
        validateEffect(definition, ability, nested, depth + 1);
    }
  };
  const createsChoice = (effect: EffectNode): boolean =>
    effect.op === "scout" || effect.op === "optional_focus";
  for (const definition of cards.values()) {
    assertInteger(definition.focusCost, `${definition.cardId} Focus cost`);
    assertInteger(definition.playTime, `${definition.cardId} Play Time`);
    if (definition.focusCost < 0 || definition.playTime < 0)
      throw new Error(`${definition.cardId} has a negative cost`);
    for (const ability of definition.abilities ?? []) {
      if (ability.tempoDebt !== undefined) {
        assertInteger(
          ability.tempoDebt,
          `${definition.cardId}/${ability.abilityId} Tempo Debt`,
        );
        if (ability.type !== "reaction" || ability.tempoDebt < 0)
          throw new Error(
            `${definition.cardId}/${ability.abilityId} has invalid Tempo Debt`,
          );
      }
      if (ability.effects.length > maximumEffectsPerAbility)
        throw new Error(
          `${definition.cardId}/${ability.abilityId} exceeds ${maximumEffectsPerAbility} effects`,
        );
      if (
        ability.type !== "reaction" &&
        ability.effects.some(
          (effect) => effect.op === "cancel_previous_chain_link",
        )
      )
        throw new Error(
          `${definition.cardId} uses chain cancellation outside a Reaction`,
        );
      if (ability.type === "reaction" && ability.effects.some(createsChoice))
        throw new Error(
          `${definition.cardId} creates an unsupported choice during a Reaction`,
        );
      for (const effect of ability.effects)
        validateEffect(definition, ability, effect, 1);
    }
  }
}

export class TempoFrontEngine implements RulesEngine {
  readonly cards: ReadonlyMap<string, CardDefinition>;

  constructor(cards: ReadonlyMap<string, CardDefinition> = proofCardMap) {
    validateContentDefinitions(cards);
    this.cards = cards;
  }

  createGame(input: {
    matchId: string;
    seed: number;
    decks: Readonly<Record<PlayerId, readonly string[]>>;
  }): GameState {
    assertInteger(input.seed, "Seed");
    for (const playerId of playerIds) {
      if (input.decks[playerId].length !== 40)
        throw new Error(`${playerId} must provide exactly 40 cards`);
      for (const cardId of input.decks[playerId]) {
        const definition = this.cards.get(cardId);
        if (
          !definition ||
          definition.generatedOnly ||
          definition.type === "leader"
        )
          throw new Error(`${cardId} is not legal in a proof deck`);
      }
    }
    const state: GameState = {
      matchId: input.matchId,
      rulesetRevision: tempoFrontRules.revision,
      contentHash: proofContentHash,
      rng: { seed: input.seed >>> 0, index: 0 },
      cycle: 1,
      initiative: "p1",
      nextInstance: 1,
      nextChoice: 1,
      commandNumber: 0,
      winner: null,
      victoryReason: null,
      pendingAction: null,
      pendingChoice: null,
      effectQueue: [],
      players: {
        p1: {
          playerId: "p1",
          integrity: 20,
          maxFocus: 3,
          focus: 3,
          time: 0,
          dominion: 0,
          fatigue: 0,
          passed: false,
          deck: [],
          hand: [],
          discard: [],
        },
        p2: {
          playerId: "p2",
          integrity: 20,
          maxFocus: 3,
          focus: 3,
          time: 0,
          dominion: 0,
          fatigue: 0,
          passed: false,
          deck: [],
          hand: [],
          discard: [],
        },
      },
      fronts: { left: emptyFront(), center: emptyFront(), right: emptyFront() },
    };
    for (const playerId of playerIds) {
      const instances = input.decks[playerId].map((cardId) =>
        makeInstance(state, playerId, cardId),
      );
      state.players[playerId].deck.push(...shuffle(instances, state.rng));
      for (let count = 0; count < tempoFrontRules.startingHand; count += 1)
        drawCard(state, playerId, []);
    }
    state.initiative = state.rng.seed % 2 === 0 ? "p1" : "p2";
    return state;
  }

  getLegalCommands(state: GameState, playerId: PlayerId): readonly Command[] {
    if (state.winner) return [];
    if (state.pendingChoice) {
      const choice = state.pendingChoice;
      if (choice.chooserId !== playerId) return [];
      if (choice.kind === "select_card")
        return choice.options.map((option) => ({
          type: "resolve_choice" as const,
          playerId,
          choiceId: choice.choiceId,
          optionIds: [option.instanceId],
        }));
      return [
        {
          type: "resolve_choice",
          playerId,
          choiceId: choice.choiceId,
          optionIds: ["decline"],
        },
        {
          type: "resolve_choice",
          playerId,
          choiceId: choice.choiceId,
          optionIds: ["pay"],
        },
      ];
    }
    if (state.pendingAction) {
      const expectedPlayer =
        state.pendingAction.phase === "response"
          ? opponentOf(state.pendingAction.actorId)
          : state.pendingAction.actorId;
      if (playerId !== expectedPlayer) return [];
      const reactionCommands: Command[] = [];
      const player = state.players[playerId];
      for (const card of player.hand) {
        const definition = definitionFor(this.cards, card);
        if (
          definition.type !== "reaction" ||
          definition.focusCost > player.focus
        )
          continue;
        const targetKind = requiresTarget(definition);
        if (!targetKind) {
          reactionCommands.push({
            type: "play_reaction",
            playerId,
            instanceId: card.instanceId,
          });
          continue;
        }
        const side =
          targetKind === "friendly"
            ? playerId
            : targetKind === "enemy"
              ? opponentOf(playerId)
              : undefined;
        for (const target of allEntities(state, side))
          reactionCommands.push({
            type: "play_reaction",
            playerId,
            instanceId: card.instanceId,
            targetId: target.instanceId,
          });
      }
      reactionCommands.push({ type: "pass_response", playerId });
      return reactionCommands;
    }
    if (currentPlayer(state) !== playerId) return [];
    const player = state.players[playerId];
    const commands: Command[] = [];
    for (const card of player.hand) {
      const definition = definitionFor(this.cards, card);
      if (definition.focusCost > player.focus) continue;
      if (definition.type === "entity") {
        for (const front of frontIds) {
          for (const slot of slotIds) {
            if (
              definition.slotRestriction &&
              definition.slotRestriction !== "any" &&
              definition.slotRestriction !== slot
            )
              continue;
            if (!state.fronts[front].slots[playerId][slot])
              commands.push({
                type: "play_card",
                playerId,
                instanceId: card.instanceId,
                front,
                slot,
              });
          }
        }
      } else if (definition.type === "tactic") {
        const targetKind = requiresTarget(definition);
        if (!targetKind)
          commands.push({
            type: "play_card",
            playerId,
            instanceId: card.instanceId,
          });
        else {
          const side =
            targetKind === "friendly"
              ? playerId
              : targetKind === "enemy"
                ? opponentOf(playerId)
                : undefined;
          for (const target of allEntities(state, side))
            commands.push({
              type: "play_card",
              playerId,
              instanceId: card.instanceId,
              targetId: target.instanceId,
            });
        }
      }
    }
    for (const entity of allEntities(state, playerId)) {
      for (const targetId of legalStrikeTargets(this.cards, state, entity))
        commands.push({
          type: "strike",
          playerId,
          attackerId: entity.instanceId,
          targetId,
        });
      const located = locateEntity(state, entity.instanceId)!;
      const definition = definitionFor(this.cards, entity);
      if (entity.shiftsThisCycle < 1 && !definition.keywords?.structure) {
        const index = frontIds.indexOf(located.front);
        for (const toFront of [frontIds[index - 1], frontIds[index + 1]]) {
          if (!toFront) continue;
          for (const toSlot of slotIds) {
            if (!state.fronts[toFront].slots[playerId][toSlot])
              commands.push({
                type: "shift",
                playerId,
                entityId: entity.instanceId,
                toFront,
                toSlot,
              });
          }
        }
      }
    }
    commands.push({ type: "pass", playerId });
    return commands;
  }

  applyCommand(inputState: GameState, command: Command): CommandResult {
    const state = structuredClone(inputState);
    const legal = this.getLegalCommands(state, command.playerId);
    if (
      !legal.some(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(command),
      )
    )
      throw new Error(`Illegal command: ${JSON.stringify(command)}`);
    const events: GameEvent[] = [];
    const player = state.players[command.playerId];
    if (command.type === "resolve_choice") {
      const choice = state.pendingChoice!;
      if (choice.kind === "select_card") {
        const selectedId = command.optionIds[0]!;
        const selected = choice.options.find(
          (option) => option.instanceId === selectedId,
        )!;
        const unselected = choice.options.filter(
          (option) => option.instanceId !== selectedId,
        );
        if (player.hand.length >= tempoFrontRules.handLimit)
          player.discard.push(selected);
        else player.hand.push(selected);
        player.deck.push(...unselected);
      } else if (command.optionIds[0] === "pay") {
        player.focus -= choice.amount;
        if (
          state.effectQueue.length + choice.continuation.length >
          maximumQueuedEffects
        )
          throw new Error(
            `Effect queue exceeded ${maximumQueuedEffects} pending operations`,
          );
        state.effectQueue.unshift(...choice.continuation);
      }
      state.pendingChoice = null;
      events.push({
        type: "choice_resolved",
        playerId: command.playerId,
        choiceId: command.choiceId,
        optionIds: command.optionIds,
      });
      drainEffectQueue(this.cards, state, events);
    } else if (command.type === "pass_response") {
      const pending = state.pendingAction!;
      const depth = pending.phase === "response" ? 1 : 2;
      events.push({
        type: "response_passed",
        playerId: command.playerId,
        chainDepth: depth,
      });
      resolvePendingChain(this.cards, state, events);
    } else if (command.type === "play_reaction") {
      const pending = state.pendingAction!;
      const handIndex = player.hand.findIndex(
        (card) => card.instanceId === command.instanceId,
      );
      const card = player.hand.splice(handIndex, 1)[0]!;
      const definition = definitionFor(this.cards, card);
      const ability = reactionAbility(definition);
      player.focus -= definition.focusCost;
      player.time += ability.tempoDebt ?? definition.playTime;
      const reaction: PendingReaction = {
        playerId: command.playerId,
        card,
        ...(command.targetId === undefined
          ? {}
          : { targetId: command.targetId }),
      };
      if (pending.phase === "response") {
        pending.response = reaction;
        pending.phase = "counter_response";
        events.push({
          type: "reaction_played",
          playerId: command.playerId,
          instanceId: card.instanceId,
          chainDepth: 1,
        });
      } else {
        pending.counterResponse = reaction;
        events.push({
          type: "reaction_played",
          playerId: command.playerId,
          instanceId: card.instanceId,
          chainDepth: 2,
        });
        resolvePendingChain(this.cards, state, events);
      }
    } else if (command.type === "pass") {
      player.passed = true;
      events.push({ type: "player_passed", playerId: command.playerId });
    } else {
      let committedCard: CardInstance | undefined;
      if (command.type === "play_card") {
        const handIndex = player.hand.findIndex(
          (card) => card.instanceId === command.instanceId,
        );
        committedCard = player.hand.splice(handIndex, 1)[0]!;
        const definition = definitionFor(this.cards, committedCard);
        player.focus -= definition.focusCost;
        player.time += definition.playTime;
        events.push({
          type: "card_played",
          playerId: command.playerId,
          instanceId: committedCard.instanceId,
        });
      } else if (command.type === "strike") {
        const attacker = locateEntity(state, command.attackerId)!.entity;
        player.time += definitionFor(this.cards, attacker).strikeTime ?? 3;
        attacker.ready = false;
      } else {
        const entity = locateEntity(state, command.entityId)!.entity;
        const mobile =
          definitionFor(this.cards, entity).keywords?.mobile === true;
        player.time += mobile ? 1 : 2;
      }
      state.pendingAction = {
        actorId: command.playerId,
        main: command,
        phase: "response",
        response: null,
        counterResponse: null,
        ...(committedCard === undefined ? {} : { committedCard }),
      };
      events.push({
        type: "action_declared",
        playerId: command.playerId,
        actionType: command.type,
      });
    }
    state.commandNumber += 1;
    if (
      !state.winner &&
      !state.pendingAction &&
      !state.pendingChoice &&
      currentPlayer(state) === null
    )
      advanceCycle(this.cards, state, events);
    return { state, events, hash: stateHash(state) };
  }

  projectView(state: GameState, playerId: PlayerId): ProjectedGameView {
    const projectPlayer = (projectedId: PlayerId) => {
      const player = state.players[projectedId];
      return {
        playerId: projectedId,
        integrity: player.integrity,
        maxFocus: player.maxFocus,
        focus: player.focus,
        time: player.time,
        dominion: player.dominion,
        deckCount: player.deck.length,
        handCount: player.hand.length,
        ...(projectedId === playerId
          ? { hand: structuredClone(player.hand) }
          : {}),
        discard: structuredClone(player.discard),
      };
    };
    const projectChoice = (): ProjectedGameView["pendingChoice"] => {
      const choice = state.pendingChoice;
      if (!choice) return null;
      const base = {
        choiceId: choice.choiceId,
        chooserId: choice.chooserId,
        kind: choice.kind,
        optionCount: choice.kind === "select_card" ? choice.options.length : 2,
      };
      if (choice.kind === "select_card")
        return {
          ...base,
          ...(choice.chooserId === playerId
            ? { cardOptions: structuredClone(choice.options) }
            : {}),
        };
      return {
        ...base,
        focusAmount: choice.amount,
        ...(choice.chooserId === playerId
          ? { optionIds: ["decline", "pay"] }
          : {}),
      };
    };
    return {
      matchId: state.matchId,
      cycle: state.cycle,
      initiative: state.initiative,
      viewer: playerId,
      players: { p1: projectPlayer("p1"), p2: projectPlayer("p2") },
      fronts: structuredClone(state.fronts),
      pendingAction: structuredClone(state.pendingAction),
      pendingChoice: projectChoice(),
      winner: state.winner,
    };
  }
}

export function replayGame(
  engine: TempoFrontEngine,
  replay: ReplayRecord,
): GameState {
  let state = engine.createGame({
    matchId: replay.matchId,
    seed: replay.seed,
    decks: replay.decks,
  });
  for (const command of replay.acceptedCommands)
    state = engine.applyCommand(state, command).state;
  return state;
}
