import type { PlayerId } from "@cardforge/card-schema";
import {
  nextInt,
  stateHash,
  type CardInstance,
  type Command,
  type GameState,
  type ReplayRecord,
} from "@cardforge/rules-kernel";
import {
  proofDeck,
  proofLeaders,
  replayGame,
  TempoFrontEngine,
  tempoFrontRules,
  prototypeDecks,
  prototypeLeaderOptions,
} from "@cardforge/rules-tempofront";

export interface SimulationResult {
  readonly replay: ReplayRecord;
  readonly finalState: GameState;
  readonly commandCount: number;
  readonly reactionCount: number;
  readonly choiceCount: number;
  readonly mulliganedCount: number;
  readonly startingInitiative: PlayerId;
}

export interface SimulationSetup {
  readonly decks: Readonly<Record<PlayerId, readonly string[]>>;
  readonly leaders: Readonly<Record<PlayerId, string>>;
  readonly matchIdPrefix?: string;
}

function activePlayer(state: GameState): PlayerId | null {
  if (state.phase === "mulligan")
    return state.players.p1.mulliganSubmitted ? "p2" : "p1";
  if (state.pendingChoice) return state.pendingChoice.chooserId;
  if (state.pendingAction)
    return state.pendingAction.phase === "response"
      ? state.pendingAction.actorId === "p1"
        ? "p2"
        : "p1"
      : state.pendingAction.actorId;
  const available = (["p1", "p2"] as const).filter(
    (playerId) =>
      !state.players[playerId].passed &&
      state.players[playerId].time < tempoFrontRules.timelineLength,
  );
  if (available.length === 0) return null;
  if (available.length === 1) return available[0]!;
  const [first, second] = available;
  if (state.players[first!].time === state.players[second!].time)
    return state.initiative;
  return state.players[first!].time < state.players[second!].time
    ? first!
    : second!;
}

function chooseCommand(
  commands: readonly Command[],
  botRng: { seed: number; index: number },
): Command {
  const mulligans = commands.filter((command) => command.type === "mulligan");
  if (mulligans.length > 0)
    return mulligans[nextInt(botRng, mulligans.length)]!;
  const choices = commands.filter(
    (command) => command.type === "resolve_choice",
  );
  if (choices.length > 0) return choices[nextInt(botRng, choices.length)]!;
  const responsePass = commands.find(
    (command) => command.type === "pass_response",
  );
  if (responsePass) {
    const reactions = commands.filter(
      (command) => command.type === "play_reaction",
    );
    if (reactions.length > 0 && nextInt(botRng, 100) < 55)
      return reactions[nextInt(botRng, reactions.length)]!;
    return responsePass;
  }
  const nonPass = commands.filter((command) => command.type !== "pass");
  const strikesToLeader = nonPass.filter(
    (command) => command.type === "strike" && command.targetId === "leader",
  );
  if (strikesToLeader.length > 0 && nextInt(botRng, 100) < 80)
    return strikesToLeader[nextInt(botRng, strikesToLeader.length)]!;
  const plays = nonPass.filter((command) => command.type === "play_card");
  if (plays.length > 0 && nextInt(botRng, 100) < 65)
    return plays[nextInt(botRng, plays.length)]!;
  const strikes = nonPass.filter((command) => command.type === "strike");
  if (strikes.length > 0 && nextInt(botRng, 100) < 75)
    return strikes[nextInt(botRng, strikes.length)]!;
  if (nonPass.length > 0 && nextInt(botRng, 100) < 70)
    return nonPass[nextInt(botRng, nonPass.length)]!;
  return commands.find((command) => command.type === "pass")!;
}

export function assertGameInvariants(state: GameState): void {
  const instances: CardInstance[] = [];
  const addInstance = (instance: CardInstance): void => {
    instances.push(instance);
    for (const attachment of instance.attachments) addInstance(attachment);
  };
  for (const player of Object.values(state.players)) {
    for (const value of [
      player.integrity,
      player.maxFocus,
      player.focus,
      player.time,
      player.dominion,
      player.fatigue,
    ]) {
      if (!Number.isSafeInteger(value))
        throw new Error(`Non-integer game value in ${player.playerId}`);
    }
    if (player.focus < 0 || player.focus > player.maxFocus)
      throw new Error(`Invalid Focus for ${player.playerId}`);
    if (player.maxFocus < 3 || player.maxFocus > 8)
      throw new Error(`Invalid maximum Focus for ${player.playerId}`);
    if (player.dominion < 0 || player.dominion > 6)
      throw new Error(`Invalid Dominion for ${player.playerId}`);
    addInstance(player.leader);
    for (const card of [
      ...player.deck,
      ...player.hand,
      ...player.discard,
      ...player.relics,
    ])
      addInstance(card);
    if (player.reserve) addInstance(player.reserve);
  }
  for (const front of Object.values(state.fronts)) {
    if (front.site) addInstance(front.site);
    for (const slots of Object.values(front.slots)) {
      for (const entity of Object.values(slots))
        if (entity) addInstance(entity);
    }
  }
  if (state.pendingAction?.committedCard)
    addInstance(state.pendingAction.committedCard);
  if (state.pendingAction?.response)
    addInstance(state.pendingAction.response.card);
  if (state.pendingAction?.counterResponse)
    addInstance(state.pendingAction.counterResponse.card);
  if (state.pendingChoice?.kind === "select_card")
    for (const card of state.pendingChoice.options) addInstance(card);
  const ids = instances.map((instance) => instance.instanceId);
  if (ids.length !== new Set(ids).size)
    throw new Error("A card instance exists in multiple zones");
  for (const instance of instances) {
    if (!Number.isSafeInteger(instance.damage) || instance.damage < 0)
      throw new Error(`Invalid damage on ${instance.instanceId}`);
    for (const status of instance.statuses)
      if (!Number.isSafeInteger(status.value) || status.value <= 0)
        throw new Error(`Invalid status value on ${instance.instanceId}`);
  }
  if ((state.winner === null) !== (state.victoryReason === null))
    throw new Error("Winner and victory reason disagree");
  if (
    state.phase === "playing" &&
    (!state.players.p1.mulliganSubmitted || !state.players.p2.mulliganSubmitted)
  )
    throw new Error("Playing phase began before both mulligans completed");
  if (state.effectQueue.length > 0 && !state.pendingChoice)
    throw new Error("Effect queue leaked across a command boundary");
  if (state.effectQueue.length > 64)
    throw new Error("Effect queue exceeded its runtime bound");
  if (state.pendingAction && state.pendingChoice)
    throw new Error("Action and choice priority are simultaneously pending");
  if (
    state.pendingAction?.phase === "response" &&
    (state.pendingAction.response || state.pendingAction.counterResponse)
  )
    throw new Error("Response chain contains cards before its first window");
  if (
    state.pendingAction?.phase === "counter_response" &&
    !state.pendingAction.response
  )
    throw new Error("Counter-Response window has no defending Response");
}

export function simulateGame(
  seed: number,
  engine = new TempoFrontEngine(),
  setup: SimulationSetup = {
    decks: { p1: proofDeck, p2: proofDeck },
    leaders: proofLeaders,
  },
): SimulationResult {
  const { decks, leaders } = setup;
  let state = engine.createGame({
    matchId: `${setup.matchIdPrefix ?? "proof"}-${seed}`,
    seed,
    decks,
    leaders,
  });
  const startingInitiative = state.initiative;
  const acceptedCommands: Command[] = [];
  let reactionCount = 0;
  let choiceCount = 0;
  let mulliganedCount = 0;
  const botRng = { seed: (seed ^ 0xa5a5a5a5) >>> 0, index: 0 };
  assertGameInvariants(state);
  while (!state.winner) {
    if (acceptedCommands.length >= 1_000)
      throw new Error(`Simulation ${seed} exceeded the command safety cap`);
    const playerId = activePlayer(state);
    if (!playerId)
      throw new Error(
        `Simulation ${seed} has no active player outside cycle resolution`,
      );
    const legal = engine.getLegalCommands(state, playerId);
    if (legal.length === 0)
      throw new Error(
        `Simulation ${seed} has no legal commands for ${playerId}`,
      );
    const command = chooseCommand(legal, botRng);
    if (command.type === "play_reaction") reactionCount += 1;
    if (command.type === "resolve_choice") choiceCount += 1;
    if (command.type === "mulligan")
      mulliganedCount += command.instanceIds.length;
    const result = engine.applyCommand(state, command);
    state = result.state;
    acceptedCommands.push(command);
    assertGameInvariants(state);
  }
  const finalStateHash = stateHash(state);
  const replay: ReplayRecord = {
    replayVersion: 1,
    matchId: state.matchId,
    seed,
    rulesetRevision: tempoFrontRules.revision,
    formatId: state.formatId,
    formatRevision: state.formatRevision,
    contentHash: state.contentHash,
    decks,
    leaders,
    acceptedCommands,
    finalStateHash,
  };
  return {
    replay,
    finalState: state,
    commandCount: acceptedCommands.length,
    reactionCount,
    choiceCount,
    mulliganedCount,
    startingInitiative,
  };
}

export interface ArchetypeMetric {
  readonly leaderId: string;
  readonly matches: number;
  readonly wins: number;
  readonly winRate: number;
}

export interface MatchupMetric {
  readonly p1LeaderId: string;
  readonly p2LeaderId: string;
  readonly games: number;
  readonly p1Wins: number;
  readonly p2Wins: number;
}

export interface ArchetypeMatrixSummary {
  readonly games: number;
  readonly gamesPerSeat: number;
  readonly initiativeWins: number;
  readonly initiativeWinRate: number;
  readonly integrityWins: number;
  readonly dominionWins: number;
  readonly averageCycles: number;
  readonly leaders: readonly ArchetypeMetric[];
  readonly matchups: readonly MatchupMetric[];
}

export function runArchetypeMatrix(
  gamesPerSeat: number,
  startingSeed: number,
): ArchetypeMatrixSummary {
  if (!Number.isSafeInteger(gamesPerSeat) || gamesPerSeat <= 0)
    throw new Error("Games per seat must be a positive integer");
  const engine = new TempoFrontEngine();
  const leaderStats = new Map<string, { matches: number; wins: number }>();
  const matchups: MatchupMetric[] = [];
  let nextSeed = startingSeed >>> 0;
  let initiativeWins = 0;
  let integrityWins = 0;
  let dominionWins = 0;
  let cycles = 0;
  let games = 0;
  const record = (
    p1LeaderId: keyof typeof prototypeDecks,
    p2LeaderId: keyof typeof prototypeDecks,
  ): { p1Wins: number; p2Wins: number } => {
    let p1Wins = 0;
    let p2Wins = 0;
    for (let index = 0; index < gamesPerSeat; index += 1) {
      const result = simulateGame(nextSeed, engine, {
        matchIdPrefix: "matrix",
        decks: {
          p1: prototypeDecks[p1LeaderId],
          p2: prototypeDecks[p2LeaderId],
        },
        leaders: { p1: p1LeaderId, p2: p2LeaderId },
      });
      nextSeed = (nextSeed + 1) >>> 0;
      verifyReplay(result, engine);
      const winner = result.finalState.winner!;
      if (winner === "p1") p1Wins += 1;
      else p2Wins += 1;
      if (winner === result.startingInitiative) initiativeWins += 1;
      if (result.finalState.victoryReason === "integrity") integrityWins += 1;
      else dominionWins += 1;
      cycles += result.finalState.cycle;
      games += 1;
      for (const [playerId, leaderId] of [
        ["p1", p1LeaderId],
        ["p2", p2LeaderId],
      ] as const) {
        const row = leaderStats.get(leaderId) ?? { matches: 0, wins: 0 };
        row.matches += 1;
        if (winner === playerId) row.wins += 1;
        leaderStats.set(leaderId, row);
      }
    }
    return { p1Wins, p2Wins };
  };

  const ids = prototypeLeaderOptions.map((leader) => leader.cardId);
  for (const [leftIndex, left] of ids.entries())
    for (const [rightIndex, right] of ids.entries()) {
      if (rightIndex < leftIndex) continue;
      const forward = record(left, right);
      let reverse = { p1Wins: 0, p2Wins: 0 };
      if (left !== right) reverse = record(right, left);
      matchups.push({
        p1LeaderId: left,
        p2LeaderId: right,
        games: (left === right ? 1 : 2) * gamesPerSeat,
        p1Wins: forward.p1Wins + reverse.p2Wins,
        p2Wins: forward.p2Wins + reverse.p1Wins,
      });
    }

  const rate = (value: number) => Number(value.toFixed(4));
  return {
    games,
    gamesPerSeat,
    initiativeWins,
    initiativeWinRate: rate(initiativeWins / games),
    integrityWins,
    dominionWins,
    averageCycles: Number((cycles / games).toFixed(2)),
    leaders: [...leaderStats.entries()]
      .map(([leaderId, row]) => ({
        leaderId,
        ...row,
        winRate: rate(row.wins / row.matches),
      }))
      .sort((left, right) => left.leaderId.localeCompare(right.leaderId)),
    matchups,
  };
}

export function verifyReplay(
  result: SimulationResult,
  engine = new TempoFrontEngine(),
): void {
  const replayed = replayGame(engine, result.replay);
  const replayedHash = stateHash(replayed);
  if (replayedHash !== result.replay.finalStateHash) {
    throw new Error(
      `Replay mismatch for seed ${result.replay.seed}: expected ${result.replay.finalStateHash}, received ${replayedHash}`,
    );
  }
}

export interface BatchSummary {
  readonly games: number;
  readonly p1Wins: number;
  readonly p2Wins: number;
  readonly integrityWins: number;
  readonly dominionWins: number;
  readonly averageCycles: number;
  readonly averageCommands: number;
  readonly averageReactions: number;
  readonly averageChoices: number;
  readonly averageMulliganed: number;
}

export function runBatch(games: number, startingSeed: number): BatchSummary {
  if (!Number.isSafeInteger(games) || games <= 0)
    throw new Error("Games must be a positive integer");
  let p1Wins = 0;
  let p2Wins = 0;
  let integrityWins = 0;
  let dominionWins = 0;
  let cycles = 0;
  let commands = 0;
  let reactions = 0;
  let choices = 0;
  let mulliganed = 0;
  const engine = new TempoFrontEngine();
  for (let offset = 0; offset < games; offset += 1) {
    const result = simulateGame((startingSeed + offset) >>> 0, engine);
    verifyReplay(result, engine);
    if (result.finalState.winner === "p1") p1Wins += 1;
    else p2Wins += 1;
    if (result.finalState.victoryReason === "integrity") integrityWins += 1;
    else dominionWins += 1;
    cycles += result.finalState.cycle;
    commands += result.commandCount;
    reactions += result.reactionCount;
    choices += result.choiceCount;
    mulliganed += result.mulliganedCount;
  }
  return {
    games,
    p1Wins,
    p2Wins,
    integrityWins,
    dominionWins,
    averageCycles: Number((cycles / games).toFixed(2)),
    averageCommands: Number((commands / games).toFixed(2)),
    averageReactions: Number((reactions / games).toFixed(2)),
    averageChoices: Number((choices / games).toFixed(2)),
    averageMulliganed: Number((mulliganed / games).toFixed(2)),
  };
}
