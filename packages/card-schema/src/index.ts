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

export type TargetRef =
  | { readonly kind: "chosen_entity" }
  | { readonly kind: "chosen_friendly_entity" }
  | { readonly kind: "chosen_enemy_entity" }
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
}

export interface FormatDefinition {
  readonly formatId: string;
  readonly revision: number;
  readonly deckSize: number;
  readonly maxCopies: number;
  readonly maxUniqueCopies: number;
  readonly minimumEntities: number;
}

export interface ThemeManifest {
  readonly gameId: string;
  readonly ruleset: string;
  readonly terms: Readonly<Record<string, string>>;
  readonly visuals: Readonly<Record<string, string>>;
}
