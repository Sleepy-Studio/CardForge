import type { CardDefinition, ThemeManifest } from "@cardforge/card-schema";

/*
 * Presentation asset hooks. Theme Packs name asset families semantically
 * (ThemeManifest.visuals and cardOverrides.artId); this resolver turns those
 * IDs into URLs under /themes/<themeId>/ when the deployment provides files,
 * and otherwise returns null so components use generated art (card-art.ts).
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
