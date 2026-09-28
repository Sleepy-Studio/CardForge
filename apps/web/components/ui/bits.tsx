"use client";

import type { ReactNode } from "react";
import type { WalletBalance } from "@cardforge/economy";
import type { RankView } from "@/lib/types";

export function Wallets({
  wallets,
}: {
  readonly wallets: readonly WalletBalance[];
}) {
  const balance = (id: string) =>
    wallets.find((wallet) => wallet.currencyId === id)?.balance ?? 0;
  return (
    <div className="wallets" aria-label="Currencies">
      <span className="wallet wallet--shards" title="Shards craft cards">
        ◆ {balance("shards").toLocaleString()} <small>Shards</small>
      </span>
      <span
        className="wallet wallet--style"
        title="Style Tokens unlock cosmetics"
      >
        ✧ {balance("style_tokens").toLocaleString()} <small>Style Tokens</small>
      </span>
    </div>
  );
}

export function Meter({
  value,
  max,
  label,
}: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="meter"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

export function RankBadge({
  rank,
  rating,
}: {
  readonly rank: RankView;
  readonly rating: number;
}) {
  return (
    <div className={`rank-badge rank-badge--${rank.tierId}`}>
      <span className="rank-badge__gem" aria-hidden="true" />
      <div>
        <strong>{rank.label}</strong>
        <small>{rating} rating</small>
        {rank.nextAt !== null ? (
          <Meter
            label={`Progress to next rank`}
            max={100}
            value={Math.round(rank.progress * 100)}
          />
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {children}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDuration(
  startIso: string | null,
  endIso: string | null,
): string {
  if (!startIso || !endIso) return "—";
  const seconds = Math.max(
    0,
    Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1_000),
  );
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function timeLeft(iso: string, nowMs = Date.now()): string {
  const ms = Math.max(0, Date.parse(iso) - nowMs);
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)}d left`;
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}
