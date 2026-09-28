import type { ThemeManifest } from "@cardforge/card-schema";
import { defaultTheme } from "@cardforge/theme-default";
import { orbitalTheme } from "@cardforge/theme-test-scifi";

/** Installed Theme Packs, keyed by themeId. */
export const themes = {
  aetherfront: defaultTheme,
  "orbital-conflict": orbitalTheme,
} as const satisfies Record<string, ThemeManifest>;

export type ThemeId = keyof typeof themes;

export const themeNames: Readonly<Record<ThemeId, string>> = {
  aetherfront: "Aetherfront",
  "orbital-conflict": "Orbital Conflict",
};

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && value in themes;
}

/** Bump when the generator's output changes so browsers refetch art. */
export const artRevision = 1;

/** URL of a card's generated illustration for a theme. */
export function generatedArtUrl(themeId: string, cardId: string): string {
  return `/art/${encodeURIComponent(themeId)}/${encodeURIComponent(cardId)}.svg?v=${artRevision}`;
}
