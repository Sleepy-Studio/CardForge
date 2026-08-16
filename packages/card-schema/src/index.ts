export type PlayerId = "p1" | "p2";
export type FrontId = "left" | "center" | "right";
export type SlotId = "vanguard" | "support";
export type Aspect =
  "force" | "bastion" | "motion" | "growth" | "cunning" | "entropy" | "neutral";

export type CardType =
  | "leader"
  | "entity"
  | "tactic"
  | "reaction"
  | "attachment"
  | "relic"
  | "site"
  | "token";

export type Keyword =
  "armor" | "barrier" | "ranged" | "rapid" | "structure" | "mobile";

export type StatusId =
  "stunned" | "rooted" | "silenced" | "exposed" | "protected";

export interface StatusDefinition {
  readonly statusId: StatusId;
  readonly value: number;
  readonly duration: "until_refresh" | "until_cycle_end" | "persistent";
  readonly stackingPolicy: "add" | "highest" | "refresh";
}

export type TargetRef =
  | { readonly kind: "chosen_entity" }
  | { readonly kind: "chosen_friendly_entity" }
  | { readonly kind: "chosen_enemy_entity" }
  | {
      readonly kind: "chosen_enemy_entities";
      readonly minimum: number;
      readonly maximum: number;
    }
  | { readonly kind: "friendly_leader" }
  | { readonly kind: "enemy_leader" }
  | { readonly kind: "self" };

export type EffectNode =
  | {
      readonly op: "deal_damage";
      readonly target: TargetRef;
      readonly amount: number;
    }
  | { readonly op: "heal"; readonly target: TargetRef; readonly amount: number }
  | { readonly op: "draw"; readonly amount: number }
  | { readonly op: "shift"; readonly target: TargetRef }
  | { readonly op: "spawn"; readonly tokenCardId: string }
  | { readonly op: "salvage"; readonly cardType?: CardType }
  | { readonly op: "scout"; readonly amount: number }
  | { readonly op: "add_barrier"; readonly target: TargetRef }
  | {
      readonly op: "add_status";
      readonly target: TargetRef;
      readonly status: StatusDefinition;
    }
  | {
      readonly op: "choose_one";
      readonly options: readonly {
        readonly optionId: string;
        readonly effects: readonly EffectNode[];
      }[];
    }
  | {
      readonly op: "optional_focus";
      readonly amount: number;
      readonly effects: readonly EffectNode[];
    }
  | { readonly op: "cancel_previous_chain_link" };

export interface AbilityDefinition {
  readonly abilityId: string;
  readonly type:
    "activated" | "triggered" | "static" | "reaction" | "leader_command";
  readonly trigger?: string;
  readonly effects: readonly EffectNode[];
  readonly focusCost?: number;
  readonly timeCost?: number;
  readonly tempoDebt?: number;
  readonly oncePerCycle?: boolean;
}

export interface CardDefinition {
  readonly cardId: string;
  readonly revision: number;
  readonly name: string;
  readonly type: CardType;
  readonly aspects: readonly Aspect[];
  readonly setId?: string;
  readonly tags?: readonly string[];
  readonly rarity?: "common" | "uncommon" | "rare" | "unique";
  readonly collectorNumber?: string;
  readonly budgetScore?: number;
  readonly complexityScore?: number;
  readonly release?: {
    readonly state: "draft" | "staged" | "published" | "deprecated";
    readonly availableFrom?: string;
    readonly availableUntil?: string;
  };
  readonly focusCost: number;
  readonly playTime: number;
  readonly subtypes?: readonly string[];
  readonly keywords?: Readonly<Partial<Record<Keyword, number | true>>>;
  readonly power?: number;
  readonly vitality?: number;
  readonly presence?: number;
  readonly strikeTime?: number;
  readonly slotRestriction?: "any" | SlotId;
  readonly abilities?: readonly AbilityDefinition[];
  readonly generatedOnly?: boolean;
  readonly unique?: boolean;
  readonly deckLimit?: number;
  readonly prepareDiscount?: number;
  readonly staticModifiers?: {
    readonly power?: number;
    readonly presence?: number;
  };
  readonly deckRestriction?: {
    readonly requiredSubtype: string;
    readonly minimum: number;
  };
}

export interface FormatDefinition {
  readonly formatId: string;
  readonly revision: number;
  readonly deckSize: number;
  readonly maxCopies: number;
  readonly maxUniqueCopies: number;
  readonly minimumEntities: number;
  readonly legalSetIds?: readonly string[];
  readonly bannedCardIds?: readonly string[];
  readonly allowedReleaseStates?: readonly NonNullable<
    CardDefinition["release"]
  >["state"][];
  readonly effectiveDate?: string;
}

export interface ThemeManifest {
  readonly themeId: string;
  readonly revision: number;
  readonly gameId: string;
  readonly ruleset: string;
  readonly terms: Readonly<Record<string, string>>;
  readonly visuals: Readonly<Record<string, string>>;
  readonly eventPresentation: Readonly<
    Record<
      string,
      {
        readonly animation: string;
        readonly sound: string;
        readonly emphasis: "none" | "low" | "medium" | "high";
        readonly reducedMotion: string;
      }
    >
  >;
  readonly palette: Readonly<Record<string, string>>;
  readonly cardOverrides?: Readonly<
    Record<
      string,
      {
        readonly name?: string;
        readonly artId?: string;
        readonly frameVariant?: string;
      }
    >
  >;
}

export interface ContentPackManifest {
  readonly packId: string;
  readonly revision: number;
  readonly gameId: string;
  readonly ruleset: string;
  readonly setIds: readonly string[];
  readonly dependencies: readonly string[];
}

export interface ContentPackSource {
  readonly manifest: ContentPackManifest;
  readonly cards: readonly CardDefinition[];
}

export * from "./schemas.js";
