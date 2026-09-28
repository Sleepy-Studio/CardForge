"use client";

import Link from "next/link";
import { leaderInfo } from "@/lib/cards";
import type { MatchHistoryEntry } from "@/lib/types";
import { formatDate, formatDuration } from "../ui/bits";

export const queueLabel: Readonly<Record<string, string>> = {
  casual: "Casual",
  ranked: "Ranked",
  friend: "Friend",
  practice: "Practice",
  pve: "Academy",
};

export const reasonLabel: Readonly<Record<string, string>> = {
  dominion: "Dominion",
  integrity: "Integrity",
  concession: "Concession",
  abandonment: "Abandoned",
};

export function MatchRow({
  entry,
  compact = false,
}: {
  readonly entry: MatchHistoryEntry;
  readonly compact?: boolean;
}) {
  const finished = entry.completedAt !== null;
  return (
    <li
      className={`match-row ${entry.result ? `is-${entry.result}` : ""}`}
      data-match={entry.matchId}
    >
      <span className="match-row__result">
        {entry.result === "win"
          ? "Win"
          : entry.result === "loss"
            ? "Loss"
            : "In progress"}
      </span>
      <span className="match-row__main">
        <strong>vs {entry.opponent?.displayName ?? "Unknown"}</strong>
        <small>
          {queueLabel[entry.queue ?? ""] ?? "Match"} ·{" "}
          {leaderInfo(entry.leaderId).name} vs{" "}
          {entry.opponent ? leaderInfo(entry.opponent.leaderId).name : "—"}
        </small>
      </span>
      {!compact ? (
        <>
          <span className="match-row__meta">
            <small>{entry.deckName ?? "—"}</small>
            <small>{formatDate(entry.startedAt)}</small>
          </span>
          <span className="match-row__meta">
            <small>{formatDuration(entry.startedAt, entry.completedAt)}</small>
            <small>
              {entry.cycles ?? "—"} Cycles ·{" "}
              {entry.reason ? reasonLabel[entry.reason] : "—"}
            </small>
          </span>
        </>
      ) : null}
      <span className="match-row__delta">
        {typeof entry.ratingDelta === "number" ? (
          <b className={entry.ratingDelta >= 0 ? "is-positive" : "is-negative"}>
            {entry.ratingDelta >= 0 ? "+" : ""}
            {entry.ratingDelta}
          </b>
        ) : null}
        {entry.reward?.shards ? <small>+{entry.reward.shards} ◆</small> : null}
      </span>
      {finished ? (
        <Link
          className="button button--quiet button--small"
          href={`/replay/${entry.matchId}`}
        >
          Replay
        </Link>
      ) : (
        <span />
      )}
    </li>
  );
}
