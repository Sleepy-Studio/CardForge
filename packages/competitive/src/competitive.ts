import type { Aspect, PlayerId } from "@cardforge/card-schema";
import type { Command, ReplayRecord } from "@cardforge/rules-kernel";
import type {
  RankTier,
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

/**
 * Unranked progression: account XP, Aspect mastery, and Leader unlocks advance
 * at a reduced rate. Rating, wins, and losses stay ranked-only.
 */
export function progressUnrankedProfile(
  profile: CompetitiveProfile,
  participant: RankedParticipant,
  won: boolean,
  cycles: number,
): { profile: CompetitiveProfile; xp: number } {
  const xp = (won ? 80 : 50) + Math.min(20, cycles * 2);
  const accountXp = profile.accountXp + xp;
  const accountLevel = levelForXp(accountXp);
  return {
    xp,
    profile: {
      ...profile,
      accountXp,
      accountLevel,
      aspectMastery: addMastery(
        profile.aspectMastery,
        participant.aspects,
        won ? 30 : 20,
      ),
      unlockedLeaderIds: unlockedLeadersForLevel(accountLevel),
    },
  };
}

const rankTiers: readonly {
  readonly tierId: RankTier["tierId"];
  readonly name: string;
  readonly floor: number;
}[] = [
  { tierId: "bronze", name: "Bronze", floor: 0 },
  { tierId: "silver", name: "Silver", floor: 950 },
  { tierId: "gold", name: "Gold", floor: 1_100 },
  { tierId: "platinum", name: "Platinum", floor: 1_250 },
  { tierId: "diamond", name: "Diamond", floor: 1_400 },
  { tierId: "master", name: "Master", floor: 1_550 },
];

/**
 * Presentation layer over the authoritative Elo rating. Each tier below
 * Master splits into three equal divisions; the rating math is untouched.
 * New players start at 1,000 (Silver II), so an early loss stays in Silver.
 */
export function rankForRating(rating: number): RankTier {
  const value = Math.max(0, Math.floor(rating));
  let index = 0;
  for (let candidate = 0; candidate < rankTiers.length; candidate += 1)
    if (value >= rankTiers[candidate]!.floor) index = candidate;
  const tier = rankTiers[index]!;
  const next = rankTiers[index + 1];
  if (!next)
    return {
      tierId: tier.tierId,
      name: tier.name,
      division: null,
      label: tier.name,
      floor: tier.floor,
      nextAt: null,
      progress: 1,
    };
  // Bronze is open-ended below; give it a 150-point band for divisions.
  const bandStart = index === 0 ? next.floor - 150 : tier.floor;
  const span = (next.floor - bandStart) / 3;
  const step = Math.min(2, Math.max(0, Math.floor((value - bandStart) / span)));
  const division = (3 - step) as 1 | 2 | 3;
  const divisionFloor = Math.round(bandStart + step * span);
  const nextAt = Math.round(bandStart + (step + 1) * span);
  const progress = Math.min(
    1,
    Math.max(0, (value - divisionFloor) / Math.max(1, nextAt - divisionFloor)),
  );
  return {
    tierId: tier.tierId,
    name: tier.name,
    division,
    label: `${tier.name} ${["I", "II", "III"][division - 1]}`,
    floor: divisionFloor,
    nextAt,
    progress: Math.round(progress * 100) / 100,
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
      concessions: 0,
      abandonments: 0,
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
    concessions: matches.filter(
      (match) => match.victoryReason === "concession",
    ).length,
    abandonments: matches.filter(
      (match) => match.victoryReason === "abandonment",
    ).length,
    leaders: [...leaderRows.entries()]
      .map(([leaderId, row]) => ({
        leaderId,
        ...row,
        winRate: rounded(row.wins / row.matches),
      }))
      .sort((left, right) => left.leaderId.localeCompare(right.leaderId)),
  };
}
