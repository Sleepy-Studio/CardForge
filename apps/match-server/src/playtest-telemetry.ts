import type { MatchTelemetry } from "@cardforge/competitive";
import type {
  CompletedMatchSummary,
  ProductEventRecord,
} from "@cardforge/persistence";

/*
 * Closed-alpha dashboard aggregation. Every rate carries its sample size and
 * a caution level so small samples are never read as conclusions.
 */

export type Caution = "insufficient" | "low" | "moderate" | "adequate";

export function cautionFor(sample: number): Caution {
  if (sample < 20) return "insufficient";
  if (sample < 100) return "low";
  if (sample < 400) return "moderate";
  return "adequate";
}

export interface Rate {
  readonly value: number | null;
  readonly numerator: number;
  readonly sample: number;
  readonly caution: Caution;
}

export function rate(numerator: number, sample: number): Rate {
  return {
    value: sample ? Math.round((numerator / sample) * 10_000) / 10_000 : null,
    numerator,
    sample,
    caution: cautionFor(sample),
  };
}

function mean(values: readonly number[]): number | null {
  return values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
    : null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export interface PlaytestOverview {
  readonly generatedAt: string;
  readonly matches: {
    readonly started: number;
    readonly completed: number;
    readonly byQueue: Readonly<Record<string, number>>;
    readonly completionRate: Rate;
    readonly concessionRate: Rate;
    readonly abandonmentRate: Rate;
    readonly dominionWinRate: Rate;
    readonly integrityWinRate: Rate;
    readonly initiativeWinRate: Rate;
    readonly averageCycles: number | null;
    readonly averageDurationMs: number | null;
    readonly averageActionMs: number | null;
    readonly reactionsPerMatch: number | null;
  };
  readonly seats: {
    readonly sample: number;
    readonly disconnects: number;
    readonly reconnects: number;
    readonly timeouts: number;
    readonly mulliganRate: Rate;
    readonly averageCardsDrawn: number | null;
    readonly medianQueueWaitMs: number | null;
    readonly averageQueueWaitMs: number | null;
  };
  readonly leaders: readonly {
    readonly leaderId: string;
    readonly picks: number;
    readonly pickRate: Rate;
    readonly winRate: Rate;
    readonly starterDeckShare: Rate;
  }[];
  readonly cards: {
    readonly mostPlayed: readonly { readonly cardId: string; readonly plays: number }[];
    readonly neverPlayed: readonly string[];
    readonly distinctPlayed: number;
  };
  readonly onboarding: {
    readonly registered: number;
    readonly steps: readonly {
      readonly name: string;
      readonly accounts: number;
      readonly conversion: Rate;
    }[];
  };
}

const funnel = [
  "account_registered",
  "starter_chosen",
  "tutorial_started",
  "tutorial_completed",
  "first_deck_selected",
  "match_started",
  "match_completed",
] as const;

export function playtestOverview(input: {
  readonly matches: readonly CompletedMatchSummary[];
  readonly telemetry: readonly MatchTelemetry[];
  readonly events: readonly ProductEventRecord[];
  readonly collectibleCardIds: readonly string[];
  readonly nowMs?: number;
}): PlaytestOverview {
  const online = input.matches.filter(
    (match) => match.meta.queue === "casual" || match.meta.queue === "ranked" || match.meta.queue === "friend",
  );
  const started = new Set(
    input.events
      .filter((event) => event.name === "match_started" && typeof event.properties.matchId === "string")
      .map((event) => event.properties.matchId as string),
  ).size;
  const byQueue: Record<string, number> = {};
  for (const match of online) byQueue[match.meta.queue ?? "unknown"] = (byQueue[match.meta.queue ?? "unknown"] ?? 0) + 1;
  const reasons = (reason: string) => online.filter((match) => match.meta.reason === reason).length;
  const rulesFinishes = online.filter(
    (match) => match.meta.reason === "dominion" || match.meta.reason === "integrity",
  );
  const telemetryById = new Map(input.telemetry.map((row) => [row.matchId, row]));
  const withInitiative = online.filter((match) => telemetryById.has(match.meta.matchId));
  const initiativeWins = withInitiative.filter(
    (match) => telemetryById.get(match.meta.matchId)!.startingInitiative === match.meta.winnerId,
  ).length;
  const durations = online
    .filter((match) => match.meta.startedAt && match.meta.completedAt)
    .map((match) => Date.parse(match.meta.completedAt!) - Date.parse(match.meta.startedAt!));
  const seats = online.flatMap((match) => match.participants);
  const actionMs = seats.flatMap((seat) =>
    seat.stats.actions ? [seat.stats.actionMsTotal! / seat.stats.actions] : [],
  );
  const waits = seats.flatMap((seat) =>
    typeof seat.stats.queueWaitMs === "number" ? [seat.stats.queueWaitMs] : [],
  );
  const sum = (pick: (value: (typeof seats)[number]) => number | undefined) =>
    seats.reduce((total, seat) => total + (pick(seat) ?? 0), 0);

  const leaderRows = new Map<string, { picks: number; wins: number; decided: number; starter: number }>();
  for (const seat of seats) {
    const row = leaderRows.get(seat.leaderId) ?? { picks: 0, wins: 0, decided: 0, starter: 0 };
    row.picks += 1;
    if (seat.result) row.decided += 1;
    if (seat.result === "win") row.wins += 1;
    if (seat.deckId?.startsWith("starter-")) row.starter += 1;
    leaderRows.set(seat.leaderId, row);
  }

  const plays = new Map<string, number>();
  for (const seat of seats)
    for (const [cardId, count] of Object.entries(seat.stats.cardIdsPlayed ?? {}))
      plays.set(cardId, (plays.get(cardId) ?? 0) + count);

  const accountsFor = (name: string) =>
    new Set(
      input.events
        .filter((event) => event.name === name && event.accountId)
        .map((event) => event.accountId!),
    ).size;
  const registered = accountsFor("account_registered");

  return {
    generatedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    matches: {
      started,
      completed: online.length,
      byQueue,
      completionRate: rate(Math.min(online.length, started), started),
      concessionRate: rate(reasons("concession"), online.length),
      abandonmentRate: rate(reasons("abandonment"), online.length),
      dominionWinRate: rate(reasons("dominion"), rulesFinishes.length),
      integrityWinRate: rate(reasons("integrity"), rulesFinishes.length),
      initiativeWinRate: rate(initiativeWins, withInitiative.length),
      averageCycles: mean(online.flatMap((match) => (match.meta.cycles === null ? [] : [match.meta.cycles]))),
      averageDurationMs: mean(durations),
      averageActionMs: mean(actionMs),
      reactionsPerMatch: online.length ? Math.round((sum((seat) => seat.stats.reactions) / online.length) * 100) / 100 : null,
    },
    seats: {
      sample: seats.length,
      disconnects: sum((seat) => seat.stats.disconnects),
      reconnects: sum((seat) => seat.stats.reconnects),
      timeouts: sum((seat) => seat.stats.timeouts),
      mulliganRate: rate(seats.filter((seat) => (seat.stats.mulliganCount ?? 0) > 0).length, seats.length),
      averageCardsDrawn: mean(seats.flatMap((seat) => (seat.stats.cardsDrawn === undefined ? [] : [seat.stats.cardsDrawn]))),
      medianQueueWaitMs: median(waits),
      averageQueueWaitMs: mean(waits),
    },
    leaders: [...leaderRows.entries()]
      .map(([leaderId, row]) => ({
        leaderId,
        picks: row.picks,
        pickRate: rate(row.picks, seats.length),
        winRate: rate(row.wins, row.decided),
        starterDeckShare: rate(row.starter, row.picks),
      }))
      .sort((a, b) => b.picks - a.picks || a.leaderId.localeCompare(b.leaderId)),
    cards: {
      mostPlayed: [...plays.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 20)
        .map(([cardId, count]) => ({ cardId, plays: count })),
      neverPlayed: online.length
        ? input.collectibleCardIds.filter((cardId) => !plays.has(cardId)).sort()
        : [],
      distinctPlayed: plays.size,
    },
    onboarding: {
      registered,
      steps: funnel.map((name) => {
        const accounts = accountsFor(name);
        return { name, accounts, conversion: rate(accounts, registered) };
      }),
    },
  };
}
