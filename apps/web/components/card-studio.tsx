"use client";

import { useMemo, useState } from "react";
import {
  cardDefinitionSchema,
  type CardDefinition,
} from "@cardforge/card-schema";
import { coreSetSource } from "@cardforge/content-core-set";
import {
  compileContentPack,
  compilePresentation,
  renderCardSvg,
} from "@cardforge/content-tools";
import { generateRulesText } from "@cardforge/rules-tempofront";
import { useGameTheme } from "./theme-provider";

const workflow = [
  "Draft",
  "Design Review",
  "Rules Review",
  "Art Review",
  "QA",
  "Staged",
  "Published",
  "Deprecated",
] as const;

function changedFields(
  baseline: CardDefinition,
  draft: CardDefinition,
): readonly string[] {
  return Object.keys(draft).filter(
    (key) =>
      JSON.stringify(draft[key as keyof CardDefinition]) !==
      JSON.stringify(baseline[key as keyof CardDefinition]),
  );
}

export function CardStudio() {
  const { theme, term } = useGameTheme();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("entity.linebreaker");
  const [draftText, setDraftText] = useState(() =>
    JSON.stringify(
      coreSetSource.cards.find((card) => card.cardId === "entity.linebreaker"),
      null,
      2,
    ),
  );
  const [publicationState, setPublicationState] =
    useState<(typeof workflow)[number]>("Draft");
  const [validationMessage, setValidationMessage] = useState(
    "Draft matches published revision.",
  );

  const pack = useMemo(() => compileContentPack(coreSetSource), []);
  const presentation = useMemo(
    () => compilePresentation(pack, theme),
    [pack, theme],
  );
  const baseline = coreSetSource.cards.find(
    (card) => card.cardId === selectedId,
  )!;
  const parsed = cardDefinitionSchema.safeParse(
    (() => {
      try {
        return JSON.parse(draftText) as unknown;
      } catch {
        return null;
      }
    })(),
  );
  const draft = parsed.success ? (parsed.data as CardDefinition) : baseline;
  const changes = parsed.success ? changedFields(baseline, draft) : [];
  const filteredCards = coreSetSource.cards.filter(
    (card) =>
      !query ||
      `${card.name} ${card.cardId} ${card.type}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const rulesTerms = {
    focus: term("focus"),
    entity: term("entity"),
    leader: term("leader"),
    discard: term("discard"),
  };
  const svg = renderCardSvg(draft, theme);
  const selectCard = (card: CardDefinition) => {
    setSelectedId(card.cardId);
    setDraftText(JSON.stringify(card, null, 2));
    setPublicationState(
      card.release?.state === "published" ? "Published" : "Draft",
    );
    setValidationMessage("Draft matches published revision.");
  };
  const validateDraft = () => {
    if (!parsed.success) {
      setValidationMessage(
        parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(" // "),
      );
      return;
    }
    try {
      compileContentPack({
        ...coreSetSource,
        cards: coreSetSource.cards.map((card) =>
          card.cardId === selectedId ? parsed.data : card,
        ),
      });
      setValidationMessage(
        `Valid schema and engine graph. ${changes.length} changed field${changes.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : "Compilation failed.",
      );
    }
  };

  return (
    <main className="studio-shell" data-theme-id={theme.themeId}>
      <header className="studio-header">
        <div>
          <p className="eyebrow">CARDFORGE // CONTENT FACTORY</p>
          <h1>Card Studio</h1>
          <p>
            One semantic pack. Two complete presentations. Zero executable card
            scripts.
          </p>
        </div>
        <div className="studio-hashes">
          <span>GAMEPLAY {pack.gameplayHash.slice(0, 12)}</span>
          <span>PRESENTATION {presentation.presentationHash.slice(0, 12)}</span>
          <a className="button button--quiet" href="/lab">
            Match lab
          </a>
        </div>
      </header>

      <div className="studio-grid">
        <aside className="studio-library panel">
          <div className="panel-heading">
            <span>PACK LIBRARY</span>
            <small>
              {filteredCards.length}/{coreSetSource.cards.length}
            </small>
          </div>
          <input
            aria-label="Search cards"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ID, name, type…"
            value={query}
          />
          <div className="studio-card-list">
            {filteredCards.map((card) => (
              <button
                className={card.cardId === selectedId ? "is-active" : ""}
                key={card.cardId}
                onClick={() => selectCard(card)}
                type="button"
              >
                <span>{card.name}</span>
                <small>
                  {card.type} // r{card.revision}
                </small>
              </button>
            ))}
          </div>
        </aside>

        <section className="studio-editor panel">
          <div className="panel-heading">
            <span>STRUCTURED DEFINITION</span>
            <small>{parsed.success ? "schema valid" : "schema error"}</small>
          </div>
          <div className="studio-workflow" aria-label="Publication workflow">
            {workflow.map((state) => (
              <button
                className={publicationState === state ? "is-active" : ""}
                key={state}
                onClick={() => setPublicationState(state)}
                type="button"
              >
                {state}
              </button>
            ))}
          </div>
          <label className="studio-json-label">
            <span>Ability graph JSON</span>
            <textarea
              aria-label="Structured card definition"
              onChange={(event) => setDraftText(event.target.value)}
              spellCheck={false}
              value={draftText}
            />
          </label>
          <div className="studio-validation">
            <button
              className="button button--primary"
              onClick={validateDraft}
              type="button"
            >
              Validate draft
            </button>
            <p role="status">{validationMessage}</p>
          </div>
        </section>

        <aside className="studio-preview panel">
          <div className="panel-heading">
            <span>LIVE PREVIEW</span>
            <small>{theme.themeId}</small>
          </div>
          {/* The renderer XML-escapes every editable value before this data URL is built. */}
          <img
            alt={`Rendered preview of ${draft.name}`}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          />
          <section className="studio-rules">
            <h2>{draft.name}</h2>
            <p>{generateRulesText(draft, rulesTerms) || "Persistent asset."}</p>
          </section>
          <section className="studio-checks">
            <h3>Publication checks</h3>
            <ul>
              <li>Localization: generated</li>
              <li>Frame: {theme.visuals.cardFrames}</li>
              <li>Artwork: semantic fallback</li>
              <li>Token dependencies: compiled</li>
              <li>Scenario suite: engine regression</li>
            </ul>
          </section>
          <section className="studio-diff">
            <h3>Revision diff</h3>
            <p>
              {changes.length
                ? changes.join(" // ")
                : "No changes from immutable published revision."}
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
