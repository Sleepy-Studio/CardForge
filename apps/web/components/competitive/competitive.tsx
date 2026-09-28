"use client";

import Link from "next/link";
import { aspectLabel, leaderCards, leaderInfo } from "@/lib/cards";
import { useRequireAccount } from "@/lib/session";
import type { CompetitiveView, MatchHistoryEntry } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";
import { MatchRow } from "../history/match-row";
import { EmptyState, Meter, PageHeader, RankBadge, timeLeft } from "../ui/bits";
import type { Aspect } from "@cardforge/card-schema";

const tiers = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"];

export function Competitive() {
  const account = useRequireAccount();
  const profile = useApiData<{ profile: CompetitiveView }>(
    account ? "/api/me/competitive-profile" : null,
  );
  const history = useApiData<{ matches: MatchHistoryEntry[] }>(
    account ? "/api/me/matches" : null,
  );
  if (!account || !profile.data)
    return <p className="loading-line">Loading…</p>;
  const view = profile.data.profile;
  const ranked = (history.data?.matches ?? []).filter(
    (entry) => entry.queue === "ranked",
  );
  const levelXp = view.accountXp % 500;

  return (
    <div className="competitive-page">
      <PageHeader
        actions={
          <Link className="button button--primary" href="/play">
            Play ranked
          </Link>
        }
        eyebrow={view.season.name}
        title="Competitive"
      >
        <p className="muted">
          Season ends in {timeLeft(view.season.endsAt)}. Ranks are a view of
          your rating; the rating itself decides matchmaking.
        </p>
      </PageHeader>
      <div className="dashboard-grid">
        <section className="panel-card">
          <h2>Rank</h2>
          <RankBadge rank={view.rank} rating={view.rating} />
          <p className="muted">
            {view.rank.nextAt !== null
              ? `${view.rank.nextAt - view.rating} rating to the next rank.`
              : "Top tier reached."}
          </p>
          <ol className="tier-ladder" aria-label="Rank tiers">
            {tiers.map((tier) => (
              <li
                className={view.rank.name === tier ? "is-current" : ""}
                key={tier}
              >
                {tier}
              </li>
            ))}
          </ol>
        </section>
        <section className="panel-card">
          <h2>Season record</h2>
          <p className="big-number">
            {view.wins}W – {view.losses}L
          </p>
          <p className="muted">
            {view.wins + view.losses
              ? `${Math.round((view.wins / (view.wins + view.losses)) * 100)}% win rate`
              : "No ranked matches yet"}
          </p>
          <h3>Level {view.accountLevel}</h3>
          <Meter label="Experience" max={500} value={levelXp} />
        </section>
        <section className="panel-card panel-card--wide">
          <h2>Leaders</h2>
          <ul className="leader-unlocks">
            {leaderCards.map((card) => {
              const info = leaderInfo(card.cardId);
              const unlocked = view.unlockedLeaderIds.includes(card.cardId);
              return (
                <li
                  className={unlocked ? "is-unlocked" : "is-locked"}
                  key={card.cardId}
                >
                  <strong>{info.name}</strong>
                  <small>
                    {info.archetype} ·{" "}
                    {info.aspects
                      .map((aspect) => aspectLabel[aspect])
                      .join(" / ")}
                  </small>
                  <span>
                    {unlocked ? "Unlocked" : "Unlocks with account level"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="panel-card panel-card--wide">
          <h2>Aspect mastery</h2>
          <ul className="mastery-list">
            {(Object.entries(view.aspectMastery) as [Aspect, number][]).map(
              ([aspect, value]) => (
                <li key={aspect}>
                  <span>{aspectLabel[aspect]}</span>
                  <Meter
                    label={`${aspectLabel[aspect]} mastery`}
                    max={1000}
                    value={value % 1000}
                  />
                  <small>{value}</small>
                </li>
              ),
            )}
            {!Object.keys(view.aspectMastery).length ? (
              <li className="muted">Play matches to earn mastery.</li>
            ) : null}
          </ul>
        </section>
        <section className="panel-card panel-card--wide">
          <h2>Recent rating changes</h2>
          {ranked.length ? (
            <ul className="match-list">
              {ranked.slice(0, 10).map((entry) => (
                <MatchRow compact entry={entry} key={entry.matchId} />
              ))}
            </ul>
          ) : (
            <EmptyState title="No ranked matches yet" />
          )}
        </section>
      </div>
    </div>
  );
}
