"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { track } from "@/lib/analytics";
import { messageFor, useApi } from "@/lib/api";
import { leaderCards } from "@/lib/cards";
import { readRejoin, type RejoinRecord } from "@/lib/match-connection";
import { useRequireAccount } from "@/lib/session";
import type { CompetitiveView, SavedDeck } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";
import { PageHeader, RankBadge } from "../ui/bits";
import { useCardArt } from "../ui/card-face";
import { DeckPicker, deckProblem } from "./deck-picker";

type Mode = "casual" | "ranked" | "friend" | "practice" | "academy";

const modes: readonly {
  id: Mode;
  title: string;
  blurb: string;
  /** Card whose illustration decorates the mode tile. */
  art: string;
}[] = [
  {
    id: "casual",
    title: "Casual",
    blurb: "Play anyone. Earn Shards and XP.",
    art: "entity.linebreaker",
  },
  {
    id: "ranked",
    title: "Ranked",
    blurb: "Climb the season ladder.",
    art: "leader.vanguard",
  },
  {
    id: "friend",
    title: "Friend",
    blurb: "Private match with a code.",
    art: "reaction.deflect",
  },
  {
    id: "practice",
    title: "Practice",
    blurb: "Play against the AI.",
    art: "entity.bulwark",
  },
  {
    id: "academy",
    title: "Learn",
    blurb: "Lessons and challenges.",
    art: "relic.beacon",
  },
];

export function PlayMenu() {
  const account = useRequireAccount();
  const api = useApi();
  const router = useRouter();
  const decks = useApiData<{ decks: SavedDeck[] }>(
    account ? "/api/me/decks" : null,
  );
  const profile = useApiData<{ profile: CompetitiveView }>(
    account ? "/api/me/competitive-profile" : null,
  );
  const flags = useApiData<{ featureFlags: Record<string, boolean> }>(
    "/api/live-ops/current",
  );
  const artUrl = useCardArt();
  const [mode, setMode] = useState<Mode>("casual");
  const [deckId, setDeckId] = useState("");
  const [opponent, setOpponent] = useState("");
  const [invite, setInvite] = useState<{
    code: string;
    url: string;
    expiresAt: string;
  } | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rejoin, setRejoin] = useState<RejoinRecord | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setRejoin(readRejoin()), []);

  const deckList = useMemo(() => decks.data?.decks ?? [], [decks.data]);
  useEffect(() => {
    if (!deckId && deckList.length)
      setDeckId(
        (deckList.find((deck) => !deckProblem(deck)) ?? deckList[0]).deckId,
      );
  }, [deckId, deckList]);

  if (!account) return <p className="loading-line">Loading…</p>;
  const selected = deckList.find((deck) => deck.deckId === deckId);
  const problem = selected ? deckProblem(selected) : "Choose a deck";
  const rankedOpen = flags.data?.featureFlags["queue.ranked"] !== false;

  const go = (href: string) => router.push(href);
  const start = () => {
    setError(null);
    if (mode === "academy") return go("/academy");
    if (mode === "practice") {
      track(api, "practice_started", { source: "play" });
      return go(
        `/match?mode=practice${deckId ? `&deck=${encodeURIComponent(deckId)}` : ""}${opponent ? `&opponent=${opponent}` : ""}`,
      );
    }
    if (problem) {
      setError(`${problem}. Pick another deck or edit it in Decks.`);
      return;
    }
    if (mode === "friend" && invite)
      return go(
        `/match?mode=friend&code=${invite.code}&deck=${encodeURIComponent(deckId)}`,
      );
    go(`/match?mode=${mode}&deck=${encodeURIComponent(deckId)}`);
  };

  const createInvite = async () => {
    setError(null);
    try {
      const result = await api<{
        invite: { code: string; expiresAt: string };
        url: string;
      }>("/api/me/invites", { body: {} });
      setInvite({
        code: result.invite.code,
        url: result.url,
        expiresAt: result.invite.expiresAt,
      });
    } catch (caught) {
      setError(messageFor(caught));
    }
  };

  const joinWithCode = (event: FormEvent) => {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
      setError("Invite codes are six letters and numbers, like K7Q2PX.");
      return;
    }
    go(`/join/${code}`);
  };

  return (
    <div className="play-page">
      <PageHeader eyebrow="Play" title="Choose how to play" />
      {rejoin ? (
        <div className="notice notice--action">
          <span>You left a match in progress.</span>
          <Link
            className="button button--primary button--small"
            href="/match?rejoin=1"
          >
            Rejoin match
          </Link>
        </div>
      ) : null}
      <div className="mode-grid" role="tablist" aria-label="Game modes">
        {modes.map((item) => (
          <button
            aria-selected={mode === item.id}
            className={`mode-card mode-card--${item.id} ${mode === item.id ? "is-selected" : ""}`}
            data-mode={item.id}
            disabled={item.id === "ranked" && !rankedOpen}
            key={item.id}
            onClick={() => {
              setMode(item.id);
              setError(null);
            }}
            role="tab"
            type="button"
          >
            <span
              aria-hidden="true"
              className="mode-card__art"
              style={{ backgroundImage: `url("${artUrl(item.art)}")` }}
            />
            <strong>{item.title}</strong>
            <small>
              {item.id === "ranked" && !rankedOpen
                ? "Ranked is closed right now."
                : item.blurb}
            </small>
          </button>
        ))}
      </div>

      <section className="play-panel" role="tabpanel">
        {mode === "ranked" && profile.data ? (
          <div className="ranked-summary">
            <RankBadge
              rank={profile.data.profile.rank}
              rating={profile.data.profile.rating}
            />
            <div>
              <strong>{profile.data.profile.season.name}</strong>
              <p className="muted">
                {profile.data.profile.wins}W – {profile.data.profile.losses}L.
                Needs a legal deck made only of cards you own.
              </p>
            </div>
          </div>
        ) : null}

        {mode === "academy" ? (
          <p className="muted">
            Short lessons teach one idea each. Challenges put it to the test.
          </p>
        ) : (
          <>
            <h2 className="panel-title">
              {mode === "practice" ? "Your deck (optional)" : "Your deck"}
            </h2>
            <DeckPicker
              allowUnplayable={mode === "practice"}
              decks={deckList}
              onChange={setDeckId}
              value={deckId}
            />
          </>
        )}

        {mode === "practice" ? (
          <label className="inline-field">
            <span>Opponent</span>
            <select
              onChange={(event) => setOpponent(event.target.value)}
              value={opponent}
            >
              <option value="">Random starter</option>
              {leaderCards.map((card) => (
                <option key={card.cardId} value={card.cardId}>
                  {card.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {mode === "friend" ? (
          <div className="friend-panel">
            <div>
              <h2 className="panel-title">Host</h2>
              {invite ? (
                <div className="invite-box" data-invite={invite.code}>
                  <p>
                    Invite code{" "}
                    <strong className="invite-code">{invite.code}</strong>
                  </p>
                  <div className="action-row">
                    <button
                      className="button button--quiet button--small"
                      onClick={() =>
                        void navigator.clipboard
                          ?.writeText(invite.url)
                          .then(() => setCopied(true))
                          .catch(() => setCopied(false))
                      }
                      type="button"
                    >
                      {copied ? "Link copied" : "Copy invite link"}
                    </button>
                  </div>
                  <small className="muted">
                    Expires {new Date(invite.expiresAt).toLocaleTimeString()}.
                    One match per code.
                  </small>
                </div>
              ) : (
                <button
                  className="button button--quiet"
                  onClick={() => void createInvite()}
                  type="button"
                >
                  Create invite code
                </button>
              )}
            </div>
            <form className="join-form" onSubmit={joinWithCode}>
              <h2 className="panel-title">Join</h2>
              <label>
                <span>Friend&apos;s code</span>
                <input
                  autoCapitalize="characters"
                  maxLength={6}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="K7Q2PX"
                  value={joinCode}
                />
              </label>
              <button className="button button--quiet" type="submit">
                Join
              </button>
            </form>
          </div>
        ) : null}

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="action-row">
          <button
            className="button button--primary button--large"
            data-start-mode={mode}
            disabled={mode === "friend" && !invite}
            onClick={start}
            type="button"
          >
            {mode === "casual"
              ? "Find casual match"
              : mode === "ranked"
                ? "Find ranked match"
                : mode === "friend"
                  ? invite
                    ? "Open waiting room"
                    : "Create a code first"
                  : mode === "practice"
                    ? "Start practice"
                    : "Go to lessons"}
          </button>
        </div>
      </section>
    </div>
  );
}
