import type {
  Aspect,
  CardDefinition,
  ThemeManifest,
} from "@cardforge/card-schema";

/*
 * Presentation asset hooks. Theme Packs name asset families semantically
 * (ThemeManifest.visuals and cardOverrides.artId); this resolver turns those
 * IDs into URLs under /themes/<themeId>/ when the deployment provides files,
 * and otherwise returns null so components render procedural fallback art.
 * Nothing here can affect rules: the engine never sees presentation data.
 *
 * To ship real art, add files and list them in public/themes/<themeId>/assets.json:
 *   { "cardArt": { "entity.linebreaker": "cards/linebreaker.webp" },
 *     "leaderPortrait": { … }, "board": { "default": "board.webp" },
 *     "cardBack": { … }, "frame": { … }, "icon": { … }, "vfx": { … },
 *     "audio": { … }, "music": { … } }
 */

export type AssetKind =
  | "cardArt"
  | "leaderPortrait"
  | "board"
  | "cardBack"
  | "frame"
  | "icon"
  | "vfx"
  | "audio"
  | "music";

export type AssetManifest = Partial<
  Record<AssetKind, Readonly<Record<string, string>>>
>;

const manifests = new Map<string, Promise<AssetManifest>>();

export function loadAssetManifest(themeId: string): Promise<AssetManifest> {
  let manifest = manifests.get(themeId);
  if (!manifest) {
    manifest = fetch(`/themes/${themeId}/assets.json`)
      .then((response) =>
        response.ok ? (response.json() as Promise<AssetManifest>) : {},
      )
      .catch(() => ({}));
    manifests.set(themeId, manifest);
  }
  return manifest;
}

export function resolveAsset(
  theme: ThemeManifest,
  manifest: AssetManifest,
  kind: AssetKind,
  key: string,
): string | null {
  const path = manifest[kind]?.[key];
  return path ? `/themes/${theme.themeId}/${path}` : null;
}

/** Art key for a card, honouring a Theme Pack's per-card artId override. */
export function cardArtKey(theme: ThemeManifest, card: CardDefinition): string {
  return theme.cardOverrides?.[card.cardId]?.artId ?? card.cardId;
}

const aspectHue: Readonly<Record<Aspect, number>> = {
  force: 352,
  bastion: 205,
  motion: 162,
  growth: 110,
  cunning: 268,
  entropy: 30,
  neutral: 215,
};

/** Deterministic procedural art used whenever no file is provided. */
export function fallbackArt(
  card: Pick<CardDefinition, "cardId" | "aspects">,
): string {
  let hash = 0;
  for (const char of card.cardId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const primary = aspectHue[card.aspects[0] ?? "neutral"];
  const secondary = card.aspects[1]
    ? aspectHue[card.aspects[1]]
    : (primary + 40) % 360;
  const angle = hash % 360;
  const x = 20 + (hash % 60);
  const y = 20 + ((hash >> 8) % 60);
  return [
    `radial-gradient(circle at ${x}% ${y}%, hsla(${primary}, 85%, 62%, 0.55), transparent 55%)`,
    `radial-gradient(circle at ${100 - x}% ${100 - y}%, hsla(${secondary}, 80%, 55%, 0.35), transparent 60%)`,
    `linear-gradient(${angle}deg, hsl(${primary}, 45%, 14%), hsl(${secondary}, 40%, 9%))`,
  ].join(", ");
}
