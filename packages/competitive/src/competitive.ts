import type { Aspect, PlayerId } from "@cardforge/card-schema";
import type { Command, ReplayRecord } from "@cardforge/rules-kernel";
import type {
  BalanceOverview,
  CompetitiveProfile,
  MatchTelemetry,
  RankedParticipant,
  RankedSettlement,
} from "./types.js";

export const initialRating = 1_000;
export const monoStarterLeaders = [
  "leader.ember",
  "leader.citadel",
  "leader.vector",
  "leader.verdant",
  "leader.cipher",
  "leader.hollow",
] as const;

const progressionLeaderUnlocks = [
  "leader.vanguard",
  "leader.skydancer",
  "leader.relay",
  "leader.rootbound",
  "leader.sanctuary",
  "leader.null",
] as const;

export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.max(0, xp) / 500) + 1);
}

export function unlockedLeadersForLevel(level: number): readonly string[] {
  const dualCount = Math.min(
    progressionLeaderUnlocks.length,
    Math.max(0, level - 1),
  );
  return [
    ...monoStarterLeaders,
    ...progressionLeaderUnlocks.slice(0, dualCount),
  ];
}

export function createCompetitiveProfile(
  accountId: string,
  seasonId: string,
): CompetitiveProfile {
  return {
    accountId,
    seasonId,
    rating: initialRating,
    wins: 0,
    losses: 0,
    accountXp: 0,
    accountLevel: 1,
    aspectMastery: {},
    unlockedLeaderIds: unlockedLeadersForLevel(1),
  };
}

function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

function ratingChange(
  rating: number,
  opponentRating: number,
  score: 0 | 1,
): number {
  return Math.round(32 * (score - expectedScore(rating, opponentRating)));
}

function addMastery(
  mastery: CompetitiveProfile["aspectMastery"],
  aspects: readonly Aspect[],
  amount: number,
): CompetitiveProfile["aspectMastery"] {
  const next = { ...mastery };
  for (const aspect of aspects)
    if (aspect !== "neutral") next[aspect] = (next[aspect] ?? 0) + amount;
  return next;
}

function progressedProfile(
  profile: CompetitiveProfile,
  participant: RankedParticipant,
  won: boolean,
  cycles: number,
  ratingDelta: number,
): { profile: CompetitiveProfile; xp: number } {
  const xp = (won ? 120 : 70) + Math.min(30, cycles * 2);
  const accountXp = profile.accountXp + xp;
  const accountLevel = levelForXp(accountXp);
  return {
    xp,
    profile: {
      ...profile,
      rating: Math.max(0, profile.rating + ratingDelta),
      wins: profile.wins + (won ? 1 : 0),
      losses: profile.losses + (won ? 0 : 1),
      accountXp,
      accountLevel,
      aspectMastery: addMastery(
        profile.aspectMastery,
        participant.aspects,
        won ? 50 : 30,
      ),
      unlockedLeaderIds: unlockedLeadersForLevel(accountLevel),
    },
  };
}

export function settleRankedMatch(
  matchId: string,
  seasonId: string,
  profiles: Readonly<Record<PlayerId, CompetitiveProfile>>,
  participants: Readonly<Record<PlayerId, RankedParticipant>>,
  winnerId: PlayerId,
  cycles: number,
): RankedSettlement {
  const loserId: PlayerId = winnerId === "p1" ? "p2" : "p1";
  const winnerDelta = ratingChange(
    profiles[winnerId].rating,
    profiles[loserId].rating,
    1,
  );
  const loserDelta = ratingChange(
    profiles[loserId].rating,
    profiles[winnerId].rating,
    0,
  );
  const p1Delta = winnerId === "p1" ? winnerDelta : loserDelta;
  const p2Delta = winnerId === "p2" ? winnerDelta : loserDelta;
  const p1 = progressedProfile(
    profiles.p1,
    participants.p1,
    winnerId === "p1",
    cycles,
    p1Delta,
  );
  const p2 = progressedProfile(
    profiles.p2,
    participants.p2,
    winnerId === "p2",
    cycles,
    p2Delta,
  );
  return {
    matchId,
    seasonId,
    winnerId,
    profiles: { p1: p1.profile, p2: p2.profile },
    ratingDelta: { p1: p1Delta, p2: p2Delta },
    xpGained: { p1: p1.xp, p2: p2.xp },
  };
}

function commandCount(
  commands: readonly Command[],
  type: Command["type"],
): number {
  return commands.filter((command) => command.type === type).length;
}

export function createMatchTelemetry(input: {
  readonly replay: ReplayRecord;
  readonly queue: MatchTelemetry["queue"];
  readonly participants: Readonly<Record<PlayerId, RankedParticipant>>;
  readonly winnerId: PlayerId;
  readonly victoryReason: MatchTelemetry["victoryReason"];
  readonly startingInitiative: PlayerId;
  readonly cycles: number;
  readonly seasonId?: string;
}): MatchTelemetry {
  const commands = input.replay.acceptedCommands;
  return {
    matchId: input.replay.matchId,
    queue: input.queue,
    ...(input.seasonId ? { seasonId: input.seasonId } : {}),
    participants: input.participants,
    winnerId: input.winnerId,
    victoryReason: input.victoryReason,
    startingInitiative: input.startingInitiative,
    cycles: input.cycles,
    commandCount: commands.length,
    mainActionCount:
      commandCount(commands, "play_card") +
      commandCount(commands, "prepare_card") +
      commandCount(commands, "activate_ability") +
      commandCount(commands, "strike") +
      commandCount(commands, "shift") +
      commandCount(commands, "pass"),
    reactionCount: commandCount(commands, "play_reaction"),
    choiceCount: commandCount(commands, "resolve_choice"),
    cardsPlayed:
      commandCount(commands, "play_card") +
      commandCount(commands, "play_reaction"),
  };
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function aggregateBalanceOverview(
  matches: readonly MatchTelemetry[],
): BalanceOverview {
  if (matches.length === 0)
    return {
      matches: 0,
      averageCycles: 0,
      averageCommands: 0,
      averageMainActions: 0,
      averageReactions: 0,
      initiativeWinRate: 0,
      integrityWins: 0,
      dominionWins: 0,
      leaders: [],
    };
  const leaderRows = new Map<string, { matches: number; wins: number }>();
  for (const match of matches)
    for (const playerId of ["p1", "p2"] as const) {
      const leaderId = match.participants[playerId].leaderId;
      const row = leaderRows.get(leaderId) ?? { matches: 0, wins: 0 };
      row.matches += 1;
      if (match.winnerId === playerId) row.wins += 1;
      leaderRows.set(leaderId, row);
    }
  const sum = (pick: (match: MatchTelemetry) => number) =>
    matches.reduce((total, match) => total + pick(match), 0);
  return {
    matches: matches.length,
    averageCycles: rounded(sum((match) => match.cycles) / matches.length),
    averageCommands: rounded(
      sum((match) => match.commandCount) / matches.length,
    ),
    averageMainActions: rounded(
      sum((match) => match.mainActionCount) / matches.length,
    ),
    averageReactions: rounded(
      sum((match) => match.reactionCount) / matches.length,
    ),
    initiativeWinRate: rounded(
      matches.filter((match) => match.winnerId === match.startingInitiative)
        .length / matches.length,
    ),
    integrityWins: matches.filter(
      (match) => match.victoryReason === "integrity",
    ).length,
    dominionWins: matches.filter((match) => match.victoryReason === "dominion")
      .length,
    leaders: [...leaderRows.entries()]
      .map(([leaderId, row]) => ({
        leaderId,
        ...row,
        winRate: rounded(row.wins / row.matches),
      }))
      .sort((left, right) => left.leaderId.localeCompare(right.leaderId)),
  };
}
