import type { PlayerId } from "@cardforge/card-schema";
import {
  nextInt,
  stateHash,
  type Command,
  type GameState,
  type ReplayRecord,
} from "@cardforge/rules-kernel";
import {
  proofContentHash,
  proofDeck,
  replayGame,
  TempoFrontEngine,
  tempoFrontRules,
} from "@cardforge/rules-tempofront";

export interface SimulationResult {
  readonly replay: ReplayRecord;
  readonly finalState: GameState;
  readonly commandCount: number;
}

function activePlayer(state: GameState): PlayerId | null {
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
  const instances = [];
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
    instances.push(...player.deck, ...player.hand, ...player.discard);
  }
  for (const front of Object.values(state.fronts)) {
    for (const slots of Object.values(front.slots)) {
      for (const entity of Object.values(slots))
        if (entity) instances.push(entity);
    }
  }
  const ids = instances.map((instance) => instance.instanceId);
  if (ids.length !== new Set(ids).size)
    throw new Error("A card instance exists in multiple zones");
  for (const instance of instances) {
    if (!Number.isSafeInteger(instance.damage) || instance.damage < 0)
      throw new Error(`Invalid damage on ${instance.instanceId}`);
  }
  if ((state.winner === null) !== (state.victoryReason === null))
    throw new Error("Winner and victory reason disagree");
}

export function simulateGame(
  seed: number,
  engine = new TempoFrontEngine(),
): SimulationResult {
  const decks = { p1: proofDeck, p2: proofDeck } as const;
  let state = engine.createGame({ matchId: `proof-${seed}`, seed, decks });
  const acceptedCommands: Command[] = [];
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
    contentHash: proofContentHash,
    decks,
    acceptedCommands,
    finalStateHash,
  };
  return { replay, finalState: state, commandCount: acceptedCommands.length };
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
  }
  return {
    games,
    p1Wins,
    p2Wins,
    integrityWins,
    dominionWins,
    averageCycles: Number((cycles / games).toFixed(2)),
    averageCommands: Number((commands / games).toFixed(2)),
  };
}
