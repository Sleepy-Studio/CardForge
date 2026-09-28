"use client";

import { useCallback, useEffect, useState } from "react";
import type { CardDefinition } from "@cardforge/card-schema";
import { glossaryById } from "@cardforge/rules-tempofront";
import {
  cardArtKey,
  loadAssetManifest,
  resolveAsset,
  type AssetManifest,
} from "@/lib/assets";
import { generatedArtUrl } from "@/lib/themes";
import {
  aspectLabel,
  cardMap,
  keywordChips,
  rulesTextFor,
  typeLabel,
} from "@/lib/cards";
import { useGameTheme } from "../theme-provider";
import { TermTip } from "./term-tip";

const empty: AssetManifest = {};

export function useThemeAssets(): AssetManifest {
  const { theme } = useGameTheme();
  const [manifest, setManifest] = useState<AssetManifest>(empty);
  useEffect(() => {
    let active = true;
    void loadAssetManifest(theme.themeId).then(
      (loaded) => active && setManifest(loaded),
    );
    return () => {
      active = false;
    };
  }, [theme.themeId]);
  return manifest;
}

/**
 * Illustration URL for a card: the Theme Pack's own art when it ships some,
 * otherwise the generated illustration for this theme.
 */
export function useCardArt(): (cardId: string) => string {
  const { theme } = useGameTheme();
  const assets = useThemeAssets();
  return useCallback(
    (cardId: string) => {
      const card = cardMap.get(cardId);
      const own = card
        ? resolveAsset(
            theme,
            assets,
            card.type === "leader" ? "leaderPortrait" : "cardArt",
            cardArtKey(theme, card),
          )
        : null;
      return own ?? generatedArtUrl(theme.themeId, cardId);
    },
    [theme, assets],
  );
}

/** Board backdrop: Theme Pack art or the generated scene. */
export function useBoardArt(): string {
  const { theme } = useGameTheme();
  const assets = useThemeAssets();
  return (
    resolveAsset(theme, assets, "board", "default") ??
    generatedArtUrl(theme.themeId, "board")
  );
}

export interface CardFaceProps {
  readonly card: CardDefinition;
  readonly size?: "sm" | "md" | "lg";
  /** Badge shown in the corner, e.g. "×2" in a deck or owned count. */
  readonly badge?: string;
  readonly dimmed?: boolean;
  readonly missing?: boolean;
  readonly selected?: boolean;
  readonly damage?: number;
  /** No tooltip buttons: set when the card sits inside a button. */
  readonly plain?: boolean;
}

const rarityLabel: Readonly<Record<string, string>> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  unique: "Unique",
};

/** DOM card rendering: text stays above art in priority (see spec.md). */
export function CardFace({
  card,
  size = "md",
  badge,
  dimmed,
  missing,
  selected,
  damage = 0,
  plain = false,
}: CardFaceProps) {
  const { theme, term } = useGameTheme();
  const art = useCardArt()(card.cardId);
  const name = theme.cardOverrides?.[card.cardId]?.name ?? card.name;
  const text = rulesTextFor(card, theme.terms);
  const chips = keywordChips(card);
  const typeName =
    term(card.type) === card.type ? typeLabel[card.type] : term(card.type);
  const subtype = card.subtypes?.length ? card.subtypes.join(" · ") : null;
  // Small cards always sit inside buttons, so their terms stay plain.
  const plainTerms = plain || size === "sm";
  return (
    <article
      aria-label={name}
      className={[
        "card-face",
        `card-face--${size}`,
        `card-face--${card.aspects[0] ?? "neutral"}`,
        `card-face--type-${card.type}`,
        card.rarity ? `rarity--${card.rarity}` : "",
        dimmed ? "is-dimmed" : "",
        missing ? "is-missing" : "",
        selected ? "is-selected" : "",
      ].join(" ")}
      data-card-id={card.cardId}
    >
      <div
        className="card-face__art"
        style={{ backgroundImage: `url("${art}")` }}
      >
        {card.type !== "leader" ? (
          <span
            className="card-face__cost"
            title={`Costs ${card.focusCost} ${term("focus")}`}
          >
            {card.focusCost}
          </span>
        ) : null}
        {card.type !== "leader" && card.playTime !== undefined ? (
          <span
            className="card-face__time"
            title={`Takes ${card.playTime} Time to play`}
          >
            {card.playTime}
            <small>⧗</small>
          </span>
        ) : null}
        {badge ? <span className="card-face__badge">{badge}</span> : null}
        {missing ? <span className="card-face__missing">Not owned</span> : null}
      </div>
      <header className="card-face__head">
        <strong className="card-face__name">{name}</strong>
      </header>
      <p className="card-face__type">
        <span>
          {typeName}
          {subtype && size !== "sm" ? ` · ${subtype}` : ""}
        </span>
        <span className="card-face__aspects">
          {card.aspects.map((aspect) => (
            <i
              className={`aspect-dot aspect-dot--${aspect}`}
              key={aspect}
              title={aspectLabel[aspect]}
            />
          ))}
          {card.rarity ? (
            <i
              className={`rarity-gem rarity-gem--${card.rarity}`}
              title={rarityLabel[card.rarity] ?? card.rarity}
            />
          ) : null}
        </span>
      </p>
      {size !== "sm" ? (
        <div className="card-face__body">
          {chips.length ? (
            <p className="card-face__keywords">
              {chips.map((chip) =>
                plainTerms ? (
                  <span className="term-chip" key={chip.label}>
                    {chip.label}
                  </span>
                ) : (
                  <TermTip entry={chip.entry} key={chip.label}>
                    {chip.label}
                  </TermTip>
                ),
              )}
            </p>
          ) : null}
          {text ? <p className="card-face__text">{text}</p> : null}
        </div>
      ) : (
        <span className="card-face__spacer" />
      )}
      {card.type === "entity" ? (
        <footer className="card-face__stats">
          <span className="stat stat--power" title="Power">
            {card.power ?? 0}
          </span>
          {plainTerms ? (
            <span className="stat stat--presence" title="Presence">
              ◆{card.presence ?? 0}
            </span>
          ) : (
            <TermTip entry={glossaryById.get("victory.presence")}>
              <span className="stat stat--presence">◆{card.presence ?? 0}</span>
            </TermTip>
          )}
          <span
            className={`stat stat--vitality${damage ? " is-damaged" : ""}`}
            title="Vitality"
          >
            {(card.vitality ?? 0) - damage}
          </span>
        </footer>
      ) : card.type === "leader" ? (
        <footer className="card-face__stats card-face__stats--leader">
          <span>
            {card.aspects.map((aspect) => aspectLabel[aspect]).join(" / ")}
          </span>
        </footer>
      ) : null}
    </article>
  );
}
