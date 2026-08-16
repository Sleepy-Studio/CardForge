import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CardDefinition } from "@cardforge/card-schema";
import {
  collectionCompletion,
  cosmeticCatalog,
  maximumOwnedCopies,
  quoteCraft,
  tradingProvider,
} from "./policy.js";

const common: CardDefinition = {
  cardId: "entity.test",
  revision: 1,
  name: "Test Entity",
  type: "entity",
  aspects: ["neutral"],
  rarity: "common",
  focusCost: 2,
  playTime: 2,
  power: 2,
  vitality: 3,
  presence: 1,
  strikeTime: 3,
};

void describe("economy policy", () => {
  void it("quotes direct crafting and enforces copy caps", () => {
    assert.deepEqual(quoteCraft(common, 1, 2), {
      cardId: "entity.test",
      quantity: 2,
      currencyId: "shards",
      unitCost: 100,
      totalCost: 200,
      resultingQuantity: 3,
    });
    assert.throws(() => quoteCraft(common, 3), /capped at 3/);
    assert.equal(maximumOwnedCopies({ ...common, unique: true }), 1);
  });

  void it("keeps cosmetics separate and trading disabled", () => {
    assert.ok(cosmeticCatalog.every((item) => item.styleTokenCost >= 0));
    assert.equal(tradingProvider.enabled, false);
    assert.ok(
      cosmeticCatalog.every(
        (item) =>
          !item.cosmeticId.includes("power") &&
          !item.cosmeticId.includes("stat"),
      ),
    );
  });

  void it("reports logical-card collection completion", () => {
    assert.deepEqual(
      collectionCompletion(
        {
          accountId: "account",
          wallets: [],
          cards: [{ cardId: common.cardId, quantity: 1 }],
          entitlements: [],
        },
        [common, { ...common, cardId: "leader.test", type: "leader" }],
      ),
      { owned: 1, total: 1, percent: 100 },
    );
  });
});
