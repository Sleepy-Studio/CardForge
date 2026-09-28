import type {
  CardDefinition,
  EffectNode,
  TargetRef,
} from "@cardforge/card-schema";
import { statusEntry } from "./glossary.js";

export interface RulesTextTerms {
  readonly focus: string;
  readonly entity: string;
  readonly leader: string;
  readonly discard: string;
}

const defaultTerms: RulesTextTerms = {
  focus: "Focus",
  entity: "Entity",
  leader: "Leader",
  discard: "discard",
};

function targetText(target: TargetRef, terms: RulesTextTerms): string {
  switch (target.kind) {
    case "chosen_entity":
      return `an ${terms.entity}`;
    case "chosen_friendly_entity":
      return `a friendly ${terms.entity}`;
    case "chosen_enemy_entity":
      return `an enemy ${terms.entity}`;
    case "chosen_enemy_entities":
      return target.minimum === target.maximum
        ? `${target.maximum} enemy ${terms.entity}s`
        : `up to ${target.maximum} enemy ${terms.entity}s`;
    case "friendly_leader":
      return `your ${terms.leader}`;
    case "enemy_leader":
      return `the enemy ${terms.leader}`;
    case "self":
      return "this";
  }
}

function sentence(text: string): string {
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

function effectText(effect: EffectNode, terms: RulesTextTerms): string {
  switch (effect.op) {
    case "deal_damage":
      return sentence(
        `deal ${effect.amount} damage to ${targetText(effect.target, terms)}`,
      );
    case "heal":
      return sentence(
        `heal ${targetText(effect.target, terms)} by ${effect.amount}`,
      );
    case "draw":
      return sentence(
        `draw ${effect.amount} card${effect.amount === 1 ? "" : "s"}`,
      );
    case "shift":
      return sentence(`shift ${targetText(effect.target, terms)}`);
    case "spawn":
      return `Spawn ${effect.tokenCardId}.`;
    case "salvage":
      return `Return ${effect.cardType ? `an ${effect.cardType}` : "a card"} from your ${terms.discard} to your hand.`;
    case "scout":
      return `Scout ${effect.amount}.`;
    case "add_barrier":
      return sentence(`give ${targetText(effect.target, terms)} Barrier`);
    case "add_status":
      return sentence(
        `give ${targetText(effect.target, terms)} ${statusEntry(effect.status.statusId)?.name ?? effect.status.statusId} ${effect.status.value}`,
      );
    case "optional_focus":
      return `You may pay ${effect.amount} ${terms.focus}. ${effect.effects
        .map((nested) => effectText(nested, terms))
        .join(" ")}`;
    case "choose_one":
      return `Choose one — ${effect.options
        .map(
          (option) =>
            `${option.optionId}: ${option.effects
              .map((nested) => effectText(nested, terms))
              .join(" ")}`,
        )
        .join("; ")}`;
    case "cancel_previous_chain_link":
      return "Cancel the previous chain link.";
  }
}

export function generateRulesText(
  definition: CardDefinition,
  terms: Partial<RulesTextTerms> = {},
): string {
  const resolvedTerms = { ...defaultTerms, ...terms };
  return (definition.abilities ?? [])
    .map((ability) => {
      const prefix =
        ability.type === "leader_command"
          ? "Command — "
          : ability.type === "reaction"
            ? "Reaction — "
            : ability.trigger === "on_deploy"
              ? "When deployed, "
              : ability.trigger === "on_defeat"
                ? "When defeated, "
                : "";
      const body = ability.effects
        .map((effect) => effectText(effect, resolvedTerms))
        .join(" ");
      const limit = ability.oncePerCycle ? " Once each Cycle." : "";
      return `${prefix}${body}${limit}`.trim();
    })
    .join("\n");
}
