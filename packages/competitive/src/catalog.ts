import type { BalancePatch, SeasonDefinition } from "./types.js";

export const launchPatch: BalancePatch = {
  patchId: "tempofront-competitive-1",
  revision: 1,
  publishedAt: "2026-08-16T00:00:00.000Z",
  formatRevision: 1,
  cardRevisions: {},
  notes: [
    "Establish the immutable 120-card competitive-beta baseline.",
    "Pin all matches to TempoFront rules and Standard format revision one.",
  ],
};

export const seasonOne: SeasonDefinition = {
  seasonId: "frontier-2026-01",
  revision: 1,
  name: "The First Frontier",
  startsAt: "2026-08-16T00:00:00.000Z",
  endsAt: "2026-11-16T00:00:00.000Z",
  formatId: "standard",
  formatRevision: 1,
  patchId: launchPatch.patchId,
};

export const competitivePatches: readonly BalancePatch[] = [launchPatch];
export const competitiveSeasons: readonly SeasonDefinition[] = [seasonOne];
