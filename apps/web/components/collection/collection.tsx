"use client";

import { useMemo, useState } from "react";
import type { Aspect, CardDefinition } from "@cardforge/card-schema";
import type { CosmeticDefinition, EconomySnapshot } from "@cardforge/economy";
import { messageFor, useApi } from "@/lib/api";
import {
  aspectLabel,
  aspects,
  collectibleCards,
  craftCost,
  ownershipCap,
  typeLabel,
} from "@/lib/cards";
import { useRequireAccount } from "@/lib/session";
import { useApiData } from "@/lib/use-api-data";
import { Meter, PageHeader, Wallets } from "../ui/bits";
import { CardFace } from "../ui/card-face";

type Ownership = "" | "owned" | "missing" | "playset" | "partial";

interface PendingCraft {
  readonly card: CardDefinition;
  readonly quantity: number;
  readonly cost: number;
  /** Idempotency key minted once per confirmation, so a double tap crafts once. */
  readonly transactionId: string;
}

export function Collection() {
  const account = useRequireAccount();
  const api = useApi();
  const economy = useApiData<{ snapshot: EconomySnapshot }>(
    account ? "/api/me/economy" : null,
  );
  const cosmetics = useApiData<{ cosmetics: CosmeticDefinition[] }>(
    "/api/cosmetics",
  );
  const [tab, setTab] = useState<"cards" | "cosmetics">("cards");
  const [search, setSearch] = useState("");
  const [aspect, setAspect] = useState<Aspect | "">("");
  const [type, setType] = useState("");
  const [rarity, setRarity] = useState("");
  const [ownership, setOwnership] = useState<Ownership>("");
  const [selected, setSelected] = useState<CardDefinition | null>(null);
  const [pending, setPending] = useState<PendingCraft | null>(null);
  const [pendingCosmetic, setPendingCosmetic] = useState<{
    cosmetic: CosmeticDefinition;
    transactionId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const snapshot = economy.data?.snapshot;
  const owned = useMemo(
    () =>
      new Map(
        (snapshot?.cards ?? []).map((card) => [card.cardId, card.quantity]),
      ),
    [snapshot],
  );
  const shards =
    snapshot?.wallets.find((wallet) => wallet.currencyId === "shards")
      ?.balance ?? 0;
  const styleTokens =
    snapshot?.wallets.find((wallet) => wallet.currencyId === "style_tokens")
      ?.balance ?? 0;
  const entitled = new Set(
    (snapshot?.entitlements ?? []).map((item) => item.entitlementId),
  );

  const cards = useMemo(() => {
    const query = search.trim().toLowerCase();
    return collectibleCards.filter((card) => {
      const have = owned.get(card.cardId) ?? 0;
      const cap = ownershipCap(card);
      if (query && !card.name.toLowerCase().includes(query)) return false;
      if (aspect && !card.aspects.includes(aspect)) return false;
      if (type && card.type !== type) return false;
      if (rarity && card.rarity !== rarity) return false;
      if (ownership === "owned" && have === 0) return false;
      if (ownership === "missing" && have > 0) return false;
      if (ownership === "playset" && have < cap) return false;
      if (ownership === "partial" && (have === 0 || have >= cap)) return false;
      return true;
    });
  }, [aspect, owned, ownership, rarity, search, type]);

  if (!account) return <p className="loading-line">Loading…</p>;
  const discovered = collectibleCards.filter(
    (card) => (owned.get(card.cardId) ?? 0) > 0,
  ).length;

  const requestCraft = (card: CardDefinition, quantity: number) => {
    const unit = craftCost(card) ?? 0;
    setMessage(null);
    setPending({
      card,
      quantity,
      cost: unit * quantity,
      transactionId: `craft:${crypto.randomUUID()}`,
    });
  };

  const confirmCraft = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await api<{ snapshot: EconomySnapshot }>(
        "/api/me/economy/craft",
        {
          body: {
            transactionId: pending.transactionId,
            cardId: pending.card.cardId,
            quantity: pending.quantity,
          },
        },
      );
      await economy.reload();
      void result;
      setMessage({
        tone: "ok",
        text: `Crafted ${pending.quantity}× ${pending.card.name}.`,
      });
      setPending(null);
    } catch (caught) {
      setMessage({ tone: "error", text: messageFor(caught) });
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const confirmCosmetic = async () => {
    if (!pendingCosmetic) return;
    setBusy(true);
    try {
      await api("/api/me/economy/cosmetics", {
        body: {
          transactionId: pendingCosmetic.transactionId,
          cosmeticId: pendingCosmetic.cosmetic.cosmeticId,
        },
      });
      await economy.reload();
      setMessage({
        tone: "ok",
        text: `Unlocked ${pendingCosmetic.cosmetic.name}.`,
      });
    } catch (caught) {
      setMessage({ tone: "error", text: messageFor(caught) });
    } finally {
      setPendingCosmetic(null);
      setBusy(false);
    }
  };

  const selectedHave = selected ? (owned.get(selected.cardId) ?? 0) : 0;
  const selectedCap = selected ? ownershipCap(selected) : 0;
  const selectedUnit = selected ? (craftCost(selected) ?? 0) : 0;

  return (
    <div className="collection-page">
      <PageHeader
        eyebrow="Collection"
        title="Your collection"
        actions={snapshot ? <Wallets wallets={snapshot.wallets} /> : null}
      >
        <p className="muted">
          {discovered}/{collectibleCards.length} cards discovered. Shards craft
          cards; Style Tokens unlock cosmetics. Trading is disabled.
        </p>
        <Meter
          label="Collection completion"
          max={collectibleCards.length}
          value={discovered}
        />
      </PageHeader>
      {message ? (
        <p
          className={message.tone === "ok" ? "success" : "form-error"}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
      <div
        className="segmented"
        role="tablist"
        aria-label="Collection sections"
      >
        <button
          aria-selected={tab === "cards"}
          onClick={() => setTab("cards")}
          role="tab"
          type="button"
        >
          Cards
        </button>
        <button
          aria-selected={tab === "cosmetics"}
          onClick={() => setTab("cosmetics")}
          role="tab"
          type="button"
        >
          Cosmetics
        </button>
      </div>

      {tab === "cards" ? (
        <div className="collection-layout">
          <section>
            <div className="builder-filters">
              <input
                aria-label="Search"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                value={search}
              />
              <select
                aria-label="Aspect"
                onChange={(event) =>
                  setAspect(event.target.value as Aspect | "")
                }
                value={aspect}
              >
                <option value="">All Aspects</option>
                {aspects.map((item) => (
                  <option key={item} value={item}>
                    {aspectLabel[item]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Type"
                onChange={(event) => setType(event.target.value)}
                value={type}
              >
                <option value="">All types</option>
                {(
                  [
                    "entity",
                    "tactic",
                    "reaction",
                    "attachment",
                    "relic",
                    "site",
                  ] as const
                ).map((item) => (
                  <option key={item} value={item}>
                    {typeLabel[item]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Rarity"
                onChange={(event) => setRarity(event.target.value)}
                value={rarity}
              >
                <option value="">All rarities</option>
                <option value="common">Common</option>
                <option value="uncommon">Uncommon</option>
                <option value="rare">Rare</option>
                <option value="unique">Unique</option>
              </select>
              <select
                aria-label="Ownership"
                onChange={(event) =>
                  setOwnership(event.target.value as Ownership)
                }
                value={ownership}
              >
                <option value="">Owned and missing</option>
                <option value="owned">Owned</option>
                <option value="missing">Missing</option>
                <option value="partial">Incomplete playset</option>
                <option value="playset">Complete playset</option>
              </select>
            </div>
            <ul className="pool-grid pool-grid--collection">
              {cards.map((card) => {
                const have = owned.get(card.cardId) ?? 0;
                const cap = ownershipCap(card);
                return (
                  <li key={card.cardId}>
                    <button
                      className="pool-card"
                      data-card={card.cardId}
                      onClick={() => setSelected(card)}
                      type="button"
                    >
                      <CardFace
                        badge={`${have}/${cap}`}
                        card={card}
                        missing={have === 0}
                        selected={selected?.cardId === card.cardId}
                        size="sm"
                      />
                      <span className="pool-card__owned">
                        {have >= cap
                          ? "Playset complete"
                          : `${craftCost(card) ?? "—"} ◆ to craft`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          <aside className="collection-detail" aria-label="Card detail">
            {selected ? (
              <>
                <CardFace
                  card={selected}
                  missing={selectedHave === 0}
                  size="lg"
                />
                <dl className="detail-list">
                  <div>
                    <dt>Owned</dt>
                    <dd>
                      {selectedHave} of {selectedCap}
                    </dd>
                  </div>
                  <div>
                    <dt>Rarity</dt>
                    <dd>
                      {selected.rarity
                        ? selected.rarity[0].toUpperCase() +
                          selected.rarity.slice(1)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Craft cost</dt>
                    <dd>{selectedUnit} Shards each</dd>
                  </div>
                </dl>
                {selectedHave < selectedCap ? (
                  <div className="action-row">
                    <button
                      className="button button--primary"
                      disabled={shards < selectedUnit}
                      onClick={() => requestCraft(selected, 1)}
                      type="button"
                    >
                      Craft 1
                    </button>
                    {selectedCap - selectedHave > 1 ? (
                      <button
                        className="button button--quiet"
                        disabled={
                          shards < selectedUnit * (selectedCap - selectedHave)
                        }
                        onClick={() =>
                          requestCraft(selected, selectedCap - selectedHave)
                        }
                        type="button"
                      >
                        Craft playset ({selectedCap - selectedHave})
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="success">You own the maximum usable copies.</p>
                )}
                {shards < selectedUnit && selectedHave < selectedCap ? (
                  <p className="muted small">
                    Not enough Shards. Earn more from matches, quests, and the
                    Academy.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="muted">
                Select a card to see details and craft it.
              </p>
            )}
          </aside>
        </div>
      ) : (
        <ul className="cosmetic-grid">
          {(cosmetics.data?.cosmetics ?? []).map((cosmetic) => {
            const has = entitled.has(cosmetic.cosmeticId);
            return (
              <li
                className={`cosmetic-tile ${has ? "is-owned" : ""}`}
                key={cosmetic.cosmeticId}
              >
                <span
                  className={`cosmetic-tile__swatch cosmetic-tile__swatch--${cosmetic.category}`}
                  aria-hidden="true"
                />
                <strong>{cosmetic.name}</strong>
                <small>{cosmetic.category.replace("_", " ")}</small>
                {has ? (
                  <span className="pill">Owned</span>
                ) : (
                  <button
                    className="button button--small"
                    disabled={styleTokens < cosmetic.styleTokenCost}
                    onClick={() =>
                      setPendingCosmetic({
                        cosmetic,
                        transactionId: `cosmetic:${crypto.randomUUID()}`,
                      })
                    }
                    type="button"
                  >
                    {cosmetic.styleTokenCost} ✧ Unlock
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pending ? (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="craft-title"
          >
            <h2 id="craft-title">
              Craft {pending.quantity}× {pending.card.name}?
            </h2>
            <p>
              Cost: <strong>{pending.cost} Shards</strong>. Balance after:{" "}
              {shards - pending.cost}.
            </p>
            <div className="action-row">
              <button
                className="button button--primary"
                disabled={busy}
                onClick={() => void confirmCraft()}
                type="button"
              >
                {busy ? "Crafting…" : "Confirm craft"}
              </button>
              <button
                className="button button--quiet"
                disabled={busy}
                onClick={() => setPending(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingCosmetic ? (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cosmetic-title"
          >
            <h2 id="cosmetic-title">Unlock {pendingCosmetic.cosmetic.name}?</h2>
            <p>
              Cost:{" "}
              <strong>
                {pendingCosmetic.cosmetic.styleTokenCost} Style Tokens
              </strong>
              . Balance after:{" "}
              {styleTokens - pendingCosmetic.cosmetic.styleTokenCost}.
            </p>
            <div className="action-row">
              <button
                className="button button--primary"
                disabled={busy}
                onClick={() => void confirmCosmetic()}
                type="button"
              >
                Unlock
              </button>
              <button
                className="button button--quiet"
                disabled={busy}
                onClick={() => setPendingCosmetic(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
