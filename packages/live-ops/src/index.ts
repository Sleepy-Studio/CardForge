export type PublicationState = "draft" | "staged" | "published" | "deprecated";

export interface RewardBundle {
  readonly shards?: number;
  readonly styleTokens?: number;
  readonly cosmeticId?: string;
}

export interface QuestDefinition {
  readonly questId: string;
  readonly cadence: "daily" | "weekly" | "seasonal";
  readonly title: string;
  readonly objective:
    | { readonly type: "play_matches"; readonly count: number }
    | { readonly type: "win_matches"; readonly count: number }
    | { readonly type: "gain_dominion"; readonly count: number }
    | { readonly type: "play_reactions"; readonly count: number }
    | { readonly type: "complete_scenarios"; readonly count: number };
  readonly reward: RewardBundle;
}

export interface LiveEventDefinition {
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly featureFlag: string;
  readonly scenarioIds?: readonly string[];
  readonly reward: RewardBundle;
}

export interface LiveOpsDefinition {
  readonly configId: string;
  readonly revision: number;
  readonly state: PublicationState;
  readonly seasonId: string;
  readonly formatId: string;
  readonly formatRevision: number;
  readonly activePatchId: string;
  readonly quests: readonly QuestDefinition[];
  readonly events: readonly LiveEventDefinition[];
  readonly featureFlags: Readonly<Record<string, boolean>>;
}

export const launchLiveOps: LiveOpsDefinition = {
  configId: "liveops.launch-2026",
  revision: 1,
  state: "published",
  seasonId: "season.first-frontier",
  formatId: "proof-constructed",
  formatRevision: 2,
  activePatchId: "tempofront-competitive-2",
  quests: [
    {
      questId: "daily.take-action",
      cadence: "daily",
      title: "Take the Initiative",
      objective: { type: "play_matches", count: 2 },
      reward: { shards: 150 },
    },
    {
      questId: "daily.hold-two",
      cadence: "daily",
      title: "Hold the Line",
      objective: { type: "gain_dominion", count: 3 },
      reward: { shards: 175 },
    },
    {
      questId: "weekly.answer-call",
      cadence: "weekly",
      title: "Answer the Call",
      objective: { type: "play_reactions", count: 12 },
      reward: { shards: 500, styleTokens: 75 },
    },
    {
      questId: "weekly.academy",
      cadence: "weekly",
      title: "Field Studies",
      objective: { type: "complete_scenarios", count: 3 },
      reward: { shards: 450, styleTokens: 50 },
    },
    {
      questId: "season.first-six",
      cadence: "seasonal",
      title: "First Six",
      objective: { type: "win_matches", count: 6 },
      reward: { cosmeticId: "frame.founder-brass" },
    },
  ],
  events: [
    {
      eventId: "event.launch-front",
      title: "Launch Front",
      startsAt: "2026-08-16T00:00:00.000Z",
      endsAt: "2026-09-01T00:00:00.000Z",
      featureFlag: "event.launch-front",
      reward: { styleTokens: 100 },
    },
    {
      eventId: "event.clockwork-gauntlet",
      title: "Clockwork Gauntlet",
      startsAt: "2026-08-20T00:00:00.000Z",
      endsAt: "2026-09-10T00:00:00.000Z",
      featureFlag: "event.clockwork-gauntlet",
      scenarioIds: [
        "pve.broken-citadel",
        "pve.last-signal",
        "pve.clockwork-hunt",
      ],
      reward: { cosmeticId: "vfx.clean-strike" },
    },
  ],
  featureFlags: {
    "queue.ranked": true,
    "mode.pve": true,
    "economy.crafting": true,
    "economy.trading": false,
    "event.launch-front": true,
    "event.clockwork-gauntlet": false,
  },
};

export function validateLiveOps(
  definition: LiveOpsDefinition,
): readonly string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(definition.revision) || definition.revision <= 0)
    errors.push("Revision must be a positive integer");
  const ids = new Set<string>();
  for (const item of [...definition.quests, ...definition.events]) {
    const id = "questId" in item ? item.questId : item.eventId;
    if (ids.has(id)) errors.push(`Duplicate live-ops id ${id}`);
    ids.add(id);
  }
  for (const event of definition.events) {
    if (Date.parse(event.startsAt) >= Date.parse(event.endsAt))
      errors.push(`${event.eventId} has an invalid window`);
    if (!(event.featureFlag in definition.featureFlags))
      errors.push(`${event.eventId} references a missing feature flag`);
  }
  for (const quest of definition.quests) {
    if (quest.objective.count <= 0)
      errors.push(`${quest.questId} has a non-positive objective`);
  }
  return errors;
}

export function stageLiveOps(
  definition: LiveOpsDefinition,
  nextRevision: number,
): LiveOpsDefinition {
  if (nextRevision <= definition.revision)
    throw new Error("A staged live-ops revision must increase");
  return { ...definition, revision: nextRevision, state: "staged" };
}
