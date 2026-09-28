"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRequireAccount } from "@/lib/session";
import type { SavedDeck } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";
import { PageHeader } from "../ui/bits";
import { DeckPicker, deckProblem } from "./deck-picker";

interface InviteInfo {
  readonly code: string;
  readonly status: "open" | "claimed" | "started" | "expired";
  readonly expiresAt: string;
  readonly hostDisplayName: string;
  readonly role: "host" | "guest" | "visitor";
  readonly available: boolean;
}

export function JoinInvite({ code }: { readonly code: string }) {
  const account = useRequireAccount();
  const router = useRouter();
  const invite = useApiData<{ invite: InviteInfo }>(
    account ? `/api/invites/${encodeURIComponent(code)}` : null,
  );
  const decks = useApiData<{ decks: SavedDeck[] }>(
    account ? "/api/me/decks" : null,
  );
  const [deckId, setDeckId] = useState("");
  useEffect(() => {
    const list = decks.data?.decks ?? [];
    if (!deckId && list.length)
      setDeckId((list.find((deck) => !deckProblem(deck)) ?? list[0]).deckId);
  }, [deckId, decks.data]);

  if (!account || (invite.loading && !invite.data))
    return <p className="loading-line">Loading invite…</p>;
  if (invite.error || !invite.data)
    return (
      <section className="auth-card">
        <h1>Invite not found</h1>
        <p className="muted">
          The code {code} does not exist or was cancelled. Ask your friend for a
          new one.
        </p>
        <Link className="button button--primary" href="/play">
          Back to Play
        </Link>
      </section>
    );
  const info = invite.data.invite;
  const selected = decks.data?.decks.find((deck) => deck.deckId === deckId);
  const problem = selected ? deckProblem(selected) : "Choose a deck";
  if (!info.available)
    return (
      <section className="auth-card" data-invite-status={info.status}>
        <h1>
          {info.status === "expired"
            ? "This invite has expired"
            : "This invite has been used"}
        </h1>
        <p className="muted">
          Invites last 15 minutes and start one match. Ask{" "}
          {info.hostDisplayName} for a new code.
        </p>
        <Link className="button button--primary" href="/play">
          Back to Play
        </Link>
      </section>
    );
  return (
    <div className="join-page" data-invite-status={info.status}>
      <PageHeader
        eyebrow="Friend match"
        title={`${info.hostDisplayName} challenged you`}
      >
        <p className="muted">
          Code <strong className="invite-code">{info.code}</strong> · expires{" "}
          {new Date(info.expiresAt).toLocaleTimeString()}
        </p>
      </PageHeader>
      <section className="play-panel">
        <h2 className="panel-title">Choose your deck</h2>
        <DeckPicker
          decks={decks.data?.decks ?? []}
          onChange={setDeckId}
          value={deckId}
        />
        {problem ? <p className="form-error">{problem}</p> : null}
        <div className="action-row">
          <button
            className="button button--primary button--large"
            disabled={Boolean(problem)}
            onClick={() =>
              router.push(
                `/match?mode=friend&code=${info.code}&deck=${encodeURIComponent(deckId)}`,
              )
            }
            type="button"
          >
            Accept and join
          </button>
        </div>
      </section>
    </div>
  );
}
