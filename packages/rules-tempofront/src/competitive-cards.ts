import type {
  AbilityDefinition,
  Aspect,
  CardDefinition,
  EffectNode,
  Keyword,
} from "@cardforge/card-schema";

type PlayableAspect = Exclude<Aspect, "neutral">;

interface EntitySpec {
  readonly id: string;
  readonly name: string;
  readonly aspect: PlayableAspect;
  readonly cost: number;
  readonly time: number;
  readonly power: number;
  readonly vitality: number;
  readonly presence: number;
  readonly strike?: number;
  readonly keywords?: Readonly<Partial<Record<Keyword, number | true>>>;
  readonly slot?: "vanguard" | "support";
  readonly subtype?: string;
  readonly ability?: AbilityDefinition;
}

function entity(spec: EntitySpec): CardDefinition {
  return {
    cardId: `entity.${spec.id}`,
    revision: 1,
    name: spec.name,
    type: "entity",
    aspects: [spec.aspect],
    focusCost: spec.cost,
    playTime: spec.time,
    power: spec.power,
    vitality: spec.vitality,
    presence: spec.presence,
    strikeTime: spec.strike ?? 3,
    ...(spec.keywords ? { keywords: spec.keywords } : {}),
    ...(spec.slot ? { slotRestriction: spec.slot } : {}),
    ...(spec.subtype ? { subtypes: [spec.subtype] } : {}),
    ...(spec.ability ? { abilities: [spec.ability] } : {}),
  };
}

interface ActionSpec {
  readonly id: string;
  readonly name: string;
  readonly aspect: PlayableAspect;
  readonly type: "tactic" | "reaction";
  readonly cost: number;
  readonly time: number;
  readonly effects: readonly EffectNode[];
  readonly tempoDebt?: number;
  readonly prepareDiscount?: number;
}

function action(spec: ActionSpec): CardDefinition {
  return {
    cardId: `${spec.type}.${spec.id}`,
    revision: 1,
    name: spec.name,
    type: spec.type,
    aspects: [spec.aspect],
    focusCost: spec.cost,
    playTime: spec.time,
    abilities: [
      {
        abilityId: `${spec.id}-${spec.type}`,
        type: spec.type === "reaction" ? "reaction" : "activated",
        effects: spec.effects,
        ...(spec.type === "reaction"
          ? { tempoDebt: spec.tempoDebt ?? spec.time }
          : {}),
      },
    ],
    ...(spec.prepareDiscount === undefined
      ? {}
      : { prepareDiscount: spec.prepareDiscount }),
  };
}

function leader(
  id: string,
  name: string,
  aspects: readonly PlayableAspect[],
  command: EffectNode,
): CardDefinition {
  return {
    cardId: `leader.${id}`,
    revision: 1,
    name,
    type: "leader",
    aspects,
    focusCost: 0,
    playTime: 0,
    abilities: [
      {
        abilityId: `${id}-command`,
        type: "leader_command",
        focusCost: 1,
        timeCost: 2,
        oncePerCycle: true,
        effects: [command],
      },
    ],
  };
}

const forceCards = [
  entity({
    id: "redline_duelist",
    name: "Redline Duelist",
    aspect: "force",
    cost: 1,
    time: 2,
    power: 2,
    vitality: 1,
    presence: 1,
    strike: 2,
  }),
  entity({
    id: "siege_ram",
    name: "Siege Ram",
    aspect: "force",
    cost: 4,
    time: 4,
    power: 5,
    vitality: 5,
    presence: 1,
    subtype: "structure",
  }),
  entity({
    id: "ashwing_raider",
    name: "Ashwing Raider",
    aspect: "force",
    cost: 3,
    time: 3,
    power: 3,
    vitality: 3,
    presence: 1,
    keywords: { rapid: true },
  }),
  entity({
    id: "banner_breaker",
    name: "Banner Breaker",
    aspect: "force",
    cost: 5,
    time: 4,
    power: 6,
    vitality: 5,
    presence: 2,
  }),
  entity({
    id: "flare_captain",
    name: "Flare Captain",
    aspect: "force",
    cost: 3,
    time: 3,
    power: 3,
    vitality: 4,
    presence: 2,
  }),
  action({
    id: "scorch_lane",
    name: "Scorch the Lane",
    aspect: "force",
    type: "tactic",
    cost: 2,
    time: 3,
    effects: [
      { op: "deal_damage", target: { kind: "chosen_enemy_entity" }, amount: 3 },
    ],
  }),
  action({
    id: "answer_with_force",
    name: "Answer with Force",
    aspect: "force",
    type: "reaction",
    cost: 1,
    time: 2,
    tempoDebt: 2,
    effects: [
      { op: "deal_damage", target: { kind: "chosen_enemy_entity" }, amount: 2 },
    ],
  }),
  {
    cardId: "attachment.breach_charge",
    revision: 1,
    name: "Breach Charge",
    type: "attachment",
    aspects: ["force"],
    focusCost: 2,
    playTime: 2,
    staticModifiers: { power: 2 },
  },
] satisfies readonly CardDefinition[];

const bastionCards = [
  entity({
    id: "oathshield",
    name: "Oathshield",
    aspect: "bastion",
    cost: 2,
    time: 2,
    power: 1,
    vitality: 4,
    presence: 2,
    keywords: { armor: 1 },
  }),
  entity({
    id: "citadel_archer",
    name: "Citadel Archer",
    aspect: "bastion",
    cost: 3,
    time: 3,
    power: 2,
    vitality: 4,
    presence: 2,
    keywords: { ranged: true },
    slot: "support",
  }),
  entity({
    id: "granite_warden",
    name: "Granite Warden",
    aspect: "bastion",
    cost: 5,
    time: 4,
    power: 3,
    vitality: 8,
    presence: 3,
    keywords: { armor: 1 },
  }),
  entity({
    id: "wallwright",
    name: "Wallwright",
    aspect: "bastion",
    cost: 3,
    time: 3,
    power: 1,
    vitality: 5,
    presence: 3,
    subtype: "structure",
    slot: "support",
  }),
  entity({
    id: "standard_bearer",
    name: "Standard Bearer",
    aspect: "bastion",
    cost: 4,
    time: 3,
    power: 3,
    vitality: 5,
    presence: 3,
  }),
  action({
    id: "hold_the_center",
    name: "Hold the Center",
    aspect: "bastion",
    type: "tactic",
    cost: 2,
    time: 2,
    effects: [
      { op: "add_barrier", target: { kind: "chosen_friendly_entity" } },
    ],
  }),
  action({
    id: "brace_for_impact",
    name: "Brace for Impact",
    aspect: "bastion",
    type: "reaction",
    cost: 1,
    time: 1,
    tempoDebt: 1,
    effects: [
      {
        op: "add_status",
        target: { kind: "chosen_friendly_entity" },
        status: {
          statusId: "protected",
          value: 3,
          duration: "until_cycle_end",
          stackingPolicy: "highest",
        },
      },
    ],
  }),
  {
    cardId: "relic.citadel_bell",
    revision: 1,
    name: "Citadel Bell",
    type: "relic",
    aspects: ["bastion"],
    focusCost: 3,
    playTime: 3,
    staticModifiers: { presence: 1 },
  },
] satisfies readonly CardDefinition[];

const motionCards = [
  entity({
    id: "vector_scout",
    name: "Vector Scout",
    aspect: "motion",
    cost: 1,
    time: 1,
    power: 1,
    vitality: 2,
    presence: 1,
    keywords: { mobile: true },
  }),
  entity({
    id: "gale_marksman",
    name: "Gale Marksman",
    aspect: "motion",
    cost: 3,
    time: 2,
    power: 2,
    vitality: 3,
    presence: 1,
    keywords: { ranged: true },
  }),
  entity({
    id: "relay_rider",
    name: "Relay Rider",
    aspect: "motion",
    cost: 2,
    time: 2,
    power: 2,
    vitality: 2,
    presence: 1,
    keywords: { rapid: true, mobile: true },
  }),
  entity({
    id: "crosswind_ace",
    name: "Crosswind Ace",
    aspect: "motion",
    cost: 4,
    time: 3,
    power: 4,
    vitality: 4,
    presence: 2,
    keywords: { mobile: true },
  }),
  entity({
    id: "farline_observer",
    name: "Farline Observer",
    aspect: "motion",
    cost: 3,
    time: 3,
    power: 2,
    vitality: 4,
    presence: 2,
    keywords: { ranged: true },
    slot: "support",
  }),
  action({
    id: "slip_the_net",
    name: "Slip the Net",
    aspect: "motion",
    type: "tactic",
    cost: 1,
    time: 1,
    effects: [{ op: "shift", target: { kind: "chosen_friendly_entity" } }],
    prepareDiscount: 1,
  }),
  action({
    id: "moving_guard",
    name: "Moving Guard",
    aspect: "motion",
    type: "reaction",
    cost: 1,
    time: 1,
    tempoDebt: 1,
    effects: [{ op: "shift", target: { kind: "chosen_friendly_entity" } }],
  }),
  {
    cardId: "attachment.vector_rig",
    revision: 1,
    name: "Vector Rig",
    type: "attachment",
    aspects: ["motion"],
    focusCost: 2,
    playTime: 1,
    staticModifiers: { power: 1, presence: 1 },
  },
] satisfies readonly CardDefinition[];

const growthCards = [
  entity({
    id: "sprout_tender",
    name: "Sprout Tender",
    aspect: "growth",
    cost: 1,
    time: 2,
    power: 1,
    vitality: 2,
    presence: 2,
  }),
  entity({
    id: "grove_healer",
    name: "Grove Healer",
    aspect: "growth",
    cost: 3,
    time: 3,
    power: 2,
    vitality: 4,
    presence: 2,
    ability: {
      abilityId: "grove-heal",
      type: "triggered",
      trigger: "on_deploy",
      effects: [{ op: "heal", target: { kind: "friendly_leader" }, amount: 2 }],
    },
  }),
  entity({
    id: "pollen_guard",
    name: "Pollen Guard",
    aspect: "growth",
    cost: 2,
    time: 2,
    power: 1,
    vitality: 4,
    presence: 2,
    keywords: { barrier: true },
  }),
  entity({
    id: "verdant_giant",
    name: "Verdant Giant",
    aspect: "growth",
    cost: 6,
    time: 4,
    power: 5,
    vitality: 8,
    presence: 4,
  }),
  entity({
    id: "nest_shepherd",
    name: "Nest Shepherd",
    aspect: "growth",
    cost: 4,
    time: 3,
    power: 3,
    vitality: 5,
    presence: 3,
    ability: {
      abilityId: "nest-spawn",
      type: "triggered",
      trigger: "on_deploy",
      effects: [{ op: "spawn", tokenCardId: "token.sprout" }],
    },
  }),
  action({
    id: "abundant_return",
    name: "Abundant Return",
    aspect: "growth",
    type: "tactic",
    cost: 2,
    time: 3,
    effects: [{ op: "salvage", cardType: "entity" }],
  }),
  action({
    id: "sheltering_bloom",
    name: "Sheltering Bloom",
    aspect: "growth",
    type: "reaction",
    cost: 1,
    time: 2,
    tempoDebt: 2,
    effects: [{ op: "heal", target: { kind: "friendly_leader" }, amount: 3 }],
  }),
  {
    cardId: "relic.seed_vault",
    revision: 1,
    name: "Seed Vault",
    type: "relic",
    aspects: ["growth"],
    focusCost: 3,
    playTime: 3,
    abilities: [
      {
        abilityId: "seed-vault",
        type: "activated",
        focusCost: 1,
        timeCost: 2,
        oncePerCycle: true,
        effects: [{ op: "spawn", tokenCardId: "token.sprout" }],
      },
    ],
  },
] satisfies readonly CardDefinition[];

const cunningCards = [
  entity({
    id: "whisper_agent",
    name: "Whisper Agent",
    aspect: "cunning",
    cost: 1,
    time: 2,
    power: 1,
    vitality: 2,
    presence: 1,
  }),
  entity({
    id: "glasswire_sniper",
    name: "Glasswire Sniper",
    aspect: "cunning",
    cost: 3,
    time: 3,
    power: 3,
    vitality: 2,
    presence: 1,
    keywords: { ranged: true },
    slot: "support",
  }),
  entity({
    id: "signal_thief",
    name: "Signal Thief",
    aspect: "cunning",
    cost: 3,
    time: 2,
    power: 2,
    vitality: 3,
    presence: 2,
  }),
  entity({
    id: "null_magistrate",
    name: "Null Magistrate",
    aspect: "cunning",
    cost: 5,
    time: 4,
    power: 4,
    vitality: 6,
    presence: 3,
  }),
  entity({
    id: "reserve_handler",
    name: "Reserve Handler",
    aspect: "cunning",
    cost: 2,
    time: 2,
    power: 1,
    vitality: 3,
    presence: 2,
    ability: {
      abilityId: "reserve-scout",
      type: "triggered",
      trigger: "on_deploy",
      effects: [{ op: "scout", amount: 2 }],
    },
  }),
  action({
    id: "read_the_field",
    name: "Read the Field",
    aspect: "cunning",
    type: "tactic",
    cost: 2,
    time: 2,
    effects: [{ op: "scout", amount: 3 }],
    prepareDiscount: 1,
  }),
  action({
    id: "sealed_verdict",
    name: "Sealed Verdict",
    aspect: "cunning",
    type: "reaction",
    cost: 2,
    time: 2,
    tempoDebt: 2,
    effects: [{ op: "cancel_previous_chain_link" }],
  }),
  {
    cardId: "attachment.whisper_key",
    revision: 1,
    name: "Whisper Key",
    type: "attachment",
    aspects: ["cunning"],
    focusCost: 1,
    playTime: 1,
    staticModifiers: { presence: 1 },
  },
] satisfies readonly CardDefinition[];

const entropyCards = [
  entity({
    id: "dusk_scavenger",
    name: "Dusk Scavenger",
    aspect: "entropy",
    cost: 1,
    time: 2,
    power: 2,
    vitality: 2,
    presence: 1,
  }),
  entity({
    id: "rot_marshal",
    name: "Rot Marshal",
    aspect: "entropy",
    cost: 3,
    time: 3,
    power: 3,
    vitality: 4,
    presence: 2,
  }),
  entity({
    id: "memory_eater",
    name: "Memory Eater",
    aspect: "entropy",
    cost: 4,
    time: 3,
    power: 4,
    vitality: 4,
    presence: 2,
  }),
  entity({
    id: "grave_choir",
    name: "Grave Choir",
    aspect: "entropy",
    cost: 3,
    time: 3,
    power: 1,
    vitality: 5,
    presence: 3,
    slot: "support",
  }),
  entity({
    id: "endless_husk",
    name: "Endless Husk",
    aspect: "entropy",
    cost: 6,
    time: 4,
    power: 6,
    vitality: 7,
    presence: 3,
    ability: {
      abilityId: "husk-return",
      type: "triggered",
      trigger: "on_defeat",
      effects: [{ op: "salvage", cardType: "entity" }],
    },
  }),
  action({
    id: "wither",
    name: "Wither",
    aspect: "entropy",
    type: "tactic",
    cost: 2,
    time: 2,
    effects: [
      {
        op: "add_status",
        target: { kind: "chosen_enemy_entity" },
        status: {
          statusId: "exposed",
          value: 2,
          duration: "until_cycle_end",
          stackingPolicy: "highest",
        },
      },
    ],
  }),
  action({
    id: "deny_the_end",
    name: "Deny the End",
    aspect: "entropy",
    type: "reaction",
    cost: 2,
    time: 2,
    tempoDebt: 2,
    effects: [{ op: "salvage", cardType: "entity" }],
  }),
  {
    cardId: "relic.ossuary_engine",
    revision: 1,
    name: "Ossuary Engine",
    type: "relic",
    aspects: ["entropy"],
    focusCost: 3,
    playTime: 3,
    abilities: [
      {
        abilityId: "ossuary-salvage",
        type: "activated",
        focusCost: 1,
        timeCost: 2,
        oncePerCycle: true,
        effects: [{ op: "salvage", cardType: "entity" }],
      },
    ],
  },
] satisfies readonly CardDefinition[];

const neutralCards = [
  {
    cardId: "entity.frontier_medic",
    revision: 1,
    name: "Frontier Medic",
    type: "entity",
    aspects: ["neutral"],
    focusCost: 2,
    playTime: 2,
    power: 1,
    vitality: 3,
    presence: 1,
    strikeTime: 3,
    abilities: [
      {
        abilityId: "medic-entry",
        type: "triggered",
        trigger: "on_deploy",
        effects: [
          { op: "heal", target: { kind: "friendly_leader" }, amount: 1 },
        ],
      },
    ],
  },
  {
    cardId: "entity.common_guard",
    revision: 1,
    name: "Common Guard",
    type: "entity",
    aspects: ["neutral"],
    focusCost: 2,
    playTime: 2,
    power: 2,
    vitality: 3,
    presence: 1,
    strikeTime: 3,
  },
  {
    cardId: "site.crossroads",
    revision: 1,
    name: "The Crossroads",
    type: "site",
    aspects: ["neutral"],
    focusCost: 2,
    playTime: 2,
    staticModifiers: { presence: 1 },
  },
  {
    cardId: "relic.field_compass",
    revision: 1,
    name: "Field Compass",
    type: "relic",
    aspects: ["neutral"],
    focusCost: 2,
    playTime: 2,
    abilities: [
      {
        abilityId: "compass-scout",
        type: "activated",
        focusCost: 1,
        timeCost: 2,
        oncePerCycle: true,
        effects: [{ op: "scout", amount: 2 }],
      },
    ],
  },
] satisfies readonly CardDefinition[];

export const competitiveExpansionCards: readonly CardDefinition[] = [
  leader("ember", "Rheya Ember-Crowned", ["force"], {
    op: "deal_damage",
    target: { kind: "enemy_leader" },
    amount: 1,
  }),
  leader("citadel", "Torren of the Citadel", ["bastion"], {
    op: "add_barrier",
    target: { kind: "chosen_friendly_entity" },
  }),
  leader("vector", "Sio Vector", ["motion"], {
    op: "shift",
    target: { kind: "chosen_friendly_entity" },
  }),
  leader("verdant", "Maelin Verdant", ["growth"], {
    op: "spawn",
    tokenCardId: "token.sprout",
  }),
  leader("cipher", "Vale Cipher", ["cunning"], { op: "scout", amount: 2 }),
  leader("hollow", "Oris Hollow", ["entropy"], {
    op: "salvage",
    cardType: "entity",
  }),
  leader("sanctuary", "Seren Stonebloom", ["bastion", "growth"], {
    op: "heal",
    target: { kind: "friendly_leader" },
    amount: 2,
  }),
  leader("null", "The Null Regent", ["cunning", "entropy"], {
    op: "add_status",
    target: { kind: "chosen_enemy_entity" },
    status: {
      statusId: "exposed",
      value: 1,
      duration: "until_cycle_end",
      stackingPolicy: "highest",
    },
  }),
  ...forceCards,
  ...bastionCards,
  ...motionCards,
  ...growthCards,
  ...cunningCards,
  ...entropyCards,
  ...neutralCards,
];
