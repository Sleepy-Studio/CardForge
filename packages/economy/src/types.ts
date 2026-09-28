import type { CardDefinition } from "@cardforge/card-schema";

export type CurrencyId = "shards" | "style_tokens";

export interface WalletBalance {
  readonly currencyId: CurrencyId;
  readonly balance: number;
}

export interface OwnedCard {
  readonly cardId: string;
  readonly quantity: number;
}

export interface CosmeticDefinition {
  readonly cosmeticId: string;
  readonly category: "card_back" | "board" | "frame" | "leader_skin" | "vfx";
  readonly name: string;
  readonly styleTokenCost: number;
  readonly themeId?: string;
}

export interface Entitlement {
  readonly entitlementId: string;
  readonly category: CosmeticDefinition["category"];
}

export interface EconomySnapshot {
  readonly accountId: string;
  readonly wallets: readonly WalletBalance[];
  readonly cards: readonly OwnedCard[];
  readonly entitlements: readonly Entitlement[];
}

export interface CraftQuote {
  readonly cardId: string;
  readonly quantity: number;
  readonly currencyId: "shards";
  readonly unitCost: number;
  readonly totalCost: number;
  readonly resultingQuantity: number;
}

export interface EconomyTransaction {
  readonly transactionId: string;
  readonly accountId: string;
  readonly kind:
    "bootstrap" | "craft" | "cosmetic_unlock" | "reward" | "starter_grant";
  readonly currencyId?: CurrencyId;
  readonly currencyDelta?: number;
  readonly itemId?: string;
  readonly itemDelta?: number;
}

export interface InventoryProvider {
  getEconomySnapshot(accountId: string): Promise<EconomySnapshot>;
  getOwnedCard(accountId: string, cardId: string): Promise<OwnedCard | null>;
}

export interface CurrencyProvider {
  getBalance(accountId: string, currencyId: CurrencyId): Promise<number>;
}

export interface EntitlementProvider {
  hasEntitlement(accountId: string, entitlementId: string): Promise<boolean>;
}

export interface StoreProvider {
  craft(
    transactionId: string,
    accountId: string,
    card: CardDefinition,
    quantity: number,
  ): Promise<EconomySnapshot>;
  unlockCosmetic(
    transactionId: string,
    accountId: string,
    cosmetic: CosmeticDefinition,
  ): Promise<EconomySnapshot>;
}

export interface RewardProvider {
  grantReward(
    transactionId: string,
    accountId: string,
    currencyId: CurrencyId,
    amount: number,
  ): Promise<EconomySnapshot>;
}

export interface TradingProvider {
  readonly enabled: false;
}
