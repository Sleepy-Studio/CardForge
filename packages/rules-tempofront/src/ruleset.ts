import type { FormatDefinition, ThemeManifest } from "@cardforge/card-schema";

export const tempoFrontRules = {
  rulesetId: "tempofront",
  revision: "tempofront@0.3.0",
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
  revision: 1,
  deckSize: 40,
  maxCopies: 3,
  maxUniqueCopies: 1,
  minimumEntities: 12,
};

export const defaultTheme: ThemeManifest = {
  gameId: "cardforge-proof",
  ruleset: tempoFrontRules.revision,
  terms: {
    leader: "Leader",
    entity: "Entity",
    focus: "Focus",
    integrity: "Integrity",
    dominion: "Dominion",
    front: "Front",
    discard: "Discard",
    archive: "Archive",
  },
  visuals: {
    cardFrames: "proof-wireframe-v1",
    boardScene: "proof-grid-v1",
    iconSet: "proof-icons-v1",
  },
};
