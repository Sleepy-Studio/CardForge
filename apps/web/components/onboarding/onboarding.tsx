"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Aspect } from "@cardforge/card-schema";
import { track } from "@/lib/analytics";
import { messageFor, useApi } from "@/lib/api";
import { aspectLabel, cardMap } from "@/lib/cards";
import { useRequireAccount, useSession } from "@/lib/session";
import type { Account } from "@/lib/types";
import { FieldGuide } from "../field-guide";
import { useGameTheme } from "../theme-provider";
import { CardFace } from "../ui/card-face";

interface StarterOption {
  readonly leaderId: string;
  readonly name: string;
  readonly aspects: readonly Aspect[];
  readonly archetype: string;
  readonly summary: string;
  readonly deckId: string;
}

const playstyle: Readonly<Record<string, string>> = {
  "leader.ember": "Aggressive — hit hard and break through a Front.",
  "leader.citadel": "Defensive — outlast attackers and hold the line.",
  "leader.vector": "Tempo — act quickly and reposition often.",
  "leader.verdant": "Growth — build a wide board that snowballs.",
  "leader.cipher": "Control — out-think your opponent with Reactions.",
  "leader.hollow": "Attrition — trade Entities and win the long game.",
};

/**
 * First session, designed for under ten minutes to a real match:
 * choose a starter Leader (≈1 min) → four-question tutorial (≈2 min) →
 * optional practice match against the AI (≈5 min) → Play unlocked.
 * Every step can be skipped; progress lives on the server.
 */
export function Onboarding() {
  const account = useRequireAccount({ allowOnboarding: true });
  const { setAccount } = useSession();
  const { term } = useGameTheme();
  const api = useApi();
  const router = useRouter();
  const params = useSearchParams();
  const [starters, setStarters] = useState<readonly StarterOption[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideStarted = useRef(false);

  useEffect(() => {
    void api<{ starters: StarterOption[] }>("/api/onboarding/starters")
      .then((payload) => setStarters(payload.starters))
      .catch((caught) => setError(messageFor(caught)));
  }, [api]);

  // Returning players who already finished go Home — decided once, on
  // arrival, so finishing here does not race the navigation to Play.
  const arrivalChecked = useRef(false);
  useEffect(() => {
    if (!account || arrivalChecked.current) return;
    arrivalChecked.current = true;
    if (account.onboarding.completedAt && !params.get("step"))
      router.replace("/");
  }, [account, params, router]);

  if (!account) return <p className="loading-line">Loading…</p>;
  const step = !account.onboarding.starterLeaderId
    ? "choose"
    : params.get("step") === "practice"
      ? "practice"
      : "learn";
  const starterDeckId = `starter-${(account.onboarding.starterLeaderId ?? "").replace("leader.", "")}`;

  const choose = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ account: Account }>(
        "/api/me/onboarding/starter",
        { body: { leaderId: chosen } },
      );
      setAccount(result.account);
      track(api, "first_deck_selected", {
        leaderId: chosen,
        source: "onboarding",
      });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (skipped: boolean) => {
    setBusy(true);
    try {
      if (skipped) track(api, "onboarding_skipped", { step });
      const result = await api<{ account: Account }>(
        "/api/me/onboarding/complete",
        { body: {} },
      );
      setAccount(result.account);
      router.push("/play");
    } catch (caught) {
      setError(messageFor(caught));
      setBusy(false);
    }
  };

  const openGuide = () => {
    if (!guideStarted.current)
      track(api, "tutorial_started", { tutorial: "field-guide" });
    guideStarted.current = true;
    setGuideOpen(true);
  };

  return (
    <section className="onboarding" data-onboarding-step={step}>
      <ol className="stepper" aria-label="Getting started">
        <li aria-current={step === "choose" ? "step" : undefined}>
          Choose a {term("leader")}
        </li>
        <li aria-current={step === "learn" ? "step" : undefined}>
          Learn the basics
        </li>
        <li aria-current={step === "practice" ? "step" : undefined}>
          Practice match
        </li>
      </ol>

      {step === "choose" ? (
        <>
          <header className="page-header">
            <div>
              <p className="eyebrow">Welcome, {account.displayName}</p>
              <h1>Choose your starter {term("leader")}</h1>
              <p className="muted">
                Each one comes with a complete, ready-to-play deck.
              </p>
            </div>
          </header>
          <div
            className="starter-grid"
            role="radiogroup"
            aria-label="Starter Leaders"
          >
            {starters.map((starter) => {
              const card = cardMap.get(starter.leaderId);
              return (
                <button
                  aria-checked={chosen === starter.leaderId}
                  className={`starter-option ${chosen === starter.leaderId ? "is-selected" : ""}`}
                  data-leader={starter.leaderId}
                  key={starter.leaderId}
                  onClick={() => setChosen(starter.leaderId)}
                  role="radio"
                  type="button"
                >
                  {card ? <CardFace card={card} plain size="md" /> : null}
                  <span className="starter-option__copy">
                    <strong>{starter.archetype}</strong>
                    <small>
                      {starter.aspects
                        .map((aspect) => aspectLabel[aspect])
                        .join(" · ")}
                    </small>
                    <span>
                      {playstyle[starter.leaderId] ?? starter.summary}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="action-row">
            <button
              className="button button--primary"
              disabled={!chosen || busy}
              onClick={() => void choose()}
              type="button"
            >
              {busy ? "Preparing your deck…" : "Take this deck"}
            </button>
          </div>
        </>
      ) : null}

      {step === "learn" ? (
        <>
          <header className="page-header">
            <div>
              <p className="eyebrow">Your deck is ready</p>
              <h1>Learn the basics</h1>
              <p className="muted">
                Four quick questions cover everything you need to start.
              </p>
            </div>
          </header>
          <div className="onboarding-cards">
            <article className="info-card">
              <h2>No turns, one shared clock</h2>
              <p>
                Every action costs Time. Whoever has spent less acts next, so
                quick plays let you act again sooner.
              </p>
            </article>
            <article className="info-card">
              <h2>Two ways to win</h2>
              <p>
                Hold two of three {term("front")}s to earn {term("dominion")}{" "}
                and reach 6, or bring the other {term("leader")} to 0{" "}
                {term("integrity")}.
              </p>
            </article>
          </div>
          <div className="action-row">
            <button
              className="button button--primary"
              onClick={openGuide}
              type="button"
            >
              Start the tutorial
            </button>
            <Link
              className="button button--quiet"
              href="/onboarding?step=practice"
            >
              Skip ahead
            </Link>
          </div>
          {guideOpen ? (
            <FieldGuide
              onClose={() => {
                setGuideOpen(false);
                track(api, "tutorial_abandoned", { tutorial: "field-guide" });
              }}
              onComplete={(result) => {
                track(api, "tutorial_completed", {
                  tutorial: "field-guide",
                  score: result.score,
                  attempts: result.attempts,
                });
                setGuideOpen(false);
                router.push("/onboarding?step=practice");
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
        </>
      ) : null}

      {step === "practice" ? (
        <>
          <header className="page-header">
            <div>
              <p className="eyebrow">Last step</p>
              <h1>Play a practice match</h1>
              <p className="muted">
                Try your new deck against the AI. Nothing is at stake. Tap any
                card to see what it does.
              </p>
            </div>
          </header>
          <div className="action-row">
            <Link
              className="button button--primary"
              href={`/match?mode=practice&deck=${encodeURIComponent(starterDeckId)}&onboarding=1`}
              onClick={() =>
                track(api, "practice_started", { source: "onboarding" })
              }
            >
              Start practice match
            </Link>
            <button
              className="button button--quiet"
              disabled={busy}
              onClick={() => void finish(false)}
              type="button"
            >
              Go to Play
            </button>
          </div>
        </>
      ) : null}

      {step !== "choose" ? (
        <p className="skip-line">
          <button
            className="link-button"
            disabled={busy}
            onClick={() => void finish(true)}
            type="button"
          >
            Skip the introduction
          </button>
        </p>
      ) : null}
    </section>
  );
}
