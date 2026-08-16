import type { FormatDefinition } from "@cardforge/card-schema";

export const tempoFrontRules = {
  rulesetId: "tempofront",
  revision: "tempofront@0.6.0",
  startingIntegrity: 20,
  startingHand: 5,
  handLimit: 9,
  startingFocus: 3,
  maximumFocus: 8,
  timelineLength: 12,
  dominionToWin: 6,
  fronts: ["left", "center", "right"] as const,
  slots: ["vanguard", "support"] as const,
} as const;

export const proofFormat: FormatDefinition = {
  formatId: "proof-constructed",
  revision: 2,
  deckSize: 40,
  maxCopies: 3,
  maxUniqueCopies: 1,
  minimumEntities: 12,
};
