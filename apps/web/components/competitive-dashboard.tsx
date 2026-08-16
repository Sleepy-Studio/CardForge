"use client";

import { useCallback, useEffect, useState } from "react";
import { useGameTheme } from "./theme-provider";

interface Season {
  readonly seasonId: string;
  readonly name: string;
  readonly endsAt: string;
  readonly patchId: string;
  readonly formatRevision: number;
}

interface Patch {
  readonly patchId: string;
  readonly revision: number;
  readonly notes: readonly string[];
}

interface Profile {
  readonly rating: number;
  readonly wins: number;
  readonly losses: number;
  readonly accountXp: number;
  readonly accountLevel: number;
  readonly aspectMastery: Readonly<Record<string, number>>;
  readonly unlockedLeaderIds: readonly string[];
}

interface Overview {
  readonly matches: number;
  readonly averageCycles: number;
  readonly averageMainActions: number;
  readonly averageReactions: number;
  readonly initiativeWinRate: number;
  readonly integrityWins: number;
  readonly dominionWins: number;
  readonly leaders: readonly {
    readonly leaderId: string;
    readonly matches: number;
    readonly winRate: number;
  }[];
}

export function CompetitiveDashboard() {
  const { term } = useGameTheme();
  const endpoint =
    process.env.NEXT_PUBLIC_MATCH_SERVER_URL ?? "http://localhost:2567";
  const [accountId, setAccountId] = useState("browser-alpha");
  const [season, setSeason] = useState<Season | null>(null);
  const [patches, setPatches] = useState<readonly Patch[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState("Loading authoritative telemetry…");

  const refresh = useCallback(async () => {
    setStatus("Refreshing…");
    const [seasonResponse, overviewResponse] = await Promise.all([
      fetch(`${endpoint}/api/competitive/season`),
      fetch(`${endpoint}/api/competitive/overview`),
    ]);
    if (!seasonResponse.ok || !overviewResponse.ok)
      throw new Error("Competitive service is unavailable.");
    const seasonPayload = (await seasonResponse.json()) as {
      season: Season;
      patches: Patch[];
    };
    const overviewPayload = (await overviewResponse.json()) as {
      overview: Overview;
    };
    setSeason(seasonPayload.season);
    setPatches(seasonPayload.patches);
    setOverview(overviewPayload.overview);
    setStatus(`Live // ${overviewPayload.overview.matches} recorded matches`);
  }, [endpoint]);

  useEffect(() => {
    const stored = window.localStorage.getItem("cardforge.alpha.account");
    if (stored) setAccountId(stored);
    void refresh().catch((error) =>
      setStatus(error instanceof Error ? error.message : "Refresh failed."),
    );
  }, [refresh]);

  const loadProfile = async () => {
    const headers = {
      "content-type": "application/json",
      "x-cardforge-account-id": accountId,
    };
    await fetch(`${endpoint}/api/accounts/${accountId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ displayName: "Competitive Player" }),
    });
    const response = await fetch(
      `${endpoint}/api/accounts/${accountId}/competitive-profile`,
      { headers },
    );
    if (!response.ok) throw new Error("Profile could not be loaded.");
    const payload = (await response.json()) as { profile: Profile };
    window.localStorage.setItem("cardforge.alpha.account", accountId);
    setProfile(payload.profile);
  };

  const games = profile ? profile.wins + profile.losses : 0;
  const currentXp = profile ? profile.accountXp % 500 : 0;
  return (
    <main className="competitive-shell">
      <header className="competitive-header">
        <div>
          <p className="eyebrow">CARDFORGE // COMPETITIVE BETA</p>
          <h1>{season?.name ?? "The First Frontier"}</h1>
          <p>{status}</p>
        </div>
        <nav>
          <a className="button button--quiet" href="/online">
            Matchmaking
          </a>
          <a className="button button--quiet" href="/studio">
            Card Studio
          </a>
          <button
            className="button button--primary"
            onClick={() => void refresh()}
            type="button"
          >
            Refresh
          </button>
        </nav>
      </header>

      <section className="competitive-metrics" aria-label="Balance overview">
        {[
          ["MATCHES", overview?.matches ?? 0],
          ["AVG CYCLES", overview?.averageCycles ?? 0],
          ["AVG ACTIONS", overview?.averageMainActions ?? 0],
          ["AVG REACTIONS", overview?.averageReactions ?? 0],
          [
            "INITIATIVE WIN",
            `${Math.round((overview?.initiativeWinRate ?? 0) * 100)}%`,
          ],
          [
            "VICTORY ROUTES",
            `${overview?.integrityWins ?? 0} ${term("integrity")} / ${overview?.dominionWins ?? 0} ${term("dominion")}`,
          ],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <div className="competitive-grid">
        <section className="competitive-panel competitive-profile">
          <div className="panel-heading">
            <span>STARTER PROGRESSION</span>
            <small>
              {profile ? `LEVEL ${profile.accountLevel}` : "not loaded"}
            </small>
          </div>
          <label>
            <span>Account namespace</span>
            <input
              onChange={(event) => setAccountId(event.target.value)}
              value={accountId}
            />
          </label>
          <button
            className="button button--primary"
            onClick={() =>
              void loadProfile().catch((error) =>
                setStatus(
                  error instanceof Error ? error.message : "Profile failed.",
                ),
              )
            }
            type="button"
          >
            Load profile
          </button>
          {profile ? (
            <div className="profile-readout">
              <div>
                <span>RATING</span>
                <strong>{profile.rating}</strong>
              </div>
              <div>
                <span>RECORD</span>
                <strong>
                  {profile.wins}–{profile.losses}
                </strong>
              </div>
              <div>
                <span>WIN RATE</span>
                <strong>
                  {games
                    ? `${Math.round((profile.wins / games) * 100)}%`
                    : "--"}
                </strong>
              </div>
              <div className="profile-xp">
                <span>LEVEL PROGRESS // {currentXp}/500 XP</span>
                <i style={{ width: `${(currentXp / 500) * 100}%` }} />
              </div>
              <p>
                {profile.unlockedLeaderIds.length}/12 Leaders unlocked through
                play. No random Leader drops.
              </p>
              <ul>
                {Object.entries(profile.aspectMastery).map(([aspect, xp]) => (
                  <li key={aspect}>
                    <span>{aspect.toUpperCase()}</span>
                    <strong>{xp} mastery</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="empty-copy">
              Load a profile to inspect rating, XP, unlocks, and Aspect mastery.
            </p>
          )}
        </section>

        <section className="competitive-panel competitive-leaders">
          <div className="panel-heading">
            <span>LEADER BALANCE</span>
            <small>server-derived</small>
          </div>
          <div className="leader-table" role="table">
            <div className="leader-table__head" role="row">
              <span>Leader</span>
              <span>Matches</span>
              <span>Win rate</span>
            </div>
            {(overview?.leaders ?? []).map((leader) => (
              <div key={leader.leaderId} role="row">
                <strong>{leader.leaderId.replace("leader.", "")}</strong>
                <span>{leader.matches}</span>
                <span>{Math.round(leader.winRate * 100)}%</span>
              </div>
            ))}
            {!overview?.leaders.length ? (
              <p className="empty-copy">
                No competitive matches yet. That is honest telemetry, not an
                invented graph.
              </p>
            ) : null}
          </div>
        </section>

        <section className="competitive-panel competitive-season">
          <div className="panel-heading">
            <span>VERSION LOCK</span>
            <small>{season?.seasonId ?? "loading"}</small>
          </div>
          <dl>
            <div>
              <dt>FORMAT</dt>
              <dd>STANDARD @{season?.formatRevision ?? "--"}</dd>
            </div>
            <div>
              <dt>PATCH</dt>
              <dd>{season?.patchId ?? "--"}</dd>
            </div>
            <div>
              <dt>ENDS</dt>
              <dd>
                {season ? new Date(season.endsAt).toLocaleDateString() : "--"}
              </dd>
            </div>
          </dl>
          {patches.map((patch) => (
            <div className="patch-notes" key={patch.patchId}>
              <strong>REVISION {patch.revision}</strong>
              <ul>
                {patch.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ))}
          <p className="telemetry-caveat">
            Treat rates as directional until the sample is large and segmented
            by skill. Aggregate win rate is evidence, not a verdict.
          </p>
        </section>
      </div>
    </main>
  );
}
