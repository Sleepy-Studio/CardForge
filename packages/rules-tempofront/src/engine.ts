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
  ProjectedGameView,
  ReplayRecord,
  RulesEngine,
} from "@cardforge/rules-kernel";
import { shuffle, stateHash } from "@cardforge/rules-kernel";
import { proofCardMap, proofContentHash } from "./cards.js";
import { tempoFrontRules } from "./ruleset.js";

const playerIds = ["p1", "p2"] as const;
const frontIds = ["left", "center", "right"] as const;
const slotIds = ["vanguard", "support"] as const;

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
    applied = 0;
  } else {
    const armor = definitionFor(cards, target).keywords?.armor;
    if (typeof armor === "number") applied = Math.max(0, applied - armor);
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
      resolveAbility(
        cards,
        state,
        item.playerId,
        item.entity,
        ability,
        undefined,
        events,
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
    const viewed = player.deck.splice(0, effect.amount);
    const selected = viewed.shift();
    if (selected) player.hand.push(selected);
    player.deck.push(...viewed);
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

function resolveAbility(
  cards: ReadonlyMap<string, CardDefinition>,
  state: GameState,
  playerId: PlayerId,
  source: CardInstance,
  ability: AbilityDefinition,
  chosenTargetId: string | undefined,
  events: GameEvent[],
  sourceFront?: FrontId,
): void {
  for (const effect of ability.effects) {
    resolveEffect(
      cards,
      state,
      playerId,
      source,
      effect,
      chosenTargetId,
      events,
      sourceFront,
    );
    if (state.winner) break;
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

function validateTurn(state: GameState, playerId: PlayerId): void {
  if (state.winner) throw new Error("The match is already complete");
  const active = currentPlayer(state);
  if (active !== playerId)
    throw new Error(`It is ${active ?? "no player's"} timeline priority`);
}

export class TempoFrontEngine implements RulesEngine {
  readonly cards: ReadonlyMap<string, CardDefinition>;

  constructor(cards: ReadonlyMap<string, CardDefinition> = proofCardMap) {
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
      commandNumber: 0,
      winner: null,
      victoryReason: null,
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
    if (state.winner || currentPlayer(state) !== playerId) return [];
    const player = state.players[playerId];
    const commands: Command[] = [];
    for (const card of player.hand) {
      const definition = definitionFor(this.cards, card);
      if (
        definition.focusCost > player.focus ||
        player.time + definition.playTime > 17
      )
        continue;
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
    validateTurn(state, command.playerId);
    const legal = this.getLegalCommands(state, command.playerId);
    if (
      !legal.some(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(command),
      )
    )
      throw new Error(`Illegal command: ${JSON.stringify(command)}`);
    const events: GameEvent[] = [];
    const player = state.players[command.playerId];
    if (command.type === "pass") {
      player.passed = true;
      events.push({ type: "player_passed", playerId: command.playerId });
    } else if (command.type === "play_card") {
      const handIndex = player.hand.findIndex(
        (card) => card.instanceId === command.instanceId,
      );
      const card = player.hand[handIndex]!;
      const definition = definitionFor(this.cards, card);
      player.hand.splice(handIndex, 1);
      player.focus -= definition.focusCost;
      player.time += definition.playTime;
      events.push({
        type: "card_played",
        playerId: command.playerId,
        instanceId: card.instanceId,
      });
      if (definition.type === "entity") {
        const front = command.front!;
        const slot = command.slot!;
        card.ready = definition.keywords?.rapid === true;
        card.barrier = definition.keywords?.barrier === true;
        state.fronts[front].slots[command.playerId][slot] = card;
        events.push({
          type: "entity_deployed",
          playerId: command.playerId,
          instanceId: card.instanceId,
          front,
          slot,
        });
        for (const ability of definition.abilities?.filter(
          (candidate) => candidate.trigger === "on_deploy",
        ) ?? []) {
          resolveAbility(
            this.cards,
            state,
            command.playerId,
            card,
            ability,
            command.targetId,
            events,
            front,
          );
        }
      } else {
        for (const ability of definition.abilities ?? [])
          resolveAbility(
            this.cards,
            state,
            command.playerId,
            card,
            ability,
            command.targetId,
            events,
          );
        player.discard.push(card);
      }
    } else if (command.type === "shift") {
      const located = locateEntity(state, command.entityId)!;
      state.fronts[located.front].slots[command.playerId][located.slot] = null;
      state.fronts[command.toFront].slots[command.playerId][command.toSlot] =
        located.entity;
      located.entity.shiftsThisCycle += 1;
      const mobile =
        definitionFor(this.cards, located.entity).keywords?.mobile === true;
      player.time += mobile ? 1 : 2;
      events.push({
        type: "entity_shifted",
        instanceId: located.entity.instanceId,
        from: located.front,
        to: command.toFront,
      });
    } else {
      const located = locateEntity(state, command.attackerId)!;
      const attacker = located.entity;
      const attackerDefinition = definitionFor(this.cards, attacker);
      player.time += attackerDefinition.strikeTime ?? 3;
      attacker.ready = false;
      if (command.targetId === "leader") {
        const defenderId = opponentOf(command.playerId);
        const damage = attackerDefinition.power ?? 0;
        state.players[defenderId].integrity -= damage;
        events.push({
          type: "damage_dealt",
          sourceId: attacker.instanceId,
          targetId: "leader",
          amount: damage,
        });
      } else {
        const defender = locateEntity(state, command.targetId)!.entity;
        const defenderDefinition = definitionFor(this.cards, defender);
        dealEntityDamage(
          this.cards,
          defender,
          attackerDefinition.power ?? 0,
          attacker.instanceId,
          events,
        );
        const defenderLocation = locateEntity(state, defender.instanceId)!;
        const canRetaliate =
          defenderDefinition.keywords?.ranged === true ||
          (defenderLocation.slot === "vanguard" && located.slot === "vanguard");
        if (canRetaliate)
          dealEntityDamage(
            this.cards,
            attacker,
            defenderDefinition.power ?? 0,
            defender.instanceId,
            events,
          );
        processDefeats(this.cards, state, events);
      }
      checkWin(state, events);
    }
    state.commandNumber += 1;
    if (!state.winner && currentPlayer(state) === null)
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
    return {
      matchId: state.matchId,
      cycle: state.cycle,
      initiative: state.initiative,
      viewer: playerId,
      players: { p1: projectPlayer("p1"), p2: projectPlayer("p2") },
      fronts: structuredClone(state.fronts),
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
