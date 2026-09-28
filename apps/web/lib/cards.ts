import type {
  Aspect,
  CardDefinition,
  Keyword,
  StatusId,
} from "@cardforge/card-schema";
import { craftCosts, maximumOwnedCopies } from "@cardforge/economy";
import {
  generateRulesText,
  glossaryName,
  keywordEntry,
  proofCardMap,
  prototypeCards,
  prototypeDecks,
  prototypeLeaderOptions,
  proofFormat,
  statusEntry,
  validateDeck,
  type GlossaryEntry,
} from "@cardforge/rules-tempofront";

/*
 * Client-side card catalog. Mirrors server rules for fast feedback only; the
 * server re-validates every deck, craft, and queue join.
 */

export const cardMap: ReadonlyMap<string, CardDefinition> = proofCardMap;
export const allCards: readonly CardDefinition[] = prototypeCards;
export const collectibleCards: readonly CardDefinition[] = prototypeCards
  .filter((card) => card.type !== "leader" && !card.generatedOnly)
  .sort(
    (a, b) =>
      Number.parseInt(a.collectorNumber ?? "999", 10) -
        Number.parseInt(b.collectorNumber ?? "999", 10) ||
      a.name.localeCompare(b.name),
  );
export const leaderCards: readonly CardDefinition[] = prototypeCards.filter(
  (card) => card.type === "leader" && card.cardId in prototypeDecks,
);
export const deckSize = proofFormat.deckSize;
export const aspects: readonly Aspect[] = [
  "force",
  "bastion",
  "motion",
  "growth",
  "cunning",
  "entropy",
  "neutral",
];

export const aspectLabel: Readonly<Record<Aspect, string>> = {
  force: "Force",
  bastion: "Bastion",
  motion: "Motion",
  growth: "Growth",
  cunning: "Cunning",
  entropy: "Entropy",
  neutral: "Neutral",
};

export const typeLabel: Readonly<Record<CardDefinition["type"], string>> = {
  leader: "Leader",
  entity: "Entity",
  tactic: "Tactic",
  reaction: "Reaction",
  attachment: "Attachment",
  relic: "Relic",
  site: "Site",
  token: "Token",
};

export function cardName(cardId: string): string {
  return cardMap.get(cardId)?.name ?? cardId;
}

export function leaderInfo(leaderId: string) {
  const card = cardMap.get(leaderId);
  const option = prototypeLeaderOptions.find(
    (item) => item.cardId === leaderId,
  );
  return {
    leaderId,
    name: card?.name ?? leaderId,
    aspects: card?.aspects ?? [],
    archetype: option?.archetype ?? "",
    summary: option?.summary ?? "",
  };
}

export function starterDeckFor(leaderId: string): readonly string[] {
  return prototypeDecks[leaderId as keyof typeof prototypeDecks] ?? [];
}

export function rulesTextFor(
  card: CardDefinition,
  terms: Readonly<Record<string, string>>,
): string {
  return generateRulesText(card, {
    ...(terms.focus ? { focus: terms.focus } : {}),
    ...(terms.entity ? { entity: terms.entity } : {}),
    ...(terms.leader ? { leader: terms.leader } : {}),
    ...(terms.discard ? { discard: terms.discard } : {}),
  });
}

export interface KeywordChip {
  readonly label: string;
  readonly entry: GlossaryEntry | undefined;
}

export function keywordChips(card: CardDefinition): readonly KeywordChip[] {
  return Object.entries(card.keywords ?? {}).map(([keyword, value]) => {
    const entry = keywordEntry(keyword as Keyword);
    const name = entry?.name ?? keyword;
    return { label: value === true ? name : `${name} ${value}`, entry };
  });
}

export function statusChip(statusId: StatusId, value: number): KeywordChip {
  const entry = statusEntry(statusId);
  return {
    label: `${entry?.name ?? statusId}${value > 1 ? ` ${value}` : ""}`,
    entry,
  };
}

export function themedName(
  entry: GlossaryEntry,
  terms: Readonly<Record<string, string>>,
): string {
  return glossaryName(entry, terms);
}

export function craftCost(card: CardDefinition): number | null {
  return card.rarity ? craftCosts[card.rarity] : null;
}

export function ownershipCap(card: CardDefinition): number {
  return maximumOwnedCopies(card);
}

export function deckErrors(
  leaderId: string,
  cardIds: readonly string[],
): readonly string[] {
  if (!(leaderId in prototypeDecks)) return ["Choose a Leader."];
  return validateDeck(cardIds, proofCardMap, proofFormat, {
    leaderCardId: leaderId,
  });
}

/** Human-friendly rewrite of engine legality messages. */
export function friendlyDeckError(error: string): string {
  return error
    .replace(/[a-z]+\.[a-z0-9_]+/g, (id) =>
      cardMap.has(id) ? cardName(id) : id,
    )
    .replace(/proof-constructed/g, "Standard");
}

export function countCards(cardIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cardId of cardIds)
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
  return counts;
}
