import type { PlayerId } from "@cardforge/card-schema";
import {
  createCompetitiveProfile,
  monoStarterLeaders,
  rankForRating,
  seasonOne,
  type CompetitiveProfile,
} from "@cardforge/competitive";
import { missingCards, starterGrant, type OwnedCard } from "@cardforge/economy";
import {
  liveOpsCatalog,
  questPeriod,
  visibleEvents,
  type LiveOpsDefinition,
  type QuestDefinition,
} from "@cardforge/live-ops";
import type {
  AccountRecord,
  CardForgeStore,
  DeckRecord,
  QuestActivity,
} from "@cardforge/persistence";
import {
  prototypeDecks,
  prototypeLeaderOptions,
  proofCardMap,
  proofFormat,
  validateDeck,
  type PrototypeLeaderId,
} from "@cardforge/rules-tempofront";
import { defaultTheme } from "@cardforge/theme-default";

/*
 * Player-facing domain rules shared by the HTTP API and the match rooms.
 * The server is always the authority; the web client mirrors these checks
 * only to give earlier feedback.
 */

export const maxDecksPerAccount = 50;

export function isKnownLeader(leaderId: string): leaderId is PrototypeLeaderId {
  return leaderId in prototypeDecks;
}

export function starterDeckId(leaderId: string): string {
  return `starter-${leaderId.replace(/^leader\./, "")}`;
}

export function starterDeckName(leaderId: string): string {
  const option = prototypeLeaderOptions.find(
    (item) => item.cardId === leaderId,
  );
  return `${option?.archetype ?? "Starter"} Starter`;
}

export function starterOptions() {
  return monoStarterLeaders.map((leaderId) => {
    const card = proofCardMap.get(leaderId);
    const option = prototypeLeaderOptions.find(
      (item) => item.cardId === leaderId,
    );
    return {
      leaderId,
      name: card?.name ?? leaderId,
      aspects: card?.aspects ?? [],
      archetype: option?.archetype ?? "",
      summary: option?.summary ?? "",
      deckId: starterDeckId(leaderId),
      deckName: starterDeckName(leaderId),
      cardIds: prototypeDecks[leaderId],
    };
  });
}

export function buildDeckRecord(input: {
  readonly accountId: string;
  readonly deckId: string;
  readonly name: string;
  readonly leaderId: string;
  readonly cardIds: readonly string[];
  readonly revision: number;
}): DeckRecord {
  return {
    deckId: input.deckId,
    accountId: input.accountId,
    gameId: defaultTheme.gameId,
    formatId: proofFormat.formatId,
    leaderId: input.leaderId,
    name: input.name,
    revision: input.revision,
    cardIds: [...input.cardIds],
  };
}

export function deckLegalityErrors(
  leaderId: string,
  cardIds: readonly string[],
): readonly string[] {
  if (!isKnownLeader(leaderId)) return [`Unknown Leader ${leaderId}`];
  return validateDeck(cardIds, proofCardMap, proofFormat, {
    leaderCardId: leaderId,
  });
}

export interface DeckStatus {
  readonly legal: boolean;
  readonly errors: readonly string[];
  readonly missing: readonly OwnedCard[];
  readonly leaderUnlocked: boolean;
  /** Legal, fully owned, and using an unlocked Leader. */
  readonly playable: boolean;
}

export function deckStatus(
  deck: Pick<DeckRecord, "leaderId" | "cardIds">,
  owned: readonly OwnedCard[],
  profile: Pick<CompetitiveProfile, "unlockedLeaderIds">,
): DeckStatus {
  const errors = deckLegalityErrors(deck.leaderId, deck.cardIds);
  const missing = missingCards(deck.cardIds, owned);
  const leaderUnlocked = profile.unlockedLeaderIds.includes(deck.leaderId);
  return {
    legal: errors.length === 0,
    errors,
    missing,
    leaderUnlocked,
    playable: errors.length === 0 && missing.length === 0 && leaderUnlocked,
  };
}

export async function currentProfile(
  store: CardForgeStore,
  accountId: string,
): Promise<CompetitiveProfile> {
  const existing = await store.getCompetitiveProfile(
    accountId,
    seasonOne.seasonId,
  );
  if (existing) return existing;
  const profile = createCompetitiveProfile(accountId, seasonOne.seasonId);
  await store.saveCompetitiveProfile(profile);
  return profile;
}

export class PlayabilityError extends Error {
  constructor(
    readonly code:
      | "DECK_NOT_FOUND"
      | "DECK_ILLEGAL"
      | "DECK_MISSING_CARDS"
      | "LEADER_LOCKED",
    message: string,
  ) {
    super(message);
    this.name = "PlayabilityError";
  }
}

function cardName(cardId: string): string {
  return proofCardMap.get(cardId)?.name ?? cardId;
}

/**
 * Loads a deck owned by the authenticated account and proves it can be used
 * online. Room joins call this; the client can never nominate another
 * account's deck because the account ID comes from the verified ticket.
 */
export async function requirePlayableDeck(
  store: CardForgeStore,
  accountId: string,
  deckId: string,
): Promise<DeckRecord> {
  const deck = await store.getDeck(accountId, deckId);
  if (!deck)
    throw new PlayabilityError("DECK_NOT_FOUND", "That deck no longer exists.");
  const [economy, profile] = await Promise.all([
    store.getEconomySnapshot(accountId),
    currentProfile(store, accountId),
  ]);
  const status = deckStatus(deck, economy.cards, profile);
  if (!status.legal)
    throw new PlayabilityError(
      "DECK_ILLEGAL",
      `This deck is not legal: ${status.errors[0]}`,
    );
  if (!status.leaderUnlocked)
    throw new PlayabilityError(
      "LEADER_LOCKED",
      `${cardName(deck.leaderId)} is locked. Reach a higher account level to unlock this Leader.`,
    );
  if (status.missing.length)
    throw new PlayabilityError(
      "DECK_MISSING_CARDS",
      `You are missing ${status.missing
        .slice(0, 3)
        .map((card) => `${card.quantity}× ${cardName(card.cardId)}`)
        .join(
          ", ",
        )}${status.missing.length > 3 ? " and more" : ""}. Craft them in your Collection.`,
    );
  return deck;
}

export async function grantStarterFor(
  store: CardForgeStore,
  account: AccountRecord,
  leaderId: string,
): Promise<{ readonly granted: boolean; readonly deckId: string }> {
  if (
    !(monoStarterLeaders as readonly string[]).includes(leaderId) ||
    !isKnownLeader(leaderId)
  )
    throw new PlayabilityError(
      "DECK_ILLEGAL",
      "Choose one of the starter Leaders.",
    );
  const cardIds = prototypeDecks[leaderId];
  const deckId = starterDeckId(leaderId);
  const granted = await store.grantStarter({
    accountId: account.accountId,
    starterLeaderId: leaderId,
    grant: starterGrant(cardIds, proofCardMap),
    deck: buildDeckRecord({
      accountId: account.accountId,
      deckId,
      name: starterDeckName(leaderId),
      leaderId,
      cardIds,
      revision: 1,
    }),
  });
  return { granted, deckId };
}

export async function currentLiveOps(
  store: CardForgeStore,
): Promise<LiveOpsDefinition> {
  const definitions = await store.listLiveOpsDefinitions();
  const configId = liveOpsCatalog[0]!.configId;
  return (
    definitions
      .filter(
        (definition) =>
          definition.configId === configId && definition.state === "published",
      )
      .sort((a, b) => b.revision - a.revision)[0] ??
    liveOpsCatalog[liveOpsCatalog.length - 1]!
  );
}

/** Seeds shipped revisions that are missing. Never overwrites a revision. */
export async function seedLiveOps(
  store: CardForgeStore,
): Promise<readonly number[]> {
  const stored = await store.listLiveOpsDefinitions();
  const seeded: number[] = [];
  for (const definition of liveOpsCatalog) {
    if (
      stored.some(
        (item) =>
          item.configId === definition.configId &&
          item.revision === definition.revision,
      )
    )
      continue;
    await store.saveLiveOpsDefinition(definition);
    seeded.push(definition.revision);
  }
  return seeded;
}

function questProgress(
  quest: QuestDefinition,
  activity: QuestActivity,
): number {
  switch (quest.objective.type) {
    case "play_matches":
      return activity.matchesPlayed;
    case "win_matches":
      return activity.matchesWon;
    case "gain_dominion":
      return activity.dominion;
    case "play_reactions":
      return activity.reactions;
    case "complete_scenarios":
      return activity.scenarios;
  }
}

export interface QuestView {
  readonly questId: string;
  readonly title: string;
  readonly cadence: QuestDefinition["cadence"];
  readonly objective: QuestDefinition["objective"];
  readonly reward: QuestDefinition["reward"];
  readonly periodKey: string;
  readonly endsAt: string;
  readonly progress: number;
  readonly target: number;
  readonly complete: boolean;
  readonly claimed: boolean;
}

/** Quest progress is derived from recorded matches; never client-reported. */
export async function questsFor(
  store: CardForgeStore,
  accountId: string,
  definition: LiveOpsDefinition,
  nowMs = Date.now(),
): Promise<readonly QuestView[]> {
  const claims = new Set(
    (await store.listQuestClaims(accountId)).map(
      (claim) => `${claim.questId}\u0000${claim.periodKey}`,
    ),
  );
  const activityCache = new Map<string, Promise<QuestActivity>>();
  return Promise.all(
    definition.quests.map(async (quest) => {
      const period = questPeriod(quest.cadence, nowMs, seasonOne);
      let activity = activityCache.get(period.startsAt);
      if (!activity) {
        activity = store.questActivity(accountId, period.startsAt);
        activityCache.set(period.startsAt, activity);
      }
      const target = quest.objective.count;
      const progress = Math.min(target, questProgress(quest, await activity));
      return {
        questId: quest.questId,
        title: quest.title,
        cadence: quest.cadence,
        objective: quest.objective,
        reward: quest.reward,
        periodKey: period.periodKey,
        endsAt: period.endsAt,
        progress,
        target,
        complete: progress >= target,
        claimed: claims.has(`${quest.questId}\u0000${period.periodKey}`),
      };
    }),
  );
}

export function competitiveView(profile: CompetitiveProfile) {
  return {
    ...profile,
    rank: rankForRating(profile.rating),
    season: seasonOne,
  };
}

export function liveEventsView(
  definition: LiveOpsDefinition,
  nowMs = Date.now(),
) {
  return visibleEvents(definition, nowMs);
}

export const seats: readonly PlayerId[] = ["p1", "p2"];
