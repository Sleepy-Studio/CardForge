import type { ContentPackSource } from "@cardforge/card-schema";
import { proofCards, tempoFrontRules } from "@cardforge/rules-tempofront";

export const coreSetSource: ContentPackSource = {
  manifest: {
    packId: "tempofront-core-prototype",
    revision: 1,
    gameId: "cardforge-proof",
    ruleset: tempoFrontRules.revision,
    setIds: ["core-prototype"],
    dependencies: [],
  },
  cards: proofCards.filter((card) => card.cardId !== "leader.proof"),
};
