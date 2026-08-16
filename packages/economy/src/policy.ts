import type { CardDefinition } from "@cardforge/card-schema";
import type {
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
