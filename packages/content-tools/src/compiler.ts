import {
  contentPackSourceSchema,
  themeManifestSchema,
  type CardDefinition,
  type ContentPackSource,
  type EffectNode,
  type ThemeManifest,
} from "@cardforge/card-schema";
import { stateHash } from "@cardforge/rules-kernel";
import {
  generateRulesText,
  validateContentDefinitions,
} from "@cardforge/rules-tempofront";

const requiredTerms = [
  "leader",
  "entity",
  "focus",
  "integrity",
  "dominion",
  "front",
  "discard",
  "archive",
] as const;
const requiredVisuals = [
  "cardFrames",
  "boardScene",
  "iconSet",
  "animationMap",
  "audioMap",
] as const;
const requiredEvents = [
  "ENTITY_DEPLOYED",
  "ENTITY_SHIFTED",
  "STRIKE_STARTED",
  "DAMAGE_DEALT",
  "BARRIER_BROKEN",
  "ENTITY_DEFEATED",
  "LEADER_DAMAGED",
  "FRONT_CONTROL_CHANGED",
  "DOMINION_GAINED",
  "CARD_ARCHIVED",
] as const;
const requiredPalette = [
  "canvas",
  "panel",
  "primary",
  "secondary",
  "danger",
  "text",
] as const;

export interface CompiledCard {
  readonly definition: CardDefinition;
  readonly rulesText: string;
}

export interface CompiledContentPack {
  readonly source: ContentPackSource;
  readonly gameplayHash: string;
  readonly cards: readonly CompiledCard[];
}

function spawnedTokens(effects: readonly EffectNode[]): readonly string[] {
  return effects.flatMap((effect) => {
    if (effect.op === "spawn") return [effect.tokenCardId];
    if (effect.op === "optional_focus") return spawnedTokens(effect.effects);
    if (effect.op === "choose_one")
      return effect.options.flatMap((option) => spawnedTokens(option.effects));
    return [];
  });
}

export function validateTheme(input: unknown): ThemeManifest {
  const theme = themeManifestSchema.parse(input) as ThemeManifest;
  const missing = [
    ...requiredTerms.filter((key) => !theme.terms[key]),
    ...requiredVisuals.filter((key) => !theme.visuals[key]),
    ...requiredEvents.filter((key) => !theme.eventPresentation[key]),
    ...requiredPalette.filter((key) => !theme.palette[key]),
  ];
  if (missing.length)
    throw new Error(`Theme is incomplete: ${missing.join(", ")}`);
  return theme;
}

export function validatePackGraph(
  manifests: readonly ContentPackSource["manifest"][],
): void {
  const manifestsById = new Map(
    manifests.map((manifest) => [manifest.packId, manifest]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (packId: string): void => {
    if (visiting.has(packId))
      throw new Error(`Circular pack dependency at ${packId}`);
    if (visited.has(packId)) return;
    const manifest = manifestsById.get(packId);
    if (!manifest) throw new Error(`Missing pack dependency ${packId}`);
    visiting.add(packId);
    for (const dependency of manifest.dependencies) visit(dependency);
    visiting.delete(packId);
    visited.add(packId);
  };
  for (const manifest of manifests) visit(manifest.packId);
}

export function compileContentPack(input: unknown): CompiledContentPack {
  const source = contentPackSourceSchema.parse(input) as ContentPackSource;
  validatePackGraph([source.manifest]);
  const cardsById = new Map<string, CardDefinition>();
  for (const card of source.cards) {
    if (cardsById.has(card.cardId))
      throw new Error(`Duplicate semantic card ID ${card.cardId}`);
    if (!card.setId || !source.manifest.setIds.includes(card.setId))
      throw new Error(`${card.cardId} is outside the pack's declared sets`);
    cardsById.set(card.cardId, card);
  }
  validateContentDefinitions(cardsById);
  for (const card of source.cards)
    for (const tokenId of (card.abilities ?? []).flatMap((ability) =>
      spawnedTokens(ability.effects),
    )) {
      const token = cardsById.get(tokenId);
      if (!token?.generatedOnly)
        throw new Error(`${card.cardId} references missing Token ${tokenId}`);
    }
  return {
    source,
    gameplayHash: stateHash(source),
    cards: source.cards.map((definition) => ({
      definition,
      rulesText: generateRulesText(definition),
    })),
  };
}

export function compilePresentation(pack: CompiledContentPack, input: unknown) {
  const theme = validateTheme(input);
  if (
    theme.gameId !== pack.source.manifest.gameId ||
    theme.ruleset !== pack.source.manifest.ruleset
  )
    throw new Error("Theme is not compatible with this content pack");
  const cards = pack.cards.map(({ definition }) => ({
    cardId: definition.cardId,
    name: theme.cardOverrides?.[definition.cardId]?.name ?? definition.name,
    rulesText: generateRulesText(definition, {
      focus: theme.terms.focus!,
      entity: theme.terms.entity!,
      leader: theme.terms.leader!,
      discard: theme.terms.discard!,
    }),
    artId: theme.cardOverrides?.[definition.cardId]?.artId ?? definition.cardId,
    frameVariant:
      theme.cardOverrides?.[definition.cardId]?.frameVariant ??
      theme.visuals.cardFrames,
  }));
  return {
    theme,
    gameplayHash: pack.gameplayHash,
    presentationHash: stateHash({ theme, cards }),
    cards,
  };
}
