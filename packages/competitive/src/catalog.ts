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

export const betaBalancePatch: BalancePatch = {
  patchId: "tempofront-competitive-2",
  revision: 1,
  publishedAt: "2026-08-16T18:00:00.000Z",
  formatRevision: 1,
  cardRevisions: {
    "leader.relay": 2,
    "leader.ember": 2,
    "leader.citadel": 2,
    "leader.vector": 2,
    "leader.null": 2,
    "entity.skywatcher": 2,
    "entity.bulwark": 2,
    "entity.flashrunner": 2,
    "entity.rampart_keeper": 2,
    "entity.windknife": 2,
    "entity.gatehouse": 2,
    "entity.slipstream": 2,
    "entity.horizon_spotter": 2,
    "entity.granite_warden": 2,
    "entity.wallwright": 2,
    "entity.standard_bearer": 2,
    "entity.vector_scout": 2,
    "entity.gale_marksman": 2,
    "entity.relay_rider": 2,
    "entity.crosswind_ace": 2,
    "entity.farline_observer": 2,
  },
  notes: [
    "Replace repeatable Citadel Barrier with bounded protection.",
    "Reduce the highest Bastion Presence values and improve Motion Presence.",
    "Give Relay, Vector, and Null Commands effects the heuristic bot can value.",
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
  patchId: betaBalancePatch.patchId,
};

export const competitivePatches: readonly BalancePatch[] = [
  launchPatch,
  betaBalancePatch,
];
export const competitiveSeasons: readonly SeasonDefinition[] = [seasonOne];
