import type { CardDefinition } from "@cardforge/card-schema";
import type {
  OwnedCard,
  CosmeticDefinition,
  CraftQuote,
  EconomySnapshot,
} from "./types.js";

export const craftCosts = {
  common: 100,
  uncommon: 250,
  rare: 600,
  unique: 1_200,
} as const;

export const economyBootstrap = {
  shards: 3_000,
  styleTokens: 600,
  cosmeticIds: ["card-back.aether", "board.aetherfront"],
} as const;

export const cosmeticCatalog: readonly CosmeticDefinition[] = [
  {
    cosmeticId: "card-back.aether",
    category: "card_back",
    name: "Aether Sigil",
    styleTokenCost: 0,
    themeId: "aetherfront",
  },
  {
    cosmeticId: "board.aetherfront",
    category: "board",
    name: "Aetherfront Table",
    styleTokenCost: 0,
    themeId: "aetherfront",
  },
  {
    cosmeticId: "card-back.orbital",
    category: "card_back",
    name: "Orbital Telemetry",
    styleTokenCost: 200,
    themeId: "orbital-conflict",
  },
  {
    cosmeticId: "board.orbital-grid",
    category: "board",
    name: "Orbital Grid",
    styleTokenCost: 350,
    themeId: "orbital-conflict",
  },
  {
    cosmeticId: "frame.founder-brass",
    category: "frame",
    name: "Founder Brass",
    styleTokenCost: 300,
  },
  {
    cosmeticId: "vfx.clean-strike",
    category: "vfx",
    name: "Clean Strike",
    styleTokenCost: 150,
  },
];

export function maximumOwnedCopies(card: CardDefinition): number {
  return card.unique ? 1 : (card.deckLimit ?? 3);
}

export function quoteCraft(
  card: CardDefinition,
  ownedQuantity: number,
  quantity = 1,
): CraftQuote {
  if (card.type === "leader" || card.generatedOnly)
    throw new Error(`${card.cardId} is not a craftable collectible`);
  if (!card.rarity) throw new Error(`${card.cardId} has no launch rarity`);
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    throw new Error("Craft quantity must be a positive integer");
  const resultingQuantity = ownedQuantity + quantity;
  if (resultingQuantity > maximumOwnedCopies(card))
    throw new Error(
      `${card.cardId} ownership is capped at ${maximumOwnedCopies(card)}`,
    );
  const unitCost = craftCosts[card.rarity];
  return {
    cardId: card.cardId,
    quantity,
    currencyId: "shards",
    unitCost,
    totalCost: unitCost * quantity,
    resultingQuantity,
  };
}

export function collectionCompletion(
  snapshot: EconomySnapshot,
  cards: readonly CardDefinition[],
): {
  readonly owned: number;
  readonly total: number;
  readonly percent: number;
} {
  const collectibleIds = new Set(
    cards
      .filter((card) => card.type !== "leader" && !card.generatedOnly)
      .map((card) => card.cardId),
  );
  const owned = snapshot.cards.filter(
    (card) => card.quantity > 0 && collectibleIds.has(card.cardId),
  ).length;
  const total = collectibleIds.size;
  return {
    owned,
    total,
    percent: total ? Math.round((owned / total) * 10_000) / 100 : 0,
  };
}

export const tradingProvider: { readonly enabled: false } = { enabled: false };

/**
 * Shards granted once per completed match and account. Friend matches grant
 * nothing so two cooperating accounts cannot farm currency.
 */
export const matchShardRewards = {
  casual: { win: 60, loss: 30 },
  ranked: { win: 100, loss: 50 },
  friend: { win: 0, loss: 0 },
} as const;

export function matchShardReward(
  queue: keyof typeof matchShardRewards,
  won: boolean,
  outcome: "played" | "conceded_early",
): number {
  // A concession before the third Cycle earns nothing, discouraging
  // queue-and-concede farming.
  if (outcome === "conceded_early") return 0;
  return matchShardRewards[queue][won ? "win" : "loss"];
}

/**
 * Cards granted by a starter deck: every collectible in the list, with
 * quantities capped at the ownership limit. Leaders are not collectibles.
 */
export function starterGrant(
  deckCardIds: readonly string[],
  cards: ReadonlyMap<string, CardDefinition>,
): readonly OwnedCard[] {
  const counts = new Map<string, number>();
  for (const cardId of deckCardIds) {
    const card = cards.get(cardId);
    if (!card || card.type === "leader" || card.generatedOnly) continue;
    counts.set(
      cardId,
      Math.min(maximumOwnedCopies(card), (counts.get(cardId) ?? 0) + 1),
    );
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([cardId, quantity]) => ({ cardId, quantity }));
}

/** Cards in a deck list the owner does not hold enough copies of. */
export function missingCards(
  deckCardIds: readonly string[],
  owned: readonly OwnedCard[],
): readonly OwnedCard[] {
  const have = new Map(owned.map((card) => [card.cardId, card.quantity]));
  const need = new Map<string, number>();
  for (const cardId of deckCardIds) need.set(cardId, (need.get(cardId) ?? 0) + 1);
  return [...need.entries()]
    .map(([cardId, quantity]) => ({
      cardId,
      quantity: quantity - (have.get(cardId) ?? 0),
    }))
    .filter((card) => card.quantity > 0)
    .sort((left, right) => left.cardId.localeCompare(right.cardId));
}
