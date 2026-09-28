"use client";

import { useState } from "react";
import { messageFor, useApi } from "@/lib/api";
import { useRequireAccount } from "@/lib/session";
import type { MatchHistoryEntry } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";
import { EmptyState, PageHeader } from "../ui/bits";
import { MatchRow } from "./match-row";

export function MatchHistory() {
  const account = useRequireAccount();
  const api = useApi();
  const first = useApiData<{ matches: MatchHistoryEntry[] }>(
    account ? "/api/me/matches" : null,
  );
  const [more, setMore] = useState<readonly MatchHistoryEntry[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [queue, setQueue] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!account) return <p className="loading-line">Loading…</p>;
  const all = [...(first.data?.matches ?? []), ...more];
  const shown = all.filter((entry) => !queue || entry.queue === queue);

  const loadMore = async () => {
    const last = all.at(-1);
    if (!last?.startedAt) return;
    try {
      const page = await api<{ matches: MatchHistoryEntry[] }>(
        `/api/me/matches?before=${encodeURIComponent(last.startedAt)}`,
      );
      setMore((current) => [...current, ...page.matches]);
      if (page.matches.length < 25) setExhausted(true);
    } catch (caught) {
      setError(messageFor(caught));
    }
  };

  return (
    <div className="history-page">
      <PageHeader eyebrow="Match history" title="Your matches">
        <p className="muted">
          Every finished match can be replayed exactly from the server&apos;s
          record.
        </p>
      </PageHeader>
      <label className="inline-field">
        <span>Show</span>
        <select
          onChange={(event) => setQueue(event.target.value)}
          value={queue}
        >
          <option value="">All modes</option>
          <option value="casual">Casual</option>
          <option value="ranked">Ranked</option>
          <option value="friend">Friend</option>
          <option value="practice">Practice</option>
        </select>
      </label>
      {first.error || error ? (
        <p className="form-error">{first.error ?? error}</p>
      ) : null}
      {shown.length ? (
        <ul className="match-list match-list--full">
          {shown.map((entry) => (
            <MatchRow entry={entry} key={entry.matchId} />
          ))}
        </ul>
      ) : first.data ? (
        <EmptyState title="No matches here yet" />
      ) : (
        <p className="loading-line">Loading…</p>
      )}
      {all.length >= 25 && !exhausted ? (
        <button
          className="button button--quiet"
          onClick={() => void loadMore()}
          type="button"
        >
          Load older matches
        </button>
      ) : null}
    </div>
  );
}
