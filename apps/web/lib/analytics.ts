"use client";

import type { ApiFetch } from "./api";

export type ProductEvent =
  | "tutorial_started"
  | "tutorial_step"
  | "tutorial_completed"
  | "tutorial_abandoned"
  | "first_deck_selected"
  | "onboarding_skipped"
  | "practice_started"
  | "deck_saved"
  | "replay_opened";

/**
 * First-session analytics. Fire-and-forget: a failed beacon must never
 * disturb play. Match starts and completions are recorded server-side.
 */
export function track(
  api: ApiFetch,
  name: ProductEvent,
  properties: Readonly<Record<string, string | number | boolean>> = {},
): void {
  void api("/api/me/events", { body: { name, properties } }).catch(
    () => undefined,
  );
}
