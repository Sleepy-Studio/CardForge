import type { OwnedCard, WalletBalance } from "@cardforge/economy";

/** Shapes returned by the match-server API (see apps/match-server/src/http). */

export interface Account {
  readonly accountId: string;
  readonly displayName: string;
  readonly role: "player" | "admin";
  readonly onboarding: {
    readonly starterLeaderId: string | null;
    readonly completedAt: string | null;
  };
  readonly createdAt: string;
}

export interface DeckStatus {
  readonly legal: boolean;
  readonly errors: readonly string[];
  readonly missing: readonly OwnedCard[];
  readonly leaderUnlocked: boolean;
  readonly playable: boolean;
}

export interface SavedDeck {
  readonly deckId: string;
  readonly name: string;
  readonly leaderId: string;
  readonly revision: number;
  readonly cardIds: readonly string[];
  readonly status: DeckStatus;
}

export interface RankView {
  readonly tierId: string;
  readonly name: string;
  readonly division: 1 | 2 | 3 | null;
  readonly label: string;
  readonly floor: number;
  readonly nextAt: number | null;
  readonly progress: number;
}

export interface Season {
  readonly seasonId: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface CompetitiveView {
  readonly rating: number;
  readonly wins: number;
  readonly losses: number;
  readonly accountXp: number;
  readonly accountLevel: number;
  readonly aspectMastery: Readonly<Record<string, number>>;
  readonly unlockedLeaderIds: readonly string[];
  readonly rank: RankView;
  readonly season: Season;
}

export interface QuestView {
  readonly questId: string;
  readonly title: string;
  readonly cadence: "daily" | "weekly" | "seasonal";
  readonly reward: {
    readonly shards?: number;
    readonly styleTokens?: number;
    readonly cosmeticId?: string;
  };
  readonly periodKey: string;
  readonly endsAt: string;
  readonly progress: number;
  readonly target: number;
  readonly complete: boolean;
  readonly claimed: boolean;
}

export interface LiveEvent {
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly window: "upcoming" | "active" | "ended";
  readonly reward: {
    readonly shards?: number;
    readonly styleTokens?: number;
    readonly cosmeticId?: string;
  };
}

export type MatchQueue = "casual" | "ranked" | "friend" | "practice" | "pve";

export interface MatchHistoryEntry {
  readonly matchId: string;
  readonly queue: MatchQueue | null;
  readonly status: "active" | "complete" | "abandoned";
  readonly seat: "p1" | "p2";
  readonly result: "win" | "loss" | null;
  readonly reason:
    "integrity" | "dominion" | "concession" | "abandonment" | null;
  readonly leaderId: string;
  readonly deckId: string | null;
  readonly deckName: string | null;
  readonly opponent: {
    readonly displayName: string;
    readonly leaderId: string;
  } | null;
  readonly cycles: number | null;
  readonly commandCount: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly ratingDelta: number | null;
  readonly reward: { readonly shards: number; readonly xp: number } | null;
}

export interface HomePayload {
  readonly account: Account;
  readonly competitive: CompetitiveView;
  readonly wallets: readonly WalletBalance[];
  readonly decks: readonly Omit<SavedDeck, "cardIds">[];
  readonly quests: readonly QuestView[];
  readonly events: readonly LiveEvent[];
  readonly recentMatches: readonly MatchHistoryEntry[];
  readonly featureFlags: Readonly<Record<string, boolean>>;
}

export interface TrainingScenario {
  readonly scenarioId: string;
  readonly kind: "tutorial" | "pve";
  readonly title: string;
  readonly summary: string;
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly playerLeaderId: string;
  readonly opponentLeaderId: string;
  readonly reward: { readonly shards: number; readonly styleTokens: number };
}
