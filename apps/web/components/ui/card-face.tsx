"use client";

import { useEffect, useState } from "react";
import type { CardDefinition } from "@cardforge/card-schema";
import { glossaryById } from "@cardforge/rules-tempofront";
import {
  cardArtKey,
  fallbackArt,
  loadAssetManifest,
  resolveAsset,
  type AssetManifest,
} from "@/lib/assets";
import {
  aspectLabel,
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

export interface CardFaceProps {
  readonly card: CardDefinition;
  readonly size?: "sm" | "md" | "lg";
  /** Badge shown in the corner, e.g. "×2" in a deck or owned count. */
  readonly badge?: string;
  readonly dimmed?: boolean;
  readonly missing?: boolean;
  readonly selected?: boolean;
  readonly damage?: number;
}

/** DOM card rendering: text stays above art in priority (see spec.md). */
export function CardFace({
  card,
  size = "md",
  badge,
  dimmed,
  missing,
  selected,
  damage = 0,
}: CardFaceProps) {
  const { theme, term } = useGameTheme();
  const assets = useThemeAssets();
  const art = resolveAsset(
    theme,
    assets,
    card.type === "leader" ? "leaderPortrait" : "cardArt",
    cardArtKey(theme, card),
  );
  const name = theme.cardOverrides?.[card.cardId]?.name ?? card.name;
  const text = rulesTextFor(card, theme.terms);
  const chips = keywordChips(card);
  const isUnit = card.type === "entity" || card.type === "leader";
  return (
    <article
      aria-label={name}
      className={[
        "card-face",
        `card-face--${size}`,
        `card-face--${card.aspects[0] ?? "neutral"}`,
        card.rarity ? `rarity--${card.rarity}` : "",
        dimmed ? "is-dimmed" : "",
        missing ? "is-missing" : "",
        selected ? "is-selected" : "",
      ].join(" ")}
      data-card-id={card.cardId}
    >
      <header className="card-face__head">
        {card.type !== "leader" ? (
          <span
            className="card-face__cost"
            title={`${card.focusCost} ${term("focus")}`}
          >
            {card.focusCost}
          </span>
        ) : null}
        <strong className="card-face__name">{name}</strong>
        {card.type !== "leader" && card.playTime !== undefined ? (
          <span
            className="card-face__time"
            title={`${card.playTime} Time to play`}
          >
            {card.playTime}⧗
          </span>
        ) : null}
      </header>
      <div
        className="card-face__art"
        style={
          art
            ? { backgroundImage: `url(${art})` }
            : { background: fallbackArt(card) }
        }
      />
      <p className="card-face__type">
        {typeLabel[card.type]}
        {card.subtypes?.length ? ` — ${card.subtypes.join(", ")}` : ""}
        <span className="card-face__aspects">
          {card.aspects.map((aspect) => (
            <i
              className={`aspect-dot aspect-dot--${aspect}`}
              key={aspect}
              title={aspectLabel[aspect]}
            />
          ))}
        </span>
      </p>
      {size !== "sm" ? (
        <div className="card-face__body">
          {chips.length ? (
            <p className="card-face__keywords">
              {chips.map((chip) => (
                <TermTip entry={chip.entry} key={chip.label}>
                  {chip.label}
                </TermTip>
              ))}
            </p>
          ) : null}
          {text ? <p className="card-face__text">{text}</p> : null}
        </div>
      ) : null}
      {isUnit ? (
        <footer className="card-face__stats">
          {card.type === "entity" ? (
            <>
              <span title="Power">⚔ {card.power ?? 0}</span>
              <span title="Vitality">♥ {(card.vitality ?? 0) - damage}</span>
              <TermTip entry={glossaryById.get("victory.presence")}>
                ◆ {card.presence ?? 0}
              </TermTip>
            </>
          ) : (
            <span>
              {card.aspects.map((aspect) => aspectLabel[aspect]).join(" / ")}
            </span>
          )}
        </footer>
      ) : null}
      {badge ? <span className="card-face__badge">{badge}</span> : null}
      {missing ? <span className="card-face__missing">Not owned</span> : null}
    </article>
  );
}
