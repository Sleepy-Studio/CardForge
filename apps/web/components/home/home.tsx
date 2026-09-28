"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { messageFor, useApi } from "@/lib/api";
import { leaderInfo } from "@/lib/cards";
import { readRejoin, type RejoinRecord } from "@/lib/match-connection";
import { useSession } from "@/lib/session";
import type { HomePayload, QuestView } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";
import { MatchRow } from "../history/match-row";
import { useGameTheme } from "../theme-provider";
import { EmptyState, Meter, RankBadge, Wallets, timeLeft } from "../ui/bits";
import { CardFace } from "../ui/card-face";
import { cardMap } from "@/lib/cards";

function rewardText(reward: QuestView["reward"]): string {
  return [
    reward.shards ? `${reward.shards} Shards` : "",
    reward.styleTokens ? `${reward.styleTokens} Style Tokens` : "",
    reward.cosmeticId ? "Cosmetic" : "",
  ]
    .filter(Boolean)
    .join(" + ");
}

function Landing() {
  return (
    <section className="landing">
      <div className="landing__copy">
        <p className="eyebrow">Closed alpha</p>
        <h1>Every action costs time. Spend it well.</h1>
        <p className="lede">
          CardForge is a tactical card game with no turns: both players share
          one clock across three contested Fronts. Fast plays let you act again
          sooner — heavy plays hand your rival the tempo.
        </p>
        <div className="action-row">
          <Link className="button button--primary" href="/login?mode=register">
            Create an account
          </Link>
          <Link className="button button--quiet" href="/login">
            Sign in
          </Link>
        </div>
        <ul className="landing__points">
          <li>Choose a starter Leader and get a complete deck.</li>
          <li>Learn the rules in a two-minute Field Guide.</li>
          <li>Play casual, ranked, or challenge a friend with a code.</li>
        </ul>
      </div>
      <div className="landing__art" aria-hidden="true">
        {["leader.ember", "entity.linebreaker", "leader.cipher"].map((id) => {
          const card = cardMap.get(id);
          return card ? <CardFace card={card} key={id} size="md" /> : null;
        })}
      </div>
    </section>
  );
}

export function Home() {
  const { account } = useSession();
  if (account === undefined) return <p className="loading-line">Loading…</p>;
  if (account === null) return <Landing />;
  if (!account.onboarding.starterLeaderId)
    return (
      <EmptyState title="Finish setting up">
        <Link className="button button--primary" href="/onboarding">
          Choose your starter
        </Link>
      </EmptyState>
    );
  return <Dashboard />;
}

function Dashboard() {
  const api = useApi();
  const { term } = useGameTheme();
  const { data, error, reload } = useApiData<HomePayload>("/api/me/home");
  const [rejoin, setRejoin] = useState<RejoinRecord | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  useEffect(() => setRejoin(readRejoin()), []);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="loading-line">Loading your front…</p>;
  const activeDeck =
    data.decks.find((deck) => deck.status.playable) ?? data.decks[0];
  const profile = data.competitive;
  const levelXp = profile.accountXp % 500;

  const claim = async (quest: QuestView) => {
    setClaiming(quest.questId);
    setClaimError(null);
    try {
      await api(`/api/me/quests/${encodeURIComponent(quest.questId)}/claim`, {
        body: {},
      });
      await reload();
    } catch (caught) {
      setClaimError(messageFor(caught));
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="dashboard">
      {rejoin ? (
        <div className="notice notice--action">
          <span>You have a match in progress.</span>
          <Link
            className="button button--primary button--small"
            href="/match?rejoin=1"
          >
            Rejoin
          </Link>
        </div>
      ) : null}
      <section className="hero-panel">
        <div>
          <p className="eyebrow">{profile.season.name}</p>
          <h1>Welcome back, {data.account.displayName}</h1>
          <Wallets wallets={data.wallets} />
        </div>
        <div className="hero-panel__play">
          {activeDeck?.status.playable ? (
            <Link
              className="button button--primary button--large"
              href={`/match?mode=casual&deck=${encodeURIComponent(activeDeck.deckId)}`}
            >
              Quick play
            </Link>
          ) : (
            <Link
              className="button button--primary button--large"
              href="/decks"
            >
              Build a playable deck
            </Link>
          )}
          <small>
            {activeDeck
              ? `${activeDeck.name} · ${leaderInfo(activeDeck.leaderId).name}`
              : "No deck yet"}
          </small>
          <Link className="text-link" href="/play">
            All modes
          </Link>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel-card">
          <h2>Rank</h2>
          <RankBadge rank={profile.rank} rating={profile.rating} />
          <p className="muted">
            {profile.wins}W – {profile.losses}L this season ·{" "}
            {timeLeft(profile.season.endsAt)}
          </p>
        </section>
        <section className="panel-card">
          <h2>Progression</h2>
          <p className="big-number">Level {profile.accountLevel}</p>
          <Meter label="Experience to next level" max={500} value={levelXp} />
          <p className="muted">
            {levelXp}/500 XP · {profile.unlockedLeaderIds.length} of 12{" "}
            {term("leader")}s unlocked
          </p>
        </section>
        <section className="panel-card panel-card--wide">
          <h2>Quests</h2>
          {claimError ? <p className="form-error">{claimError}</p> : null}
          <ul className="quest-list">
            {data.quests.map((quest) => (
              <li
                className={`quest ${quest.complete ? "is-complete" : ""}`}
                key={quest.questId}
              >
                <div>
                  <strong>{quest.title}</strong>
                  <small>
                    {quest.cadence === "daily"
                      ? "Daily"
                      : quest.cadence === "weekly"
                        ? "Weekly"
                        : "Season"}{" "}
                    · {rewardText(quest.reward)} · {timeLeft(quest.endsAt)}
                  </small>
                  <Meter
                    label={`${quest.title} progress`}
                    max={quest.target}
                    value={quest.progress}
                  />
                </div>
                {quest.claimed ? (
                  <span className="pill">Claimed</span>
                ) : quest.complete ? (
                  <button
                    className="button button--primary button--small"
                    disabled={claiming === quest.questId}
                    onClick={() => void claim(quest)}
                    type="button"
                  >
                    Claim
                  </button>
                ) : (
                  <span className="pill">
                    {quest.progress}/{quest.target}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
        {data.events.length ? (
          <section className="panel-card panel-card--wide">
            <h2>Events</h2>
            <ul className="event-list">
              {data.events.map((event) => (
                <li key={event.eventId}>
                  <strong>{event.title}</strong>
                  <small>
                    {event.window === "active"
                      ? timeLeft(event.endsAt)
                      : `Starts ${new Date(event.startsAt).toLocaleDateString()}`}
                  </small>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="panel-card panel-card--wide">
          <h2>Recent matches</h2>
          {data.recentMatches.length ? (
            <ul className="match-list">
              {data.recentMatches.map((entry) => (
                <MatchRow compact entry={entry} key={entry.matchId} />
              ))}
            </ul>
          ) : (
            <EmptyState title="No matches yet">
              <Link href="/play">Play your first match</Link>
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}
