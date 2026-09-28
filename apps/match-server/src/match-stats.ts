import type { PlayerId } from "@cardforge/card-schema";
import type {
  CardInstance,
  GameState,
  ReplayRecord,
} from "@cardforge/rules-kernel";
import type { ParticipantStats } from "@cardforge/persistence";
import { TempoFrontEngine } from "@cardforge/rules-tempofront";

/** Live connection and timing facts the room observes outside GameState. */
export interface SeatActivity {
  actions: number;
  actionMsTotal: number;
  disconnects: number;
  reconnects: number;
  timeouts: number;
  queueWaitMs: number;
}

export function emptyActivity(): SeatActivity {
  return {
    actions: 0,
    actionMsTotal: 0,
    disconnects: 0,
    reconnects: 0,
    timeouts: 0,
    queueWaitMs: 0,
  };
}

function findCardId(
  state: GameState,
  playerId: PlayerId,
  instanceId: string,
): string | null {
  const player = state.players[playerId];
  const pools: (CardInstance | null)[] = [
    ...player.hand,
    player.reserve,
    ...player.relics,
    player.leader,
  ];
  return pools.find((card) => card?.instanceId === instanceId)?.cardId ?? null;
}

/**
 * Derives per-seat statistics by re-running the accepted commands through the
 * production engine. Nothing here is client-reported.
 */
export function participantStats(
  replay: ReplayRecord,
  activity: Readonly<Record<PlayerId, SeatActivity>>,
  engine = new TempoFrontEngine(),
): Record<PlayerId, ParticipantStats & { readonly queueWaitMs: number }> {
  let state = engine.createGame({
    matchId: replay.matchId,
    seed: replay.seed,
    decks: replay.decks,
    ...(replay.leaders === undefined ? {} : { leaders: replay.leaders }),
    ...(replay.setup === undefined ? {} : { setup: replay.setup }),
  });
  const openingDeck = {
    p1: state.players.p1.deck.length + state.players.p1.hand.length,
    p2: state.players.p2.deck.length + state.players.p2.hand.length,
  };
  const played: Record<PlayerId, Record<string, number>> = { p1: {}, p2: {} };
  const counts = {
    p1: { cardsPlayed: 0, mulligan: 0, reactions: 0, choices: 0 },
    p2: { cardsPlayed: 0, mulligan: 0, reactions: 0, choices: 0 },
  };
  for (const command of replay.acceptedCommands) {
    const seat = command.playerId;
    if (command.type === "play_card" || command.type === "play_reaction") {
      const cardId = findCardId(state, seat, command.instanceId);
      if (cardId) played[seat][cardId] = (played[seat][cardId] ?? 0) + 1;
      counts[seat].cardsPlayed += 1;
      if (command.type === "play_reaction") counts[seat].reactions += 1;
    }
    if (command.type === "mulligan")
      counts[seat].mulligan = command.instanceIds.length;
    if (command.type === "resolve_choice") counts[seat].choices += 1;
    state = engine.applyCommand(state, command).state;
  }
  const build = (seat: PlayerId) => {
    const player = state.players[seat];
    return {
      cardsPlayed: counts[seat].cardsPlayed,
      cardIdsPlayed: played[seat],
      // Everything that left the deck, net of mulligan returns.
      cardsDrawn: openingDeck[seat] - player.deck.length,
      mulliganCount: counts[seat].mulligan,
      reactions: counts[seat].reactions,
      choices: counts[seat].choices,
      dominion: player.dominion,
      integrity: player.integrity,
      actions: activity[seat].actions,
      actionMsTotal: activity[seat].actionMsTotal,
      disconnects: activity[seat].disconnects,
      reconnects: activity[seat].reconnects,
      timeouts: activity[seat].timeouts,
      queueWaitMs: activity[seat].queueWaitMs,
    };
  };
  return { p1: build("p1"), p2: build("p2") };
}
