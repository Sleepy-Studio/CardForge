import type { PlayerId } from "@cardforge/card-schema";
import type { Command } from "@cardforge/rules-kernel";
import { z } from "zod";

const identifier = z.string().min(1).max(120);
const front = z.enum(["left", "center", "right"]);
const slot = z.enum(["vanguard", "support"]);

export const clientIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("mulligan"),
      instanceIds: z.array(identifier).max(9),
    })
    .strict(),
  z
    .object({
      type: z.literal("resolve_choice"),
      choiceId: identifier,
      optionIds: z.array(identifier).max(8),
    })
    .strict(),
  z.object({ type: z.literal("pass_response") }).strict(),
  z
    .object({ type: z.literal("play_reaction"), instanceId: identifier })
    .strict(),
  z
    .object({
      type: z.literal("play_card"),
      instanceId: identifier,
      front: front.optional(),
      slot: slot.optional(),
      targetId: identifier.optional(),
      targetIds: z.array(identifier).max(8).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("prepare_card"), instanceId: identifier })
    .strict(),
  z
    .object({
      type: z.literal("activate_ability"),
      sourceId: identifier,
      abilityId: identifier,
      targetId: identifier.optional(),
      targetIds: z.array(identifier).max(8).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("strike"),
      attackerId: identifier,
      targetId: identifier,
    })
    .strict(),
  z
    .object({
      type: z.literal("shift"),
      entityId: identifier,
      toFront: front,
      toSlot: slot,
    })
    .strict(),
  z.object({ type: z.literal("pass") }).strict(),
]);

export type ClientIntent = z.infer<typeof clientIntentSchema>;

export function commandFromIntent(
  playerId: PlayerId,
  intent: ClientIntent,
): Command {
  switch (intent.type) {
    case "mulligan":
      return { ...intent, playerId };
    case "resolve_choice":
      return { ...intent, playerId };
    case "pass_response":
      return { ...intent, playerId };
    case "play_reaction":
      return { ...intent, playerId };
    case "play_card":
      return {
        type: intent.type,
        playerId,
        instanceId: intent.instanceId,
        ...(intent.front === undefined ? {} : { front: intent.front }),
        ...(intent.slot === undefined ? {} : { slot: intent.slot }),
        ...(intent.targetId === undefined ? {} : { targetId: intent.targetId }),
        ...(intent.targetIds === undefined
          ? {}
          : { targetIds: intent.targetIds }),
      };
    case "prepare_card":
      return { ...intent, playerId };
    case "activate_ability":
      return {
        type: intent.type,
        playerId,
        sourceId: intent.sourceId,
        abilityId: intent.abilityId,
        ...(intent.targetId === undefined ? {} : { targetId: intent.targetId }),
        ...(intent.targetIds === undefined
          ? {}
          : { targetIds: intent.targetIds }),
      };
    case "strike":
      return { ...intent, playerId };
    case "shift":
      return { ...intent, playerId };
    case "pass":
      return { ...intent, playerId };
  }
}
