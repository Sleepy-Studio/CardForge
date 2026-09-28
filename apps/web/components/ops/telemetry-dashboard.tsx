"use client";

import { useState } from "react";
import { cardName, leaderInfo } from "@/lib/cards";
import { useApiData } from "@/lib/use-api-data";

interface Rate {
  readonly value: number | null;
  readonly numerator: number;
  readonly sample: number;
  readonly caution: "insufficient" | "low" | "moderate" | "adequate";
}

interface PlaytestOverview {
  readonly generatedAt: string;
  readonly matches: {
    readonly started: number;
    readonly completed: number;
    readonly byQueue: Readonly<Record<string, number>>;
    readonly completionRate: Rate;
    readonly concessionRate: Rate;
    readonly abandonmentRate: Rate;
    readonly dominionWinRate: Rate;
    readonly integrityWinRate: Rate;
    readonly initiativeWinRate: Rate;
    readonly averageCycles: number | null;
    readonly averageDurationMs: number | null;
    readonly averageActionMs: number | null;
    readonly reactionsPerMatch: number | null;
  };
  readonly seats: {
    readonly sample: number;
    readonly disconnects: number;
    readonly reconnects: number;
    readonly timeouts: number;
    readonly mulliganRate: Rate;
    readonly averageCardsDrawn: number | null;
    readonly medianQueueWaitMs: number | null;
    readonly averageQueueWaitMs: number | null;
  };
  readonly leaders: readonly {
    readonly leaderId: string;
    readonly picks: number;
    readonly pickRate: Rate;
    readonly winRate: Rate;
    readonly starterDeckShare: Rate;
  }[];
  readonly cards: {
    readonly mostPlayed: readonly {
      readonly cardId: string;
      readonly plays: number;
    }[];
    readonly neverPlayed: readonly string[];
    readonly distinctPlayed: number;
  };
  readonly onboarding: {
    readonly registered: number;
    readonly steps: readonly {
      readonly name: string;
      readonly accounts: number;
      readonly conversion: Rate;
    }[];
  };
}

const cautionText: Readonly<Record<Rate["caution"], string>> = {
  insufficient: "n<20 — do not draw conclusions",
  low: "n<100 — directional only",
  moderate: "n<400 — treat with care",
  adequate: "n≥400",
};

function RateCell({ rate }: { readonly rate: Rate }) {
  return (
    <span
      className={`rate rate--${rate.caution}`}
      title={cautionText[rate.caution]}
    >
      {rate.value === null ? "—" : `${(rate.value * 100).toFixed(1)}%`}
      <small>
        {rate.numerator}/{rate.sample}
      </small>
    </span>
  );
}

const seconds = (ms: number | null) =>
  ms === null ? "—" : `${(ms / 1_000).toFixed(1)}s`;

export function TelemetryDashboard() {
  const [since, setSince] = useState("");
  const query = since
    ? `?since=${encodeURIComponent(new Date(since).toISOString())}`
    : "";
  const { data, error, reload } = useApiData<{ overview: PlaytestOverview }>(
    `/api/admin/telemetry/playtest${query}`,
  );
  const overview = data?.overview;
  return (
    <section className="telemetry" aria-label="Playtest telemetry">
      <header className="operations-header">
        <div>
          <p className="eyebrow">Closed-alpha telemetry</p>
          <h2>Playtest dashboard</h2>
          <p className="muted">
            Server-derived from recorded matches and replays. Colours mark
            sample size: grey means too few matches to conclude anything. Bot
            and self-play numbers are not balance evidence.
          </p>
        </div>
        <div className="inline-form">
          <label className="inline-field">
            <span>Since</span>
            <input
              onChange={(event) => setSince(event.target.value)}
              type="date"
              value={since}
            />
          </label>
          <button
            className="button button--quiet"
            onClick={() => void reload()}
            type="button"
          >
            Refresh
          </button>
        </div>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      {overview ? (
        <div className="telemetry-grid">
          <article className="operations-panel">
            <h3>Matches</h3>
            <dl className="metric-list">
              <div>
                <dt>Started</dt>
                <dd>{overview.matches.started}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{overview.matches.completed}</dd>
              </div>
              <div>
                <dt>By queue</dt>
                <dd>
                  {Object.entries(overview.matches.byQueue)
                    .map(([queue, count]) => `${queue} ${count}`)
                    .join(" · ") || "—"}
                </dd>
              </div>
              <div>
                <dt>Completion</dt>
                <dd>
                  <RateCell rate={overview.matches.completionRate} />
                </dd>
              </div>
              <div>
                <dt>Concessions</dt>
                <dd>
                  <RateCell rate={overview.matches.concessionRate} />
                </dd>
              </div>
              <div>
                <dt>Abandonments</dt>
                <dd>
                  <RateCell rate={overview.matches.abandonmentRate} />
                </dd>
              </div>
              <div>
                <dt>Dominion wins</dt>
                <dd>
                  <RateCell rate={overview.matches.dominionWinRate} />
                </dd>
              </div>
              <div>
                <dt>Integrity wins</dt>
                <dd>
                  <RateCell rate={overview.matches.integrityWinRate} />
                </dd>
              </div>
              <div>
                <dt>First-Initiative wins</dt>
                <dd>
                  <RateCell rate={overview.matches.initiativeWinRate} />
                </dd>
              </div>
              <div>
                <dt>Avg cycles</dt>
                <dd>{overview.matches.averageCycles ?? "—"}</dd>
              </div>
              <div>
                <dt>Avg duration</dt>
                <dd>
                  {overview.matches.averageDurationMs === null
                    ? "—"
                    : `${Math.round(overview.matches.averageDurationMs / 60_000)} min`}
                </dd>
              </div>
              <div>
                <dt>Avg action time</dt>
                <dd>{seconds(overview.matches.averageActionMs)}</dd>
              </div>
              <div>
                <dt>Reactions / match</dt>
                <dd>{overview.matches.reactionsPerMatch ?? "—"}</dd>
              </div>
            </dl>
          </article>
          <article className="operations-panel">
            <h3>Players and connections</h3>
            <dl className="metric-list">
              <div>
                <dt>Seats sampled</dt>
                <dd>{overview.seats.sample}</dd>
              </div>
              <div>
                <dt>Disconnects</dt>
                <dd>{overview.seats.disconnects}</dd>
              </div>
              <div>
                <dt>Reconnects</dt>
                <dd>{overview.seats.reconnects}</dd>
              </div>
              <div>
                <dt>Clock timeouts</dt>
                <dd>{overview.seats.timeouts}</dd>
              </div>
              <div>
                <dt>Mulligan rate</dt>
                <dd>
                  <RateCell rate={overview.seats.mulliganRate} />
                </dd>
              </div>
              <div>
                <dt>Avg cards drawn</dt>
                <dd>{overview.seats.averageCardsDrawn ?? "—"}</dd>
              </div>
              <div>
                <dt>Queue wait (median)</dt>
                <dd>{seconds(overview.seats.medianQueueWaitMs)}</dd>
              </div>
              <div>
                <dt>Queue wait (mean)</dt>
                <dd>{seconds(overview.seats.averageQueueWaitMs)}</dd>
              </div>
            </dl>
          </article>
          <article className="operations-panel">
            <h3>First session funnel</h3>
            <ol className="funnel">
              {overview.onboarding.steps.map((step) => (
                <li key={step.name}>
                  <span>{step.name.replaceAll("_", " ")}</span>
                  <strong>{step.accounts}</strong>
                  <RateCell rate={step.conversion} />
                </li>
              ))}
            </ol>
          </article>
          <article className="operations-panel telemetry-wide">
            <h3>Leaders</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Leader</th>
                  <th>Picks</th>
                  <th>Pick rate</th>
                  <th>Win rate</th>
                  <th>Starter deck share</th>
                </tr>
              </thead>
              <tbody>
                {overview.leaders.map((row) => (
                  <tr key={row.leaderId}>
                    <td>
                      {leaderInfo(row.leaderId).name}{" "}
                      <small>{leaderInfo(row.leaderId).archetype}</small>
                    </td>
                    <td>{row.picks}</td>
                    <td>
                      <RateCell rate={row.pickRate} />
                    </td>
                    <td>
                      <RateCell rate={row.winRate} />
                    </td>
                    <td>
                      <RateCell rate={row.starterDeckShare} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
          <article className="operations-panel">
            <h3>Most played cards</h3>
            <ol className="compact-list">
              {overview.cards.mostPlayed.map((row) => (
                <li key={row.cardId}>
                  {cardName(row.cardId)} <small>×{row.plays}</small>
                </li>
              ))}
            </ol>
          </article>
          <article className="operations-panel">
            <h3>Never played ({overview.cards.neverPlayed.length})</h3>
            <p className="muted small">
              {overview.cards.distinctPlayed} distinct cards seen in play.
            </p>
            <p className="small">
              {overview.cards.neverPlayed
                .slice(0, 60)
                .map(cardName)
                .join(", ") || "—"}
            </p>
          </article>
        </div>
      ) : (
        <p className="loading-line">Loading telemetry…</p>
      )}
    </section>
  );
}
