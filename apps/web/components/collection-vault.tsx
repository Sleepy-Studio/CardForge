"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { craftCosts, maximumOwnedCopies } from "@cardforge/economy";
import type { CosmeticDefinition, EconomySnapshot } from "@cardforge/economy";
import { proofCards } from "@cardforge/rules-tempofront";
import type { Aspect, CardType } from "@cardforge/card-schema";
import { useGameTheme } from "./theme-provider";

const collectibleCards = proofCards.filter(
  (card) => card.type !== "leader" && !card.generatedOnly,
);

type TypeFilter = "all" | Exclude<CardType, "leader" | "token">;
type AspectFilter = "all" | Aspect;

export function CollectionVault() {
  const { theme, term } = useGameTheme();
  const endpoint =
    process.env.NEXT_PUBLIC_MATCH_SERVER_URL ?? "http://localhost:2567";
  const [accountId, setAccountId] = useState("browser-alpha");
  const [snapshot, setSnapshot] = useState<EconomySnapshot | null>(null);
  const [cosmetics, setCosmetics] = useState<readonly CosmeticDefinition[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [aspectFilter, setAspectFilter] = useState<AspectFilter>("all");
  const [status, setStatus] = useState("Connecting to the collection ledger…");
  const [busyId, setBusyId] = useState<string | null>(null);

  const headers = useMemo(
    () => ({
      "content-type": "application/json",
      "x-cardforge-account-id": accountId,
    }),
    [accountId],
  );

  const load = useCallback(async () => {
    setStatus("Synchronizing authoritative inventory…");
    const accountResponse = await fetch(
      `${endpoint}/api/accounts/${accountId}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ displayName: "Launch Collector" }),
      },
    );
    if (!accountResponse.ok) throw new Error("Account could not be prepared.");
    const [economyResponse, cosmeticResponse] = await Promise.all([
      fetch(`${endpoint}/api/accounts/${accountId}/economy`, { headers }),
      fetch(`${endpoint}/api/cosmetics`),
    ]);
    if (!economyResponse.ok || !cosmeticResponse.ok)
      throw new Error("Collection service is unavailable.");
    const economyPayload = (await economyResponse.json()) as {
      snapshot: EconomySnapshot;
    };
    const cosmeticPayload = (await cosmeticResponse.json()) as {
      cosmetics: CosmeticDefinition[];
    };
    setSnapshot(economyPayload.snapshot);
    setCosmetics(cosmeticPayload.cosmetics);
    window.localStorage.setItem("cardforge.alpha.account", accountId);
    setStatus("Inventory verified by the server");
  }, [accountId, endpoint, headers]);

  useEffect(() => {
    const stored = window.localStorage.getItem("cardforge.alpha.account");
    if (stored && stored !== accountId) {
      setAccountId(stored);
      return;
    }
    void load().catch((error) =>
      setStatus(error instanceof Error ? error.message : "Sync failed."),
    );
  }, [accountId, load]);

  const owned = useMemo(
    () => new Map(snapshot?.cards.map((card) => [card.cardId, card.quantity])),
    [snapshot],
  );
  const entitlements = useMemo(
    () =>
      new Set(snapshot?.entitlements.map((item) => item.entitlementId) ?? []),
    [snapshot],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return collectibleCards.filter((card) => {
      const themedName = theme.cardOverrides?.[card.cardId]?.name ?? card.name;
      return (
        (typeFilter === "all" || card.type === typeFilter) &&
        (aspectFilter === "all" || card.aspects.includes(aspectFilter)) &&
        (!needle ||
          themedName.toLowerCase().includes(needle) ||
          card.cardId.includes(needle) ||
          card.tags?.some((tag) => tag.includes(needle)))
      );
    });
  }, [aspectFilter, query, theme.cardOverrides, typeFilter]);

  const transact = async (
    itemId: string,
    path: string,
    body: Record<string, unknown>,
  ) => {
    setBusyId(itemId);
    setStatus("Awaiting authoritative transaction…");
    try {
      const response = await fetch(
        `${endpoint}/api/accounts/${accountId}/economy/${path}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            transactionId: crypto.randomUUID(),
            ...body,
          }),
        },
      );
      const payload = (await response.json()) as {
        snapshot?: EconomySnapshot;
        message?: string;
      };
      if (!response.ok)
        throw new Error(payload.message ?? "Transaction rejected.");
      setSnapshot(payload.snapshot ?? null);
      setStatus("Transaction committed to the audit ledger");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      setBusyId(null);
    }
  };

  const shardBalance =
    snapshot?.wallets.find((wallet) => wallet.currencyId === "shards")
      ?.balance ?? 0;
  const styleBalance =
    snapshot?.wallets.find((wallet) => wallet.currencyId === "style_tokens")
      ?.balance ?? 0;
  const uniqueOwned = collectibleCards.filter(
    (card) => (owned.get(card.cardId) ?? 0) > 0,
  ).length;

  return (
    <main className="collection-shell">
      <header className="collection-header">
        <div>
          <p className="eyebrow">CARDFORGE // LAUNCH COLLECTION</p>
          <h1>Collection Vault</h1>
          <p>{status}</p>
        </div>
        <nav>
          <a className="button button--quiet" href="/">
            Match Lab
          </a>
          <a className="button button--quiet" href="/competitive">
            Competitive
          </a>
          <button
            className="button button--primary"
            onClick={() => void load()}
            type="button"
          >
            Sync
          </button>
        </nav>
      </header>

      <section className="collection-ledger" aria-label="Collection summary">
        <article>
          <span>SHARDS</span>
          <strong>{shardBalance.toLocaleString()}</strong>
          <small>direct crafting</small>
        </article>
        <article>
          <span>STYLE TOKENS</span>
          <strong>{styleBalance.toLocaleString()}</strong>
          <small>cosmetics only</small>
        </article>
        <article>
          <span>DISCOVERED</span>
          <strong>
            {uniqueOwned}/{collectibleCards.length}
          </strong>
          <small>
            {Math.round((uniqueOwned / collectibleCards.length) * 100)}%
          </small>
        </article>
        <label>
          <span>ACCOUNT NAMESPACE</span>
          <input
            onChange={(event) => setAccountId(event.target.value)}
            value={accountId}
          />
        </label>
      </section>

      <section className="collection-tools" aria-label="Card filters">
        <input
          aria-label="Search cards"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, tag, or semantic ID"
          value={query}
        />
        <select
          aria-label="Card type"
          onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
          value={typeFilter}
        >
          <option value="all">All card types</option>
          {["entity", "tactic", "reaction", "attachment", "relic", "site"].map(
            (type) => (
              <option key={type} value={type}>
                {term(type).toUpperCase()}
              </option>
            ),
          )}
        </select>
        <select
          aria-label="Aspect"
          onChange={(event) =>
            setAspectFilter(event.target.value as AspectFilter)
          }
          value={aspectFilter}
        >
          <option value="all">All Aspects</option>
          {[
            "force",
            "bastion",
            "motion",
            "growth",
            "cunning",
            "entropy",
            "neutral",
          ].map((aspect) => (
            <option key={aspect} value={aspect}>
              {aspect.toUpperCase()}
            </option>
          ))}
        </select>
        <strong>{filtered.length} CARDS</strong>
      </section>

      <section className="collection-grid" aria-label="Collectible cards">
        {filtered.map((card) => {
          const quantity = owned.get(card.cardId) ?? 0;
          const cap = maximumOwnedCopies(card);
          const cost = craftCosts[card.rarity!];
          return (
            <article
              className={`collection-card aspect-${card.aspects[0]}`}
              key={card.cardId}
            >
              <div className="collection-card__number">
                <span>#{card.collectorNumber}</span>
                <span>{card.rarity}</span>
              </div>
              <div className="collection-card__cost">{card.focusCost}</div>
              <h2>{theme.cardOverrides?.[card.cardId]?.name ?? card.name}</h2>
              <p>
                {card.aspects.join(" / ")} // {term(card.type)}
              </p>
              <dl>
                {card.type === "entity" ? (
                  <>
                    <div>
                      <dt>PWR</dt>
                      <dd>{card.power}</dd>
                    </div>
                    <div>
                      <dt>VIT</dt>
                      <dd>{card.vitality}</dd>
                    </div>
                    <div>
                      <dt>PRS</dt>
                      <dd>{card.presence}</dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>TIME</dt>
                    <dd>{card.playTime}</dd>
                  </div>
                )}
              </dl>
              <footer>
                <span>
                  OWNED {quantity}/{cap}
                </span>
                <button
                  disabled={
                    busyId !== null || quantity >= cap || shardBalance < cost
                  }
                  onClick={() =>
                    void transact(card.cardId, "craft", {
                      cardId: card.cardId,
                      quantity: 1,
                    })
                  }
                  type="button"
                >
                  {busyId === card.cardId ? "COMMITTING" : `CRAFT ${cost}`}
                </button>
              </footer>
            </article>
          );
        })}
      </section>

      <section className="cosmetic-market" aria-label="Cosmetic catalog">
        <div className="panel-heading">
          <span>COSMETIC ARMORY</span>
          <small>No stat upgrades. No marketplace.</small>
        </div>
        <div>
          {cosmetics.map((cosmetic) => {
            const unlocked = entitlements.has(cosmetic.cosmeticId);
            return (
              <article key={cosmetic.cosmeticId}>
                <span>{cosmetic.category.replace("_", " ")}</span>
                <strong>{cosmetic.name}</strong>
                <small>{cosmetic.themeId ?? "cross-theme"}</small>
                <button
                  disabled={
                    unlocked ||
                    busyId !== null ||
                    styleBalance < cosmetic.styleTokenCost
                  }
                  onClick={() =>
                    void transact(cosmetic.cosmeticId, "cosmetics", {
                      cosmeticId: cosmetic.cosmeticId,
                    })
                  }
                  type="button"
                >
                  {unlocked ? "UNLOCKED" : `${cosmetic.styleTokenCost} TOKENS`}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
