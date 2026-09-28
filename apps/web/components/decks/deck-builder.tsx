"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Aspect, CardDefinition } from "@cardforge/card-schema";
import type { OwnedCard } from "@cardforge/economy";
import { track } from "@/lib/analytics";
import { ApiError, messageFor, useApi } from "@/lib/api";
import {
  aspectLabel,
  aspects,
  cardMap,
  collectibleCards,
  countCards,
  deckErrors,
  deckSize,
  friendlyDeckError,
  leaderCards,
  leaderInfo,
  ownershipCap,
  starterDeckFor,
  typeLabel,
} from "@/lib/cards";
import { useRequireAccount } from "@/lib/session";
import type { CompetitiveView, DeckStatus, SavedDeck } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";
import { CardFace } from "../ui/card-face";
import { newDeckId } from "./deck-list";

type SortKey = "cost" | "name" | "rarity" | "number";
const rarityOrder = { common: 0, uncommon: 1, rare: 2, unique: 3 } as const;
const typeOrder = [
  "entity",
  "tactic",
  "reaction",
  "attachment",
  "relic",
  "site",
] as const;

const draftKey = (deckId: string) => `cardforge.deck-draft.${deckId}`;

interface Draft {
  readonly name: string;
  readonly leaderId: string;
  readonly cardIds: readonly string[];
}

function readDraft(deckId: string): Draft | null {
  try {
    return JSON.parse(
      window.localStorage.getItem(draftKey(deckId)) ?? "null",
    ) as Draft | null;
  } catch {
    return null;
  }
}

function writeDraft(deckId: string, draft: Draft | null): void {
  try {
    if (draft)
      window.localStorage.setItem(draftKey(deckId), JSON.stringify(draft));
    else window.localStorage.removeItem(draftKey(deckId));
  } catch {
    // Drafts are a convenience; storage may be unavailable.
  }
}

function withinIdentity(
  card: CardDefinition,
  leaderAspects: readonly Aspect[],
): boolean {
  return card.aspects.every(
    (aspect) => aspect === "neutral" || leaderAspects.includes(aspect),
  );
}

export function DeckBuilder({ deckId }: { readonly deckId: string }) {
  const account = useRequireAccount();
  const api = useApi();
  const router = useRouter();
  const isNew = deckId === "new";
  const decks = useApiData<{ decks: SavedDeck[] }>(
    account ? "/api/me/decks" : null,
  );
  const economy = useApiData<{ snapshot: { cards: OwnedCard[] } }>(
    account ? "/api/me/economy" : null,
  );
  const profile = useApiData<{ profile: CompetitiveView }>(
    account ? "/api/me/competitive-profile" : null,
  );

  const [name, setName] = useState("New deck");
  const [leaderId, setLeaderId] = useState(
    account?.onboarding.starterLeaderId ?? "leader.ember",
  );
  const [cardIds, setCardIds] = useState<readonly string[]>([]);
  const [loaded, setLoaded] = useState(isNew);
  const [search, setSearch] = useState("");
  const [aspectFilter, setAspectFilter] = useState<Aspect | "">("");
  const [typeFilter, setTypeFilter] = useState("");
  const [rarityFilter, setRarityFilter] = useState("");
  const [costFilter, setCostFilter] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [identityOnly, setIdentityOnly] = useState(true);
  const [sort, setSort] = useState<SortKey>("cost");
  const [inspect, setInspect] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<DeckStatus | null>(null);
  const [dirty, setDirty] = useState(false);

  const [restoredDraft, setRestoredDraft] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    if (!isNew && !decks.data) return;
    initialized.current = true;
    const deck = decks.data?.decks.find((item) => item.deckId === deckId);
    if (deck) {
      setName(deck.name);
      setLeaderId(deck.leaderId);
      setCardIds(deck.cardIds);
      setServerStatus(deck.status);
    }
    const draft = readDraft(deckId);
    if (
      draft &&
      (!deck ||
        JSON.stringify(draft.cardIds) !== JSON.stringify(deck.cardIds) ||
        draft.name !== deck.name ||
        draft.leaderId !== deck.leaderId)
    ) {
      setName(draft.name);
      setLeaderId(draft.leaderId);
      setCardIds(draft.cardIds);
      setServerStatus(null);
      setDirty(true);
      setRestoredDraft(true);
    }
    setLoaded(true);
  }, [deckId, decks.data, isNew]);

  useEffect(() => {
    if (dirty) writeDraft(deckId, { name, leaderId, cardIds });
  }, [cardIds, deckId, dirty, leaderId, name]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const owned = useMemo(
    () =>
      new Map(
        (economy.data?.snapshot.cards ?? []).map((card) => [
          card.cardId,
          card.quantity,
        ]),
      ),
    [economy.data],
  );
  const counts = useMemo(() => countCards(cardIds), [cardIds]);
  const leader = leaderInfo(leaderId);
  const errors = useMemo(
    () => deckErrors(leaderId, cardIds),
    [leaderId, cardIds],
  );
  const unlocked = profile.data?.profile.unlockedLeaderIds ?? [];
  const missing = [...counts.entries()].filter(
    ([cardId, count]) => count > (owned.get(cardId) ?? 0),
  );

  const pool = useMemo(() => {
    const query = search.trim().toLowerCase();
    return collectibleCards
      .filter(
        (card) =>
          !query ||
          card.name.toLowerCase().includes(query) ||
          (card.subtypes ?? []).some((s) => s.toLowerCase().includes(query)),
      )
      .filter((card) => !aspectFilter || card.aspects.includes(aspectFilter))
      .filter((card) => !typeFilter || card.type === typeFilter)
      .filter((card) => !rarityFilter || card.rarity === rarityFilter)
      .filter(
        (card) =>
          !costFilter ||
          (costFilter === "6"
            ? card.focusCost >= 6
            : card.focusCost === Number(costFilter)),
      )
      .filter((card) => !ownedOnly || (owned.get(card.cardId) ?? 0) > 0)
      .filter((card) => !identityOnly || withinIdentity(card, leader.aspects))
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "rarity")
          return (
            rarityOrder[b.rarity ?? "common"] -
              rarityOrder[a.rarity ?? "common"] || a.name.localeCompare(b.name)
          );
        if (sort === "number")
          return (
            Number(a.collectorNumber ?? 999) - Number(b.collectorNumber ?? 999)
          );
        return a.focusCost - b.focusCost || a.name.localeCompare(b.name);
      });
  }, [
    aspectFilter,
    costFilter,
    identityOnly,
    leader.aspects,
    owned,
    ownedOnly,
    rarityFilter,
    search,
    sort,
    typeFilter,
  ]);

  if (!account || !loaded) return <p className="loading-line">Loading deck…</p>;

  const change = (next: readonly string[]) => {
    setCardIds(next);
    setDirty(true);
    setServerStatus(null);
  };
  const add = (cardId: string) => {
    const card = cardMap.get(cardId);
    if (!card) return;
    if (cardIds.length >= deckSize) return;
    if ((counts.get(cardId) ?? 0) >= ownershipCap(card)) return;
    change([...cardIds, cardId]);
  };
  const remove = (cardId: string) => {
    const index = cardIds.lastIndexOf(cardId);
    if (index >= 0)
      change([...cardIds.slice(0, index), ...cardIds.slice(index + 1)]);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const targetId = isNew ? newDeckId() : deckId;
    try {
      const result = await api<{ deck: SavedDeck }>(
        `/api/me/decks/${encodeURIComponent(targetId)}`,
        {
          method: "PUT",
          body: { name: name.trim() || "Untitled deck", leaderId, cardIds },
        },
      );
      setServerStatus(result.deck.status);
      setDirty(false);
      writeDraft(deckId, null);
      setRestoredDraft(false);
      track(api, "deck_saved", {
        playable: result.deck.status.playable,
        cards: cardIds.length,
      });
      if (isNew) router.replace(`/decks/${encodeURIComponent(targetId)}`);
    } catch (caught) {
      setSaveError(
        caught instanceof ApiError && Array.isArray(caught.details)
          ? `${caught.message} ${(caught.details as string[]).slice(0, 2).map(friendlyDeckError).join(" ")}`
          : messageFor(caught),
      );
    } finally {
      setSaving(false);
    }
  };

  const grouped = typeOrder
    .map((type) => ({
      type,
      entries: [...counts.entries()]
        .map(([cardId, count]) => ({ card: cardMap.get(cardId)!, count }))
        .filter((entry) => entry.card?.type === type)
        .sort(
          (a, b) =>
            a.card.focusCost - b.card.focusCost ||
            a.card.name.localeCompare(b.card.name),
        ),
    }))
    .filter((group) => group.entries.length);
  const curve = Array.from(
    { length: 7 },
    (_, cost) =>
      cardIds.filter((id) => {
        const focus = cardMap.get(id)?.focusCost ?? 0;
        return cost === 6 ? focus >= 6 : focus === cost;
      }).length,
  );
  const inspected = inspect ? cardMap.get(inspect) : undefined;

  return (
    <div
      className="builder"
      data-deck-size={cardIds.length}
      data-legal={errors.length === 0}
    >
      <section className="builder-pool" aria-label="Card pool">
        <div className="builder-filters">
          <input
            aria-label="Search cards"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search cards"
            value={search}
          />
          <select
            aria-label="Aspect"
            onChange={(event) =>
              setAspectFilter(event.target.value as Aspect | "")
            }
            value={aspectFilter}
          >
            <option value="">All Aspects</option>
            {aspects.map((aspect) => (
              <option key={aspect} value={aspect}>
                {aspectLabel[aspect]}
              </option>
            ))}
          </select>
          <select
            aria-label="Card type"
            onChange={(event) => setTypeFilter(event.target.value)}
            value={typeFilter}
          >
            <option value="">All types</option>
            {typeOrder.map((type) => (
              <option key={type} value={type}>
                {typeLabel[type]}
              </option>
            ))}
          </select>
          <select
            aria-label="Rarity"
            onChange={(event) => setRarityFilter(event.target.value)}
            value={rarityFilter}
          >
            <option value="">All rarities</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="unique">Unique</option>
          </select>
          <select
            aria-label="Cost"
            onChange={(event) => setCostFilter(event.target.value)}
            value={costFilter}
          >
            <option value="">Any cost</option>
            {[0, 1, 2, 3, 4, 5].map((cost) => (
              <option key={cost} value={String(cost)}>
                {cost} Focus
              </option>
            ))}
            <option value="6">6+ Focus</option>
          </select>
          <select
            aria-label="Sort by"
            onChange={(event) => setSort(event.target.value as SortKey)}
            value={sort}
          >
            <option value="cost">Sort: cost</option>
            <option value="name">Sort: name</option>
            <option value="rarity">Sort: rarity</option>
            <option value="number">Sort: collector #</option>
          </select>
          <label className="check">
            <input
              checked={ownedOnly}
              onChange={(event) => setOwnedOnly(event.target.checked)}
              type="checkbox"
            />{" "}
            Owned only
          </label>
          <label className="check">
            <input
              checked={identityOnly}
              onChange={(event) => setIdentityOnly(event.target.checked)}
              type="checkbox"
            />{" "}
            Fits {leader.name}
          </label>
        </div>
        <p className="muted small">
          {pool.length} cards · tap to add, right-click or long-press to inspect
        </p>
        <ul className="pool-grid">
          {pool.map((card) => {
            const have = owned.get(card.cardId) ?? 0;
            const inDeck = counts.get(card.cardId) ?? 0;
            const outside = !withinIdentity(card, leader.aspects);
            const full =
              inDeck >= ownershipCap(card) || cardIds.length >= deckSize;
            return (
              <li key={card.cardId}>
                <button
                  aria-label={`Add ${card.name}`}
                  className="pool-card"
                  data-card={card.cardId}
                  disabled={outside || full}
                  onClick={() => add(card.cardId)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setInspect(card.cardId);
                  }}
                  onFocus={() => setInspect(card.cardId)}
                  onMouseEnter={() => setInspect(card.cardId)}
                  type="button"
                >
                  <CardFace
                    badge={`${inDeck}/${ownershipCap(card)}`}
                    card={card}
                    dimmed={outside}
                    missing={have === 0}
                    size="sm"
                  />
                  <span className="pool-card__owned">
                    {have ? `Owned ×${have}` : "Not owned"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <a className="builder-jump" href="#deck-panel">
        <span>
          Deck {cardIds.length}/{deckSize}
        </span>
        <span>{errors.length ? "Not legal yet" : "Legal"} ↓</span>
      </a>
      <aside className="builder-deck" aria-label="Deck" id="deck-panel">
        <div className="builder-deck__head">
          <input
            aria-label="Deck name"
            maxLength={60}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
            value={name}
          />
          <select
            aria-label="Leader"
            onChange={(event) => {
              setLeaderId(event.target.value);
              setDirty(true);
              setServerStatus(null);
            }}
            value={leaderId}
          >
            {leaderCards.map((card) => (
              <option key={card.cardId} value={card.cardId}>
                {card.name} ({leaderInfo(card.cardId).archetype})
                {unlocked.length && !unlocked.includes(card.cardId)
                  ? " — locked"
                  : ""}
              </option>
            ))}
          </select>
          <p className="muted small">
            {leader.aspects.map((aspect) => aspectLabel[aspect]).join(" · ")} —{" "}
            {leader.summary}
          </p>
          {unlocked.length && !unlocked.includes(leaderId) ? (
            <p className="warning small">
              This Leader is locked. You can build with it, but cannot queue
              until you reach a higher level.
            </p>
          ) : null}
        </div>
        {restoredDraft ? (
          <p className="notice small">
            Restored your unsaved changes.{" "}
            <button
              className="link-button"
              onClick={() => {
                writeDraft(deckId, null);
                window.location.reload();
              }}
              type="button"
            >
              Discard
            </button>
          </p>
        ) : null}
        <div
          className={`deck-counter ${cardIds.length === deckSize ? "is-full" : ""}`}
        >
          <strong>
            {cardIds.length}/{deckSize}
          </strong>
          <div className="curve" aria-label="Focus curve">
            {curve.map((count, cost) => (
              <span
                key={cost}
                style={{ height: `${Math.min(100, count * 8)}%` }}
                title={`${cost === 6 ? "6+" : cost} Focus: ${count}`}
              />
            ))}
          </div>
        </div>
        <ul className="legality" aria-label="Legality checks">
          {errors.length === 0 ? (
            <li className="is-ok">Legal for Standard</li>
          ) : (
            errors.slice(0, 4).map((error) => (
              <li className="is-bad" key={error}>
                {friendlyDeckError(error)}
              </li>
            ))
          )}
          {missing.length ? (
            <li className="is-warn">
              Missing{" "}
              {missing.reduce(
                (total, [id, count]) => total + count - (owned.get(id) ?? 0),
                0,
              )}{" "}
              card(s) — craft them in <Link href="/collection">Collection</Link>
            </li>
          ) : null}
        </ul>
        <div className="deck-cards">
          {grouped.map((group) => (
            <section key={group.type}>
              <h3>
                {typeLabel[group.type]} (
                {group.entries.reduce((total, entry) => total + entry.count, 0)}
                )
              </h3>
              <ul>
                {group.entries.map(({ card, count }) => {
                  const short = count > (owned.get(card.cardId) ?? 0);
                  return (
                    <li
                      className={`deck-line ${short ? "is-missing" : ""}`}
                      key={card.cardId}
                      onMouseEnter={() => setInspect(card.cardId)}
                    >
                      <span className="deck-line__cost">{card.focusCost}</span>
                      <span className="deck-line__name">{card.name}</span>
                      <span className="deck-line__count">×{count}</span>
                      <button
                        aria-label={`Remove one ${card.name}`}
                        className="icon-button"
                        onClick={() => remove(card.cardId)}
                        type="button"
                      >
                        −
                      </button>
                      <button
                        aria-label={`Add one ${card.name}`}
                        className="icon-button"
                        onClick={() => add(card.cardId)}
                        type="button"
                      >
                        +
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {!cardIds.length ? (
            <p className="muted">
              Tap cards on the left to add them, or start from the starter list.
            </p>
          ) : null}
        </div>
        <div className="builder-deck__actions">
          {saveError ? <p className="form-error">{saveError}</p> : null}
          {serverStatus ? (
            <p className={serverStatus.playable ? "success" : "warning"}>
              {serverStatus.playable
                ? "Saved — ready to play."
                : "Saved. Not playable yet: " +
                  (serverStatus.errors[0]
                    ? friendlyDeckError(serverStatus.errors[0])
                    : serverStatus.missing.length
                      ? "missing cards."
                      : "Leader locked.")}
            </p>
          ) : null}
          <button
            className="button button--primary button--wide"
            disabled={saving || errors.length > 0}
            onClick={() => void save()}
            type="button"
          >
            {saving
              ? "Saving…"
              : errors.length
                ? "Fix legality to save"
                : dirty || isNew
                  ? "Save deck"
                  : "Saved"}
          </button>
          <div className="action-row">
            <button
              className="button button--quiet button--small"
              onClick={() => {
                if (
                  !cardIds.length ||
                  window.confirm(
                    "Replace this list with the starter list for this Leader?",
                  )
                )
                  change(starterDeckFor(leaderId));
              }}
              type="button"
            >
              Reset to starter list
            </button>
            <button
              className="button button--quiet button--small"
              onClick={() => change([])}
              type="button"
            >
              Clear
            </button>
            <Link className="button button--quiet button--small" href="/decks">
              Back
            </Link>
          </div>
        </div>
        {inspected ? (
          <div className="builder-inspect">
            <CardFace card={inspected} size="lg" />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
