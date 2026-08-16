import type {
  AbilityDefinition,
  Aspect,
  CardDefinition,
  EffectNode,
  Keyword,
} from "@cardforge/card-schema";

type PlayableAspect = Exclude<Aspect, "neutral">;

interface CardOptions {
  readonly unique?: boolean;
  readonly keywords?: Readonly<Partial<Record<Keyword, number | true>>>;
  readonly subtype?: string;
  readonly slot?: "vanguard" | "support";
  readonly ability?: AbilityDefinition;
}

function collectible(
  options: CardOptions,
): Pick<CardDefinition, "rarity" | "unique" | "deckLimit"> {
  return options.unique ? { rarity: "unique", unique: true, deckLimit: 1 } : {};
}

function unit(
  id: string,
  name: string,
  aspect: Aspect,
  cost: number,
  time: number,
  power: number,
  vitality: number,
  presence: number,
  options: CardOptions = {},
): CardDefinition {
  return {
    cardId: `entity.${id}`,
    revision: 1,
    name,
    type: "entity",
    aspects: [aspect],
    focusCost: cost,
    playTime: time,
    power,
    vitality,
    presence,
    strikeTime: options.keywords?.rapid ? 2 : 3,
    ...collectible(options),
    ...(options.keywords ? { keywords: options.keywords } : {}),
    ...(options.subtype ? { subtypes: [options.subtype] } : {}),
    ...(options.slot ? { slotRestriction: options.slot } : {}),
    ...(options.ability ? { abilities: [options.ability] } : {}),
  };
}

function oneShot(
  type: "tactic" | "reaction",
  id: string,
  name: string,
  aspect: Aspect,
  cost: number,
  time: number,
  effects: readonly EffectNode[],
  options: CardOptions = {},
): CardDefinition {
  return {
    cardId: `${type}.${id}`,
    revision: 1,
    name,
    type,
    aspects: [aspect],
    focusCost: cost,
    playTime: time,
    ...collectible(options),
    abilities: [
      {
        abilityId: `${id}-${type}`,
        type: type === "reaction" ? "reaction" : "activated",
        effects,
        ...(type === "reaction" ? { tempoDebt: time } : {}),
      },
    ],
  };
}

function attachment(
  id: string,
  name: string,
  aspect: PlayableAspect,
  power: number,
  presence: number,
  unique = false,
): CardDefinition {
  return {
    cardId: `attachment.${id}`,
    revision: 1,
    name,
    type: "attachment",
    aspects: [aspect],
    focusCost: 2,
    playTime: 2,
    staticModifiers: { power, presence },
    ...collectible({ unique }),
  };
}

function site(
  id: string,
  name: string,
  aspect: Aspect,
  presence: number,
  unique = false,
): CardDefinition {
  return {
    cardId: `site.${id}`,
    revision: 1,
    name,
    type: "site",
    aspects: [aspect],
    focusCost: unique ? 4 : 2,
    playTime: unique ? 4 : 2,
    staticModifiers: { presence },
    ...collectible({ unique }),
  };
}

const entities: readonly CardDefinition[] = [
  unit("sunhammer", "Sunhammer Veteran", "force", 3, 3, 4, 3, 1),
  unit("cinder_champion", "Cinder Champion", "force", 6, 4, 7, 6, 2, {
    unique: true,
    keywords: { rapid: true },
  }),
  unit("war_drummer", "War Drummer", "force", 2, 2, 2, 3, 2),
  unit("bridge_guard", "Bridge Guard", "bastion", 2, 2, 1, 4, 2, {
    keywords: { armor: 1 },
  }),
  unit("bastion_colossus", "Bastion Colossus", "bastion", 7, 5, 5, 10, 4, {
    unique: true,
    keywords: { armor: 1 },
  }),
  unit("shield_engine", "Shield Engine", "bastion", 4, 3, 1, 7, 3, {
    subtype: "structure",
    slot: "support",
  }),
  unit("oath_architect", "Oath Architect", "bastion", 3, 3, 2, 5, 2),
  unit("afterimage_scout", "Afterimage Scout", "motion", 2, 1, 2, 2, 2, {
    keywords: { mobile: true },
  }),
  unit("storm_rider", "Storm Rider", "motion", 6, 4, 6, 6, 3, {
    unique: true,
    keywords: { rapid: true, mobile: true },
  }),
  unit("phase_archer", "Phase Archer", "motion", 3, 2, 3, 3, 2, {
    keywords: { ranged: true },
  }),
  unit("courier_prime", "Courier Prime", "motion", 4, 3, 3, 5, 3, {
    keywords: { mobile: true },
  }),
  unit("bloom_matriarch", "Bloom Matriarch", "growth", 6, 4, 5, 8, 4, {
    unique: true,
    ability: {
      abilityId: "matriarch-spawn",
      type: "triggered",
      trigger: "on_deploy",
      effects: [{ op: "spawn", tokenCardId: "token.sprout" }],
    },
  }),
  unit("river_guard", "River Guard", "growth", 3, 3, 2, 5, 2, {
    keywords: { barrier: true },
  }),
  unit("wildspeaker", "Wildspeaker", "growth", 4, 3, 3, 5, 3, {
    ability: {
      abilityId: "wildspeaker-heal",
      type: "triggered",
      trigger: "on_deploy",
      effects: [{ op: "heal", target: { kind: "friendly_leader" }, amount: 2 }],
    },
  }),
  unit("mask_broker", "Mask Broker", "cunning", 5, 4, 4, 5, 3, {
    unique: true,
    ability: {
      abilityId: "broker-scout",
      type: "triggered",
      trigger: "on_deploy",
      effects: [{ op: "scout", amount: 3 }],
    },
  }),
  unit("null_archer", "Null Archer", "cunning", 3, 3, 3, 3, 2, {
    keywords: { ranged: true },
    slot: "support",
  }),
  unit("code_oracle", "Code Oracle", "cunning", 4, 3, 2, 5, 3, {
    ability: {
      abilityId: "oracle-scout",
      type: "triggered",
      trigger: "on_deploy",
      effects: [{ op: "scout", amount: 2 }],
    },
  }),
  unit("bone_titan", "Bone Titan", "entropy", 7, 5, 7, 9, 3, {
    unique: true,
    ability: {
      abilityId: "titan-return",
      type: "triggered",
      trigger: "on_defeat",
      effects: [{ op: "salvage", cardType: "entity" }],
    },
  }),
  unit("dusk_reclaimer", "Dusk Reclaimer", "entropy", 3, 3, 3, 4, 2, {
    ability: {
      abilityId: "reclaimer-return",
      type: "triggered",
      trigger: "on_deploy",
      effects: [{ op: "salvage", cardType: "entity" }],
    },
  }),
  unit("venom_scribe", "Venom Scribe", "entropy", 2, 2, 2, 3, 2),
  unit("final_witness", "Final Witness", "entropy", 4, 3, 4, 5, 3),
  unit("frontier_soldier", "Frontier Soldier", "neutral", 2, 2, 2, 3, 1),
  unit("caravan_archer", "Caravan Archer", "neutral", 3, 3, 2, 3, 1, {
    keywords: { ranged: true },
  }),
  unit("stone_lifter", "Stone Lifter", "neutral", 4, 3, 4, 5, 2),
  unit("field_engineer", "Field Engineer", "neutral", 2, 2, 1, 3, 2),
  unit("hired_blade", "Hired Blade", "neutral", 3, 3, 3, 4, 1),
  unit("worldwalker", "The Worldwalker", "neutral", 7, 5, 7, 8, 3, {
    unique: true,
    keywords: { mobile: true },
  }),
  unit("ancient_witness", "Ancient Witness", "neutral", 6, 4, 4, 8, 4, {
    unique: true,
  }),
  unit("militia_tower", "Militia Tower", "neutral", 3, 3, 0, 6, 3, {
    subtype: "structure",
    slot: "support",
  }),
];

const tactics: readonly CardDefinition[] = [
  oneShot(
    "tactic",
    "final_salvo",
    "Final Salvo",
    "force",
    4,
    4,
    [{ op: "deal_damage", target: { kind: "enemy_leader" }, amount: 4 }],
    { unique: true },
  ),
  oneShot("tactic", "raise_barricade", "Raise Barricade", "bastion", 2, 2, [
    { op: "add_barrier", target: { kind: "chosen_friendly_entity" } },
  ]),
  oneShot("tactic", "cut_across", "Cut Across", "motion", 1, 1, [
    { op: "shift", target: { kind: "chosen_friendly_entity" } },
  ]),
  oneShot("tactic", "distant_route", "Distant Route", "motion", 2, 2, [
    { op: "scout", amount: 3 },
  ]),
  oneShot("tactic", "renew_the_line", "Renew the Line", "growth", 3, 3, [
    { op: "spawn", tokenCardId: "token.sprout" },
  ]),
  oneShot(
    "tactic",
    "perfect_read",
    "The Perfect Read",
    "cunning",
    3,
    3,
    [{ op: "scout", amount: 4 }],
    { unique: true },
  ),
  oneShot("tactic", "open_secret", "Open Secret", "cunning", 2, 2, [
    { op: "draw", amount: 1 },
  ]),
  oneShot(
    "tactic",
    "last_reckoning",
    "Last Reckoning",
    "entropy",
    4,
    4,
    [
      {
        op: "deal_damage",
        target: { kind: "chosen_enemy_entities", minimum: 1, maximum: 2 },
        amount: 3,
      },
    ],
    { unique: true },
  ),
  oneShot("tactic", "grave_memory", "Grave Memory", "entropy", 2, 2, [
    { op: "salvage", cardType: "entity" },
  ]),
  oneShot("tactic", "field_orders", "Field Orders", "neutral", 2, 2, [
    { op: "scout", amount: 2 },
  ]),
  oneShot("tactic", "emergency_aid", "Emergency Aid", "neutral", 2, 2, [
    { op: "heal", target: { kind: "friendly_leader" }, amount: 3 },
  ]),
];

const reactions: readonly CardDefinition[] = [
  oneShot("reaction", "burning_reply", "Burning Reply", "force", 1, 2, [
    { op: "deal_damage", target: { kind: "chosen_enemy_entity" }, amount: 2 },
  ]),
  oneShot("reaction", "unyielding_line", "Unyielding Line", "bastion", 1, 1, [
    {
      op: "add_status",
      target: { kind: "chosen_friendly_entity" },
      status: {
        statusId: "protected",
        value: 2,
        duration: "until_cycle_end",
        stackingPolicy: "highest",
      },
    },
  ]),
  oneShot("reaction", "sidestep", "Sidestep", "motion", 1, 1, [
    { op: "shift", target: { kind: "chosen_friendly_entity" } },
  ]),
  oneShot("reaction", "sudden_bloom", "Sudden Bloom", "growth", 1, 2, [
    { op: "add_barrier", target: { kind: "chosen_friendly_entity" } },
  ]),
  oneShot(
    "reaction",
    "absolute_denial",
    "Absolute Denial",
    "cunning",
    3,
    3,
    [{ op: "cancel_previous_chain_link" }],
    { unique: true },
  ),
  oneShot("reaction", "death_refused", "Death Refused", "entropy", 2, 2, [
    { op: "salvage", cardType: "entity" },
  ]),
  oneShot(
    "reaction",
    "shared_shelter",
    "Shared Shelter",
    "neutral",
    2,
    2,
    [
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
    { unique: true },
  ),
];

const attachments: readonly CardDefinition[] = [
  attachment("sunblade", "The Sunblade", "force", 3, 0, true),
  attachment("tower_shield", "Tower Shield", "bastion", 0, 2),
  attachment("phase_harness", "Phase Harness", "motion", 1, 1),
  attachment("worldseed", "The Worldseed", "growth", 1, 2, true),
  attachment("cipher_lens", "Cipher Lens", "cunning", 1, 1),
  attachment("grave_crown", "Grave Crown", "entropy", 2, 1),
];

const sites: readonly CardDefinition[] = [
  site("eternal_keep", "The Eternal Keep", "bastion", 3, true),
  site("broken_bridge", "Broken Bridge", "neutral", 1),
  site("open_market", "Open Market", "neutral", 1),
  site("silent_vale", "Silent Vale", "neutral", 1),
  site("old_battleground", "Old Battleground", "neutral", 1),
  site("river_crossing", "River Crossing", "neutral", 1),
  site("forgotten_station", "Forgotten Station", "neutral", 1),
];

export const launchExpansionCards: readonly CardDefinition[] = [
  ...entities,
  ...tactics,
  ...reactions,
  ...attachments,
  ...sites,
];
