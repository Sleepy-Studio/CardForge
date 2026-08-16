import type { Aspect, PlayerId } from "@cardforge/card-schema";

export interface SeasonDefinition {
  readonly seasonId: string;
  readonly revision: number;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly formatId: string;
  readonly formatRevision: number;
  readonly patchId: string;
}

export interface BalancePatch {
  readonly patchId: string;
  readonly revision: number;
  readonly publishedAt: string;
  readonly formatRevision: number;
  readonly cardRevisions: Readonly<Record<string, number>>;
  readonly notes: readonly string[];
}

export interface CompetitiveProfile {
  readonly accountId: string;
  readonly seasonId: string;
  readonly rating: number;
  readonly wins: number;
  readonly losses: number;
  readonly accountXp: number;
  readonly accountLevel: number;
  readonly aspectMastery: Readonly<Partial<Record<Aspect, number>>>;
  readonly unlockedLeaderIds: readonly string[];
}

export interface RankedParticipant {
  readonly playerId: PlayerId;
  readonly accountId: string;
  readonly leaderId: string;
  readonly aspects: readonly Aspect[];
}

export interface RankedSettlement {
  readonly matchId: string;
  readonly seasonId: string;
  readonly winnerId: PlayerId;
  readonly profiles: Readonly<Record<PlayerId, CompetitiveProfile>>;
  readonly ratingDelta: Readonly<Record<PlayerId, number>>;
  readonly xpGained: Readonly<Record<PlayerId, number>>;
}

export interface MatchTelemetry {
  readonly matchId: string;
  readonly queue: "casual" | "ranked" | "practice" | "pve";
  readonly seasonId?: string;
  readonly participants: Readonly<Record<PlayerId, RankedParticipant>>;
  readonly winnerId: PlayerId;
  readonly victoryReason: "integrity" | "dominion";
  readonly startingInitiative: PlayerId;
  readonly cycles: number;
  readonly commandCount: number;
  readonly mainActionCount: number;
  readonly reactionCount: number;
  readonly choiceCount: number;
  readonly cardsPlayed: number;
}

export interface LeaderBalanceMetric {
  readonly leaderId: string;
  readonly matches: number;
  readonly wins: number;
  readonly winRate: number;
}

export interface BalanceOverview {
  readonly matches: number;
  readonly averageCycles: number;
  readonly averageCommands: number;
  readonly averageMainActions: number;
  readonly averageReactions: number;
  readonly initiativeWinRate: number;
  readonly integrityWins: number;
  readonly dominionWins: number;
  readonly leaders: readonly LeaderBalanceMetric[];
}
