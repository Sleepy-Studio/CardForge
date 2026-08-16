import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import type { PlayerId } from "@cardforge/card-schema";
import {
  stateHash,
  type CardInstance,
  type GameState,
} from "@cardforge/rules-kernel";
import {
  proofCardMap,
  proofDeck,
  proofFormat,
  generateRulesText,
  prototypeDecks,
  prototypeLeaderOptions,
  prototypeCards,
  TempoFrontEngine,
  validateDeck,
} from "@cardforge/rules-tempofront";
import {
  runArchetypeMatrix,
  runBatch,
  simulateGame,
  verifyReplay,
} from "./simulation.js";

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

function createPlayingGame(
  engine: TempoFrontEngine,
  input: Parameters<TempoFrontEngine["createGame"]>[0],
): GameState {
  let state = engine.createGame(input);
  state = engine.applyCommand(state, {
    type: "mulligan",
    playerId: "p1",
    instanceIds: [],
  }).state;
  return engine.applyCommand(state, {
    type: "mulligan",
    playerId: "p2",
    instanceIds: [],
  }).state;
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

  void it("preserves canonical SHA-256 across Node and browser runtimes", () => {
    assert.equal(
      stateHash({ b: 2, a: 1 }),
      "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
  });

  void it("instantiates cards from the selected content pack rather than the proof globals", () => {
    const cards = new Map(proofCardMap);
    cards.set("entity.linebreaker", {
      ...cards.get("entity.linebreaker")!,
      revision: 2,
      power: 7,
    });
    const engine = new TempoFrontEngine(cards);
    const state = engine.createGame({
      matchId: "custom-content",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const instances = [
      ...state.players.p1.hand,
      ...state.players.p1.deck,
    ].filter((card) => card.cardId === "entity.linebreaker");
    assert.ok(instances.length > 0);
    assert.ok(instances.every((card) => card.revision === 2));
    assert.notEqual(state.contentHash, new TempoFrontEngine().contentHash);
  });

  void it("replays a complete match to the exact final hash", () => {
    const result = simulateGame(8675309);
    assert.notEqual(result.finalState.winner, null);
    assert.doesNotThrow(() => verifyReplay(result));
  });

  void it("keeps hidden hands out of opponent projections", () => {
    const engine = new TempoFrontEngine();
    const state = createPlayingGame(engine, {
      matchId: "views",
      seed: 7,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const view = engine.projectView(state, "p1");
    assert.equal(view.players.p1.hand?.length, 5);
    assert.equal(view.players.p2.hand, undefined);
    assert.equal(view.players.p2.handCount, 5);
  });

  void it("holds mulliganed cards out until replacements are drawn", () => {
    const engine = new TempoFrontEngine();
    let state = engine.createGame({
      matchId: "mulligan",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const replacedIds = state.players.p1.hand
      .slice(0, 2)
      .map((card) => card.instanceId);
    state = engine.applyCommand(state, {
      type: "mulligan",
      playerId: "p1",
      instanceIds: replacedIds,
    }).state;
    assert.equal(state.phase, "mulligan");
    assert.equal(state.players.p1.hand.length, 5);
    assert.ok(
      replacedIds.every(
        (id) => !state.players.p1.hand.some((card) => card.instanceId === id),
      ),
    );
    assert.equal(engine.getLegalCommands(state, "p1").length, 0);
    assert.equal(engine.getLegalCommands(state, "p2").length, 32);
    state = engine.applyCommand(state, {
      type: "mulligan",
      playerId: "p2",
      instanceIds: [],
    }).state;
    assert.equal(state.phase, "playing");
  });

  void it("validates deck size, copy limits, generated cards, and Entity count", () => {
    assert.deepEqual(validateDeck(proofDeck), []);
    const illegalCopies = Array.from(
      { length: 40 },
      () => "entity.linebreaker",
    );
    assert.match(validateDeck(illegalCopies).join("; "), /maximum is 3/);
    const generated = [...proofDeck];
    generated[0] = "token.sprout";
    assert.match(validateDeck(generated).join("; "), /not legal in a deck/);
    const noEntities = Array.from({ length: 40 }, (_, index) =>
      index % 2 === 0 ? "tactic.survey" : "reaction.deflect",
    );
    assert.match(validateDeck(noEntities).join("; "), /at least 12 Entities/);
  });

  void it("validates all twelve competitive Leader decks against their identities", () => {
    for (const leader of prototypeLeaderOptions) {
      const deck = prototypeDecks[leader.cardId];
      assert.equal(deck.length, 40);
      assert.deepEqual(
        validateDeck(deck, proofCardMap, proofFormat, {
          leaderCardId: leader.cardId,
        }),
        [],
        leader.cardId,
      );
      assert.doesNotThrow(() =>
        new TempoFrontEngine().createGame({
          matchId: `starter-${leader.cardId}`,
          seed: 42,
          decks: { p1: deck, p2: deck },
          leaders: { p1: leader.cardId, p2: leader.cardId },
        }),
      );
    }
  });

  void it("publishes an exact 120-card competitive-beta pool", () => {
    assert.equal(prototypeCards.length, 120);
    assert.equal(
      new Set(prototypeCards.map((card) => card.cardId)).size,
      prototypeCards.length,
    );
    assert.ok(
      prototypeCards.every(
        (card) => card.cardId !== "leader.proof" && !card.generatedOnly,
      ),
    );
    const counts = Object.fromEntries(
      [
        "leader",
        "entity",
        "tactic",
        "reaction",
        "attachment",
        "relic",
        "site",
      ].map((type) => [
        type,
        prototypeCards.filter((card) => card.type === type).length,
      ]),
    );
    assert.deepEqual(counts, {
      leader: 12,
      entity: 61,
      tactic: 21,
      reaction: 11,
      attachment: 6,
      relic: 6,
      site: 3,
    });
  });

  void it("completes and replays a match for every prototype Leader", () => {
    const engine = new TempoFrontEngine();
    for (const [index, leader] of prototypeLeaderOptions.entries()) {
      const opponent =
        prototypeLeaderOptions[(index + 1) % prototypeLeaderOptions.length]!;
      const result = simulateGame(9001 + index, engine, {
        matchIdPrefix: "prototype",
        decks: {
          p1: prototypeDecks[leader.cardId],
          p2: prototypeDecks[opponent.cardId],
        },
        leaders: { p1: leader.cardId, p2: opponent.cardId },
      });
      assert.notEqual(result.finalState.winner, null);
      assert.doesNotThrow(() => verifyReplay(result, engine));
    }
  });

  void it("seat-swaps every archetype in a replay-verified matchup matrix", () => {
    const matrix = runArchetypeMatrix(1, 70_000);
    assert.equal(matrix.games, 144);
    assert.equal(matrix.matchups.length, 78);
    assert.equal(matrix.leaders.length, 12);
    assert.equal(
      matrix.leaders.reduce((total, leader) => total + leader.matches, 0),
      matrix.games * 2,
    );
    assert.equal(matrix.integrityWins + matrix.dominionWins, matrix.games);
  });

  void it("validates sets, bans, Leader Aspects, and Leader restrictions", () => {
    const cards = new Map(
      [...proofCardMap].map(([cardId, card]) => [
        cardId,
        { ...card, setId: "proof-core" },
      ]),
    );
    const restrictedLeader = {
      ...cards.get("leader.vanguard")!,
      deckRestriction: { requiredSubtype: "structure", minimum: 4 },
    };
    cards.set("leader.vanguard", restrictedLeader);
    const format = {
      ...proofFormat,
      legalSetIds: ["proof-core"],
      bannedCardIds: ["tactic.survey"],
    };
    const errors = validateDeck(proofDeck, cards, format, {
      leaderCardId: "leader.vanguard",
    }).join("; ");
    assert.match(errors, /tactic\.survey is banned/);
    assert.match(errors, /outside leader\.vanguard's Aspect identity/);
    assert.match(errors, /requires at least 4 structure cards/);
    const wrongSetCards = new Map(cards);
    wrongSetCards.set("entity.linebreaker", {
      ...wrongSetCards.get("entity.linebreaker")!,
      setId: "rotated-set",
    });
    assert.match(
      validateDeck(proofDeck, wrongSetCards, format).join("; "),
      /entity\.linebreaker is not from a legal set/,
    );
  });

  void it("does not resolve a declared action before the Response window closes", () => {
    const engine = new TempoFrontEngine();
    const state = createPlayingGame(engine, {
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
    const state = createPlayingGame(engine, {
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
    const state = createPlayingGame(engine, {
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
    const state = createPlayingGame(engine, {
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
    const state = createPlayingGame(engine, {
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
    const state = createPlayingGame(engine, {
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
    const state = createPlayingGame(engine, {
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

  void it("applies and refreshes structured statuses", () => {
    const engine = new TempoFrontEngine();
    const state = createPlayingGame(engine, {
      matchId: "status",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const target = putInVanguard(state, "p2", "entity.linebreaker");
    const stagger = putInHand(state, "p1", "tactic.stagger");
    let next = engine.applyCommand(state, {
      type: "play_card",
      playerId: "p1",
      instanceId: stagger.instanceId,
      targetId: target.instanceId,
    }).state;
    next = engine.applyCommand(next, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(
      target.instanceId,
      next.fronts.center.slots.p2.vanguard?.instanceId,
    );
    assert.equal(
      next.fronts.center.slots.p2.vanguard?.statuses[0]?.statusId,
      "stunned",
    );
    assert.ok(
      engine
        .getLegalCommands(next, "p2")
        .every(
          (command) =>
            command.type !== "strike" ||
            command.attackerId !== target.instanceId,
        ),
    );
    next = engine.applyCommand(next, { type: "pass", playerId: "p2" }).state;
    next = engine.applyCommand(next, { type: "pass", playerId: "p1" }).state;
    assert.equal(next.fronts.center.slots.p2.vanguard?.statuses.length, 0);
  });

  void it("enforces Rooted, Silenced, Exposed, and Protected semantics", () => {
    const engine = new TempoFrontEngine();
    let state = createPlayingGame(engine, {
      matchId: "status-semantics",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const attacker = putInVanguard(state, "p1", "entity.linebreaker");
    const defender = putInVanguard(state, "p2", "entity.ironhide");
    attacker.statuses.push({
      statusId: "rooted",
      sourceId: "test",
      value: 1,
      duration: "until_refresh",
      stackingPolicy: "refresh",
    });
    defender.statuses.push(
      {
        statusId: "exposed",
        sourceId: "test",
        value: 2,
        duration: "persistent",
        stackingPolicy: "highest",
      },
      {
        statusId: "protected",
        sourceId: "test",
        value: 1,
        duration: "persistent",
        stackingPolicy: "highest",
      },
    );
    assert.ok(
      engine
        .getLegalCommands(state, "p1")
        .every(
          (command) =>
            command.type !== "shift" ||
            command.entityId !== attacker.instanceId,
        ),
    );
    state = engine.applyCommand(state, {
      type: "strike",
      playerId: "p1",
      attackerId: attacker.instanceId,
      targetId: defender.instanceId,
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.fronts.center.slots.p2.vanguard?.damage, 2);
    assert.equal(state.fronts.center.slots.p2.vanguard?.statuses.length, 0);

    state = createPlayingGame(engine, {
      matchId: "silence-semantics",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const secondAttacker = putInVanguard(state, "p1", "entity.linebreaker");
    const silencedDefender = putInVanguard(state, "p2", "entity.ironhide");
    silencedDefender.statuses.push({
      statusId: "silenced",
      sourceId: "test",
      value: 1,
      duration: "persistent",
      stackingPolicy: "refresh",
    });
    state = engine.applyCommand(state, {
      type: "strike",
      playerId: "p1",
      attackerId: secondAttacker.instanceId,
      targetId: silencedDefender.instanceId,
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.fronts.center.slots.p2.vanguard?.damage, 2);
  });

  void it("plays Attachments, Relics, Sites, and prepared cards into real zones", () => {
    const engine = new TempoFrontEngine();
    let state = createPlayingGame(engine, {
      matchId: "persistent-zones",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const host = putInVanguard(state, "p1", "entity.linebreaker");
    const edge = putInHand(state, "p1", "attachment.edge");
    state = engine.applyCommand(state, {
      type: "play_card",
      playerId: "p1",
      instanceId: edge.instanceId,
      targetId: host.instanceId,
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(
      state.fronts.center.slots.p1.vanguard?.attachments[0]?.cardId,
      "attachment.edge",
    );
    state.players.p2.passed = true;
    state.players.p1.time = 0;
    state = engine.applyCommand(state, {
      type: "strike",
      playerId: "p1",
      attackerId: host.instanceId,
      targetId: "leader",
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.players.p2.integrity, 17);

    state = createPlayingGame(engine, {
      matchId: "relic-zone",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const beacon = putInHand(state, "p1", "relic.beacon");
    state = engine.applyCommand(state, {
      type: "play_card",
      playerId: "p1",
      instanceId: beacon.instanceId,
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.players.p1.relics[0]?.instanceId, beacon.instanceId);
    state.players.p2.passed = true;
    state.players.p1.time = 0;
    state = engine.applyCommand(state, {
      type: "activate_ability",
      playerId: "p1",
      sourceId: beacon.instanceId,
      abilityId: "beacon",
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.pendingChoice?.kind, "select_card");

    state = createPlayingGame(engine, {
      matchId: "site-zone",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    putInVanguard(state, "p1", "entity.linebreaker");
    const site = putInHand(state, "p1", "site.overlook");
    state = engine.applyCommand(state, {
      type: "play_card",
      playerId: "p1",
      instanceId: site.instanceId,
      front: "left",
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.fronts.left.site?.instanceId, site.instanceId);
    state = engine.applyCommand(state, { type: "pass", playerId: "p2" }).state;
    const cycleResult = engine.applyCommand(state, {
      type: "pass",
      playerId: "p1",
    });
    state = cycleResult.state;
    const controlEvents = cycleResult.events.filter(
      (event) => event.type === "front_control_resolved",
    );
    assert.equal(controlEvents.length, 3);
    assert.equal(
      controlEvents.find((event) => event.front === "left")?.controllerId,
      "p1",
    );
    assert.equal(state.players.p1.dominion, 1);

    state = createPlayingGame(engine, {
      matchId: "reserve-zone",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const survey = putInHand(state, "p1", "tactic.survey");
    state = engine.applyCommand(state, {
      type: "prepare_card",
      playerId: "p1",
      instanceId: survey.instanceId,
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.players.p1.reserve?.instanceId, survey.instanceId);
    assert.equal(state.players.p1.focus, 3);
    assert.equal(engine.projectView(state, "p1").players.p1.reserveCount, 1);
    assert.equal(engine.projectView(state, "p2").players.p1.reserveCount, 1);
    assert.equal(engine.projectView(state, "p2").players.p1.reserve, undefined);
    state.players.p2.passed = true;
    state.players.p1.time = 0;
    state = engine.applyCommand(state, {
      type: "play_card",
      playerId: "p1",
      instanceId: survey.instanceId,
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.players.p1.focus, 3);
    assert.equal(state.pendingChoice?.kind, "select_card");
  });

  void it("runs Leader Commands through the normal bounded response pipeline", () => {
    const engine = new TempoFrontEngine();
    let state = createPlayingGame(engine, {
      matchId: "leader-command",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    state = engine.applyCommand(state, {
      type: "activate_ability",
      playerId: "p1",
      sourceId: "p1-leader",
      abilityId: "marshal-command",
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.players.p2.integrity, 19);
    assert.equal(state.players.p1.focus, 2);
    assert.equal(state.players.p1.time, 2);
    assert.deepEqual(state.players.p1.leader.usedAbilityIds, [
      "marshal-command",
    ]);
  });

  void it("executes the Relay Leader's draw Command", () => {
    const engine = new TempoFrontEngine();
    const deck = prototypeDecks["leader.relay"];
    let state = createPlayingGame(engine, {
      matchId: "relay-leader-command",
      seed: 42,
      decks: { p1: deck, p2: deck },
      leaders: { p1: "leader.relay", p2: "leader.relay" },
    });
    const handBefore = state.players.p1.hand.length;
    const deckBefore = state.players.p1.deck.length;
    state = engine.applyCommand(state, {
      type: "activate_ability",
      playerId: "p1",
      sourceId: "p1-leader",
      abilityId: "vector-command",
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.players.p1.hand.length, handBefore + 1);
    assert.equal(state.players.p1.deck.length, deckBefore - 1);
  });

  void it("executes the Rootbound Leader's recovery Command", () => {
    const engine = new TempoFrontEngine();
    const deck = prototypeDecks["leader.rootbound"];
    let state = createPlayingGame(engine, {
      matchId: "rootbound-leader-command",
      seed: 42,
      decks: { p1: deck, p2: deck },
      leaders: { p1: "leader.rootbound", p2: "leader.rootbound" },
    });
    state.players.p1.integrity = 15;
    state = engine.applyCommand(state, {
      type: "activate_ability",
      playerId: "p1",
      sourceId: "p1-leader",
      abilityId: "renew-command",
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.players.p1.integrity, 17);
  });

  void it("executes the Skydancer Leader's private Scout Command", () => {
    const engine = new TempoFrontEngine();
    const deck = prototypeDecks["leader.skydancer"];
    let state = createPlayingGame(engine, {
      matchId: "skydancer-leader-command",
      seed: 42,
      decks: { p1: deck, p2: deck },
      leaders: { p1: "leader.skydancer", p2: "leader.skydancer" },
    });
    state = engine.applyCommand(state, {
      type: "activate_ability",
      playerId: "p1",
      sourceId: "p1-leader",
      abilityId: "survey-command",
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.pendingChoice?.kind, "select_card");
    assert.equal(state.pendingChoice?.options.length, 2);
    assert.equal(
      engine.projectView(state, "p2").pendingChoice?.cardOptions,
      undefined,
    );
  });

  void it("resolves modal and multi-target effects from replayed choices", () => {
    const engine = new TempoFrontEngine();
    let state = createPlayingGame(engine, {
      matchId: "modal",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    state.players.p1.integrity = 15;
    const adapt = putInHand(state, "p1", "tactic.adapt");
    state = engine.applyCommand(state, {
      type: "play_card",
      playerId: "p1",
      instanceId: adapt.instanceId,
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.pendingChoice?.kind, "choose_one");
    state = engine.applyCommand(state, {
      type: "resolve_choice",
      playerId: "p1",
      choiceId: state.pendingChoice.choiceId,
      optionIds: ["recover"],
    }).state;
    assert.equal(state.players.p1.integrity, 17);

    state = createPlayingGame(engine, {
      matchId: "multi-target",
      seed: 42,
      decks: { p1: proofDeck, p2: proofDeck },
    });
    const first = putInVanguard(state, "p2", "entity.ironhide");
    const second = takeCard(state, "p2", "entity.aegis");
    second.ready = true;
    second.barrier = true;
    state.fronts.center.slots.p2.support = second;
    const crossfire = putInHand(state, "p1", "tactic.crossfire");
    state = engine.applyCommand(state, {
      type: "play_card",
      playerId: "p1",
      instanceId: crossfire.instanceId,
      targetIds: [first.instanceId, second.instanceId],
    }).state;
    state = engine.applyCommand(state, {
      type: "pass_response",
      playerId: "p2",
    }).state;
    assert.equal(state.fronts.center.slots.p2.vanguard?.damage, 1);
    assert.equal(state.fronts.center.slots.p2.support?.damage, 0);
    assert.equal(state.fronts.center.slots.p2.support?.barrier, false);
  });

  void it("validates deterministic release windows without consulting system time", () => {
    const cards = new Map(proofCardMap);
    cards.set("entity.linebreaker", {
      ...cards.get("entity.linebreaker")!,
      release: {
        state: "published",
        availableFrom: "2026-09-01",
        availableUntil: "2026-12-31",
      },
    });
    const deck = Array.from({ length: 40 }, (_, index) =>
      index === 0 ? "entity.linebreaker" : proofDeck[index]!,
    );
    const format = {
      ...proofFormat,
      allowedReleaseStates: ["published" as const],
      effectiveDate: "2026-08-16",
    };
    assert.match(validateDeck(deck, cards, format).join("; "), /not released/);
    assert.doesNotMatch(
      validateDeck(deck, cards, {
        ...format,
        effectiveDate: "2026-10-01",
      }).join("; "),
      /not released|rotated/,
    );
  });

  void it("generates localized rules text from the authoritative ability graph", () => {
    const text = generateRulesText(proofCardMap.get("leader.vanguard")!, {
      focus: "Power",
      leader: "Commander",
    });
    assert.match(text, /Command/);
    assert.match(text, /enemy Commander/);
    assert.match(text, /Once each Cycle/);
  });

  void it("survives replay serialization and property-checks varied seeds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const result = simulateGame(seed);
        const serialized = JSON.stringify(result.replay);
        const replay = JSON.parse(serialized) as typeof result.replay;
        assert.doesNotThrow(() =>
          verifyReplay({ ...result, replay }, new TempoFrontEngine()),
        );
      }),
      { numRuns: 25 },
    );
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
