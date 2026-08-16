"use client";

import { useCallback, useEffect, useState } from "react";

interface Scenario {
  readonly scenarioId: string;
  readonly kind: "tutorial" | "pve";
  readonly title: string;
  readonly summary: string;
  readonly difficulty: number;
  readonly objective: { readonly type: string; readonly cycles?: number };
  readonly steps: readonly {
    readonly title: string;
    readonly instruction: string;
    readonly teaches: string;
  }[];
  readonly reward: { readonly shards: number; readonly styleTokens: number };
}

export function Academy() {
  const endpoint =
    process.env.NEXT_PUBLIC_MATCH_SERVER_URL ?? "http://localhost:2567";
  const [accountId, setAccountId] = useState("browser-alpha");
  const [scenarios, setScenarios] = useState<readonly Scenario[]>([]);
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState("Loading scenario manifest…");

  const load = useCallback(async () => {
    const headers = {
      "content-type": "application/json",
      "x-cardforge-account-id": accountId,
    };
    await fetch(`${endpoint}/api/accounts/${accountId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ displayName: "Academy Pilot" }),
    });
    const [catalogResponse, completionResponse] = await Promise.all([
      fetch(`${endpoint}/api/training`),
      fetch(`${endpoint}/api/accounts/${accountId}/training-completions`, {
        headers,
      }),
    ]);
    if (!catalogResponse.ok || !completionResponse.ok)
      throw new Error("Academy service is unavailable.");
    const catalog = (await catalogResponse.json()) as { scenarios: Scenario[] };
    const progress = (await completionResponse.json()) as {
      scenarioIds: string[];
    };
    setScenarios(catalog.scenarios);
    setCompleted(new Set(progress.scenarioIds));
    window.localStorage.setItem("cardforge.alpha.account", accountId);
    setStatus(
      `${progress.scenarioIds.length}/${catalog.scenarios.length} directives complete`,
    );
  }, [accountId, endpoint]);

  useEffect(() => {
    const stored = window.localStorage.getItem("cardforge.alpha.account");
    if (stored && stored !== accountId) {
      setAccountId(stored);
      return;
    }
    void load().catch((error) =>
      setStatus(error instanceof Error ? error.message : "Academy failed."),
    );
  }, [accountId, load]);

  return (
    <main className="academy-shell">
      <header className="academy-header">
        <div>
          <p className="eyebrow">CARDFORGE // FIELD ACADEMY</p>
          <h1>Learn under fire.</h1>
          <p>{status}</p>
        </div>
        <nav>
          <a className="button button--quiet" href="/collection">
            Collection
          </a>
          <a className="button button--quiet" href="/online">
            Matchmaking
          </a>
          <button
            className="button button--primary"
            onClick={() => void load()}
            type="button"
          >
            Refresh
          </button>
        </nav>
      </header>
      <section className="academy-account">
        <label>
          <span>ACCOUNT NAMESPACE</span>
          <input
            onChange={(event) => setAccountId(event.target.value)}
            value={accountId}
          />
        </label>
        <p>
          Five teaching drills. Three deterministic PvE pressure tests. Rewards
          are granted once.
        </p>
      </section>
      {(["tutorial", "pve"] as const).map((kind) => (
        <section className="academy-track" key={kind}>
          <div className="panel-heading">
            <span>
              {kind === "tutorial" ? "CORE CURRICULUM" : "PVE CHALLENGES"}
            </span>
            <small>
              {scenarios.filter((item) => item.kind === kind).length} directives
            </small>
          </div>
          <div className="academy-grid">
            {scenarios
              .filter((item) => item.kind === kind)
              .map((scenario) => (
                <article
                  className={
                    completed.has(scenario.scenarioId) ? "is-complete" : ""
                  }
                  key={scenario.scenarioId}
                >
                  <div className="academy-card__meta">
                    <span>DIFFICULTY {"◆".repeat(scenario.difficulty)}</span>
                    <span>
                      {completed.has(scenario.scenarioId)
                        ? "COMPLETE"
                        : scenario.objective.type.replaceAll("_", " ")}
                    </span>
                  </div>
                  <h2>{scenario.title}</h2>
                  <p>{scenario.summary}</p>
                  <ol>
                    {scenario.steps.map((step) => (
                      <li key={step.title}>
                        <strong>{step.title}</strong>
                        <span>{step.instruction}</span>
                      </li>
                    ))}
                  </ol>
                  <footer>
                    <span>
                      {scenario.reward.shards} SHARDS
                      {scenario.reward.styleTokens
                        ? ` + ${scenario.reward.styleTokens} STYLE`
                        : ""}
                    </span>
                    <a
                      className="button button--primary"
                      href={`/online?training=${scenario.scenarioId}`}
                    >
                      {completed.has(scenario.scenarioId) ? "Replay" : "Deploy"}
                    </a>
                  </footer>
                </article>
              ))}
          </div>
        </section>
      ))}
    </main>
  );
}
