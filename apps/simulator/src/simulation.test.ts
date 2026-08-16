import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId } from "@cardforge/card-schema";
import {
  stateHash,
  type CardInstance,
  type GameState,
} from "@cardforge/rules-kernel";
import {
  proofCardMap,
  proofDeck,
  TempoFrontEngine,
} from "@cardforge/rules-tempofront";
import { runBatch, simulateGame, verifyReplay } from "./simulation.js";

function takeCard(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
): CardInstance {
  const player = state.players[playerId];
  for (const zone of [player.hand, player.deck]) {
    const index = zone.findIndex((card) => card.cardId === cardId);
    if (index >= 0) return zone.splice(index, 1)[0]!;
  }
  throw new Error(`Missing ${cardId} for ${playerId}`);
}

function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
): CardInstance {
  const card = takeCard(state, playerId, cardId);
  state.players[playerId].hand.push(card);
  return card;
}

function putInVanguard(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
): CardInstance {
  const card = takeCard(state, playerId, cardId);
  card.ready = true;
  state.fronts.center.slots[playerId].vanguard = card;
  return card;
}

void describe("TempoFront deterministic proof", () => {
  void it("creates identical initial states from identical inputs", () => {
    const engine = new TempoFrontEngine();
    const input = {
      matchId: "same",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    } as const;
    assert.equal(
      stateHash(engine.createGame(input)),
      stateHash(engine.createGame(input)),
    );
  });

  void it("replays a complete match to the exact final hash", () => {
    const result = simulateGame(8675309);
    assert.notEqual(result.finalState.winner, null);
    assert.doesNotThrow(() => verifyReplay(result));
  });

  void it("keeps hidden hands out of opponent projections", () => {
    const engine = new TempoFrontEngine();
    const state = engine.createGame({
      matchId: "views",
      seed: 7,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const view = engine.projectView(state, "p1");
    assert.equal(view.players.p1.hand?.length, 5);
    assert.equal(view.players.p2.hand, undefined);
    assert.equal(view.players.p2.handCount, 5);
  });

  void it("does not resolve a declared action before the Response window closes", () => {
    const engine = new TempoFrontEngine();
    const state = engine.createGame({
      matchId: "pending",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const entity = putInHand(state, "p1", "entity.linebreaker");
    const declared = engine.applyCommand(state, {
      type: "play_card",
      playerId: "p1",
      instanceId: entity.instanceId,
      front: "center",
      slot: "vanguard",
    }).state;
    assert.equal(declared.pendingAction?.phase, "response");
    assert.equal(declared.fronts.center.slots.p1.vanguard, null);
    const resolved = engine.applyCommand(declared, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(resolved.pendingAction, null);
    assert.equal(
      resolved.fronts.center.slots.p1.vanguard?.instanceId,
      entity.instanceId,
    );
  });

  void it("resolves Deflect before Strike damage", () => {
    const engine = new TempoFrontEngine();
    const state = engine.createGame({
      matchId: "deflect",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const attacker = putInVanguard(state, "p1", "entity.linebreaker");
    const defender = putInVanguard(state, "p2", "entity.ironhide");
    const deflect = putInHand(state, "p2", "reaction.deflect");
    const declared = engine.applyCommand(state, {
      type: "strike",
      playerId: "p1",
      attackerId: attacker.instanceId,
      targetId: defender.instanceId,
    }).state;
    const responded = engine.applyCommand(declared, {
      type: "play_reaction",
      playerId: "p2",
      instanceId: deflect.instanceId,
      targetId: defender.instanceId,
    }).state;
    const resolution = engine.applyCommand(responded, {
      type: "pass_response",
      playerId: "p1",
    });
    const resolved = resolution.state;
    assert.equal(
      defender.instanceId,
      resolved.fronts.center.slots.p2.vanguard?.instanceId,
    );
    assert.equal(resolved.fronts.center.slots.p2.vanguard?.damage, 0);
    assert.equal(resolved.fronts.center.slots.p2.vanguard?.barrier, false);
    assert.equal(resolved.players.p2.time, 1);
    assert.deepEqual(
      resolution.events
        .filter((event) => event.type === "damage_replaced")
        .map((event) => event.replacement),
      ["barrier"],
    );
  });

  void it("applies Armor when no earlier Barrier replacement consumes damage", () => {
    const engine = new TempoFrontEngine();
    const state = engine.createGame({
      matchId: "armor-order",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const attacker = putInVanguard(state, "p1", "entity.linebreaker");
    const defender = putInVanguard(state, "p2", "entity.ironhide");
    const declared = engine.applyCommand(state, {
      type: "strike",
      playerId: "p1",
      attackerId: attacker.instanceId,
      targetId: defender.instanceId,
    }).state;
    const resolution = engine.applyCommand(declared, {
      type: "pass_response",
      playerId: "p2",
    });
    assert.deepEqual(
      resolution.events
        .filter((event) => event.type === "damage_replaced")
        .map((event) => [event.replacement, event.prevented]),
      [["armor", 1]],
    );
    assert.equal(resolution.state.fronts.center.slots.p2.vanguard?.damage, 1);
  });

  void it("suspends Scout for a private card choice and resumes deterministically", () => {
    const engine = new TempoFrontEngine();
    const state = engine.createGame({
      matchId: "scout-choice",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const survey = putInHand(state, "p1", "tactic.survey");
    const declared = engine.applyCommand(state, {
      type: "play_card",
      playerId: "p1",
      instanceId: survey.instanceId,
    }).state;
    const choosing = engine.applyCommand(declared, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(choosing.pendingAction, null);
    assert.equal(choosing.pendingChoice?.kind, "select_card");
    assert.equal(
      choosing.pendingChoice?.kind === "select_card"
        ? choosing.pendingChoice.options.length
        : 0,
      3,
    );
    const ownView = engine.projectView(choosing, "p1");
    const opponentView = engine.projectView(choosing, "p2");
    assert.equal(ownView.pendingChoice?.cardOptions?.length, 3);
    assert.equal(opponentView.pendingChoice?.optionCount, 3);
    assert.equal(opponentView.pendingChoice?.cardOptions, undefined);
    const selectedId = ownView.pendingChoice?.cardOptions?.[1]?.instanceId;
    assert.ok(selectedId);
    const choiceId = choosing.pendingChoice.choiceId;
    const unselectedIds =
      choosing.pendingChoice?.kind === "select_card"
        ? choosing.pendingChoice.options
            .filter((card) => card.instanceId !== selectedId)
            .map((card) => card.instanceId)
        : [];
    const resolved = engine.applyCommand(choosing, {
      type: "resolve_choice",
      playerId: "p1",
      choiceId,
      optionIds: [selectedId],
    }).state;
    assert.equal(resolved.pendingChoice, null);
    assert.ok(
      resolved.players.p1.hand.some((card) => card.instanceId === selectedId),
    );
    assert.deepEqual(
      resolved.players.p1.deck
        .slice(-unselectedIds.length)
        .map((card) => card.instanceId),
      unselectedIds,
    );
  });

  void it("suspends and resumes an optional Focus payment", () => {
    const engine = new TempoFrontEngine();
    const state = engine.createGame({
      matchId: "optional-focus",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    state.players.p1.maxFocus = 4;
    state.players.p1.focus = 4;
    const broodcaller = putInHand(state, "p1", "entity.broodcaller");
    const declared = engine.applyCommand(state, {
      type: "play_card",
      playerId: "p1",
      instanceId: broodcaller.instanceId,
      front: "center",
      slot: "vanguard",
    }).state;
    const choosing = engine.applyCommand(declared, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(choosing.pendingChoice?.kind, "optional_focus");
    assert.equal(choosing.players.p1.focus, 1);
    const resolved = engine.applyCommand(choosing, {
      type: "resolve_choice",
      playerId: "p1",
      choiceId: choosing.pendingChoice.choiceId,
      optionIds: ["pay"],
    }).state;
    assert.equal(resolved.players.p1.focus, 0);
    assert.equal(
      resolved.fronts.center.slots.p1.support?.cardId,
      "token.sprout",
    );
    assert.equal(resolved.pendingChoice, null);
    assert.equal(resolved.effectQueue.length, 0);
  });

  void it("lets Denial cancel a main action", () => {
    const engine = new TempoFrontEngine();
    const state = engine.createGame({
      matchId: "denied",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const attacker = putInVanguard(state, "p1", "entity.linebreaker");
    const denial = putInHand(state, "p2", "reaction.denial");
    const declared = engine.applyCommand(state, {
      type: "strike",
      playerId: "p1",
      attackerId: attacker.instanceId,
      targetId: "leader",
    }).state;
    const responded = engine.applyCommand(declared, {
      type: "play_reaction",
      playerId: "p2",
      instanceId: denial.instanceId,
    }).state;
    const resolved = engine.applyCommand(responded, {
      type: "pass_response",
      playerId: "p1",
    }).state;
    assert.equal(resolved.players.p2.integrity, 20);
    assert.equal(resolved.players.p2.time, 2);
    assert.equal(resolved.pendingAction, null);
  });

  void it("lets a Counter-Response cancel Denial and restore the main action", () => {
    const engine = new TempoFrontEngine();
    const state = engine.createGame({
      matchId: "countered-denial",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const attacker = putInVanguard(state, "p1", "entity.linebreaker");
    const defendingDenial = putInHand(state, "p2", "reaction.denial");
    const counterDenial = putInHand(state, "p1", "reaction.denial");
    const declared = engine.applyCommand(state, {
      type: "strike",
      playerId: "p1",
      attackerId: attacker.instanceId,
      targetId: "leader",
    }).state;
    const responded = engine.applyCommand(declared, {
      type: "play_reaction",
      playerId: "p2",
      instanceId: defendingDenial.instanceId,
    }).state;
    const resolved = engine.applyCommand(responded, {
      type: "play_reaction",
      playerId: "p1",
      instanceId: counterDenial.instanceId,
    }).state;
    assert.equal(resolved.players.p2.integrity, 18);
    assert.equal(resolved.players.p1.time, 5);
    assert.equal(resolved.players.p2.time, 2);
    assert.equal(resolved.effectQueue.length, 0);
  });

  void it("rejects content with an oversized effect list", () => {
    const invalid = new Map(proofCardMap);
    invalid.set("tactic.invalid", {
      cardId: "tactic.invalid",
      revision: 1,
      name: "Invalid Loop Bait",
      type: "tactic",
      aspects: ["neutral"],
      focusCost: 1,
      playTime: 1,
      abilities: [
        {
          abilityId: "too-many-effects",
          type: "activated",
          effects: Array.from({ length: 17 }, () => ({
            op: "draw" as const,
            amount: 1,
          })),
        },
      ],
    });
    assert.throws(() => new TempoFrontEngine(invalid), /exceeds 16 effects/);
  });

  void it("completes and verifies a varied simulation batch", () => {
    const summary = runBatch(100, 1000);
    assert.equal(summary.p1Wins + summary.p2Wins, 100);
    assert.equal(summary.integrityWins + summary.dominionWins, 100);
    assert.ok(summary.averageReactions > 0);
    assert.ok(summary.averageChoices > 0);
  });
});
