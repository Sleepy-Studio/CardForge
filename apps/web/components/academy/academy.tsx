"use client";

import Link from "next/link";
import { useState } from "react";
import { track } from "@/lib/analytics";
import { useApi } from "@/lib/api";
import { leaderInfo } from "@/lib/cards";
import { useRequireAccount } from "@/lib/session";
import type { TrainingScenario } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";
import { FieldGuide } from "../field-guide";
import { PageHeader } from "../ui/bits";
import { useCardArt } from "../ui/card-face";

export function Academy() {
  const account = useRequireAccount();
  const api = useApi();
  const artUrl = useCardArt();
  const scenarios = useApiData<{ scenarios: TrainingScenario[] }>(
    "/api/training",
  );
  const completions = useApiData<{ scenarioIds: string[] }>(
    account ? "/api/me/training-completions" : null,
  );
  const [guide, setGuide] = useState(false);
  if (!account) return <p className="loading-line">Loading…</p>;
  const done = new Set(completions.data?.scenarioIds ?? []);
  const list = scenarios.data?.scenarios ?? [];

  return (
    <div className="academy-page">
      <PageHeader
        actions={
          <button
            className="button button--quiet"
            onClick={() => {
              track(api, "tutorial_started", {
                tutorial: "field-guide",
                source: "academy",
              });
              setGuide(true);
            }}
            type="button"
          >
            Replay the tutorial
          </button>
        }
        eyebrow="Learn"
        title="Learn by playing"
      >
        <p className="muted">
          Lessons teach one idea at a time against the AI. Challenges start from
          a tricky position. Your first win in each pays a reward.
        </p>
      </PageHeader>
      {(["tutorial", "pve"] as const).map((kind) => (
        <section className="academy-track" key={kind}>
          <h2>{kind === "tutorial" ? "Lessons" : "Challenges"}</h2>
          <ul className="scenario-grid">
            {list
              .filter((scenario) => scenario.kind === kind)
              .map((scenario) => (
                <li
                  className={`scenario-card ${done.has(scenario.scenarioId) ? "is-complete" : ""}`}
                  data-scenario={scenario.scenarioId}
                  key={scenario.scenarioId}
                >
                  <span
                    aria-hidden="true"
                    className="scenario-card__art"
                    style={{
                      backgroundImage: `url("${artUrl(scenario.playerLeaderId)}")`,
                    }}
                  />
                  <div className="scenario-card__meta">
                    <span aria-label={`Difficulty ${scenario.difficulty} of 5`}>
                      {"◆".repeat(scenario.difficulty)}
                    </span>
                    <span>
                      {done.has(scenario.scenarioId)
                        ? "Completed"
                        : `${scenario.reward.shards} ◆ reward`}
                    </span>
                  </div>
                  <h3>{scenario.title}</h3>
                  <p>{scenario.summary}</p>
                  <small className="muted">
                    You play {leaderInfo(scenario.playerLeaderId).name} vs{" "}
                    {leaderInfo(scenario.opponentLeaderId).name}
                  </small>
                  <Link
                    className="button button--small"
                    href={`/match?mode=training&scenario=${encodeURIComponent(scenario.scenarioId)}`}
                    onClick={() =>
                      track(api, "tutorial_started", {
                        tutorial: scenario.scenarioId,
                      })
                    }
                  >
                    {done.has(scenario.scenarioId) ? "Play again" : "Start"}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {guide ? (
        <FieldGuide
          onClose={() => setGuide(false)}
          onComplete={(result) => {
            track(api, "tutorial_completed", {
              tutorial: "field-guide",
              score: result.score,
              source: "academy",
            });
            setGuide(false);
          }}
          onStep={(lesson, title) =>
            track(api, "tutorial_step", {
              tutorial: "field-guide",
              lesson,
              title,
            })
          }
        />
      ) : null}
    </div>
  );
}
