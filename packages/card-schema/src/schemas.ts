import { z } from "zod";

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._@-]{1,119}$/);
export const aspectSchema = z.enum([
  "force",
  "bastion",
  "motion",
  "growth",
  "cunning",
  "entropy",
  "neutral",
]);
export const cardTypeSchema = z.enum([
  "leader",
  "entity",
  "tactic",
  "reaction",
  "attachment",
  "relic",
  "site",
  "token",
]);
const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chosen_entity") }).strict(),
  z.object({ kind: z.literal("chosen_friendly_entity") }).strict(),
  z.object({ kind: z.literal("chosen_enemy_entity") }).strict(),
  z
    .object({
      kind: z.literal("chosen_enemy_entities"),
      minimum: z.number().int().nonnegative(),
      maximum: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("friendly_leader") }).strict(),
  z.object({ kind: z.literal("enemy_leader") }).strict(),
  z.object({ kind: z.literal("self") }).strict(),
]);
const statusSchema = z
  .object({
    statusId: z.enum(["stunned", "rooted", "silenced", "exposed", "protected"]),
    value: z.number().int().nonnegative(),
    duration: z.enum(["until_refresh", "until_cycle_end", "persistent"]),
    stackingPolicy: z.enum(["add", "highest", "refresh"]),
  })
  .strict();

type EffectInput = { readonly op: string; readonly [key: string]: unknown };
export const effectNodeSchema: z.ZodType<EffectInput> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z
      .object({
        op: z.literal("deal_damage"),
        target: targetSchema,
        amount: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        op: z.literal("heal"),
        target: targetSchema,
        amount: z.number().int().positive(),
      })
      .strict(),
    z
      .object({ op: z.literal("draw"), amount: z.number().int().positive() })
      .strict(),
    z.object({ op: z.literal("shift"), target: targetSchema }).strict(),
    z.object({ op: z.literal("spawn"), tokenCardId: identifier }).strict(),
    z
      .object({ op: z.literal("salvage"), cardType: cardTypeSchema.optional() })
      .strict(),
    z
      .object({ op: z.literal("scout"), amount: z.number().int().positive() })
      .strict(),
    z.object({ op: z.literal("add_barrier"), target: targetSchema }).strict(),
    z
      .object({
        op: z.literal("add_status"),
        target: targetSchema,
        status: statusSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("choose_one"),
        options: z
          .array(
            z
              .object({
                optionId: identifier,
                effects: z.array(effectNodeSchema).max(16),
              })
              .strict(),
          )
          .min(2)
          .max(3),
      })
      .strict(),
    z
      .object({
        op: z.literal("optional_focus"),
        amount: z.number().int().positive(),
        effects: z.array(effectNodeSchema).max(16),
      })
      .strict(),
    z.object({ op: z.literal("cancel_previous_chain_link") }).strict(),
  ]),
);

export const abilityDefinitionSchema = z
  .object({
    abilityId: identifier,
    type: z.enum([
      "activated",
      "triggered",
      "static",
      "reaction",
      "leader_command",
    ]),
    trigger: identifier.optional(),
    effects: z.array(effectNodeSchema).max(16),
    focusCost: z.number().int().nonnegative().optional(),
    timeCost: z.number().int().nonnegative().optional(),
    tempoDebt: z.number().int().nonnegative().optional(),
    oncePerCycle: z.boolean().optional(),
  })
  .strict();

export const cardDefinitionSchema = z
  .object({
    cardId: identifier,
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    type: cardTypeSchema,
    aspects: z.array(aspectSchema).min(1).max(7),
    setId: identifier.optional(),
    tags: z.array(identifier).max(20).optional(),
    rarity: z.enum(["common", "uncommon", "rare", "unique"]).optional(),
    collectorNumber: z.string().trim().min(1).max(20).optional(),
    budgetScore: z.number().nonnegative().optional(),
    complexityScore: z.number().nonnegative().optional(),
    release: z
      .object({
        state: z.enum(["draft", "staged", "published", "deprecated"]),
        availableFrom: z.string().date().optional(),
        availableUntil: z.string().date().optional(),
      })
      .strict()
      .optional(),
    focusCost: z.number().int().nonnegative().max(99),
    playTime: z.number().int().nonnegative().max(99),
    subtypes: z.array(identifier).max(20).optional(),
    keywords: z
      .partialRecord(
        z.enum(["armor", "barrier", "ranged", "rapid", "structure", "mobile"]),
        z.union([z.number().int().nonnegative(), z.literal(true)]),
      )
      .optional(),
    power: z.number().int().nonnegative().optional(),
    vitality: z.number().int().positive().optional(),
    presence: z.number().int().nonnegative().optional(),
    strikeTime: z.number().int().positive().optional(),
    slotRestriction: z.enum(["any", "vanguard", "support"]).optional(),
    abilities: z.array(abilityDefinitionSchema).max(8).optional(),
    generatedOnly: z.boolean().optional(),
    unique: z.boolean().optional(),
    deckLimit: z.number().int().positive().optional(),
    prepareDiscount: z.number().int().nonnegative().optional(),
    staticModifiers: z
      .object({
        power: z.number().int().optional(),
        presence: z.number().int().optional(),
      })
      .strict()
      .optional(),
    deckRestriction: z
      .object({
        requiredSubtype: identifier,
        minimum: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const contentPackManifestSchema = z
  .object({
    packId: identifier,
    revision: z.number().int().positive(),
    gameId: identifier,
    ruleset: identifier,
    setIds: z.array(identifier).min(1),
    dependencies: z.array(identifier).max(20),
  })
  .strict();

const eventPresentationSchema = z
  .object({
    animation: identifier,
    sound: identifier,
    emphasis: z.enum(["none", "low", "medium", "high"]),
    reducedMotion: identifier,
  })
  .strict();

export const themeManifestSchema = z
  .object({
    themeId: identifier,
    revision: z.number().int().positive(),
    gameId: identifier,
    ruleset: identifier,
    terms: z.record(z.string(), z.string().trim().min(1)),
    visuals: z.record(z.string(), identifier),
    eventPresentation: z.record(z.string(), eventPresentationSchema),
    palette: z.record(z.string(), z.string().trim().min(1)),
    cardOverrides: z
      .record(
        identifier,
        z
          .object({
            name: z.string().trim().min(1).max(100).optional(),
            artId: identifier.optional(),
            frameVariant: identifier.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const contentPackSourceSchema = z
  .object({
    manifest: contentPackManifestSchema,
    cards: z.array(cardDefinitionSchema).min(1),
  })
  .strict();
