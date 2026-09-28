"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerId } from "@cardforge/card-schema";
import type { GameEvent, ProjectedGameView } from "@cardforge/rules-kernel";
import { track } from "@/lib/analytics";
import { messageFor, useApi } from "@/lib/api";
import { cardMap, leaderInfo } from "@/lib/cards";
import { presentationCues, type BoardLike } from "@/lib/match-ui";
import { intentLabel, narrate, type Intent } from "@/lib/match-view";
import { useRequireAccount } from "@/lib/session";
import { BoardCanvas } from "../board-canvas";
import { reasonLabel, queueLabel } from "../history/match-row";
import { useGameTheme } from "../theme-provider";
import { CardFace } from "../ui/card-face";
import { formatDate } from "../ui/bits";

type Perspective = PlayerId | "public";

interface Frame {
  readonly index: number;
  readonly cycle: number;
  readonly phase: string;
  readonly hash: string;
  readonly command:
    | (Intent & {
        readonly playerId: PlayerId;
        readonly redacted?: true;
        readonly count?: number;
      })
    | null;
  readonly events: readonly GameEvent[];
  readonly view: ProjectedGameView;
}

interface ReplayPage {
  readonly meta: {
    readonly queue: string | null;
    readonly reason: string | null;
    readonly winnerId: PlayerId | null;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly cycles: number | null;
  };
  readonly participants: readonly {
    readonly seat: PlayerId;
    readonly displayName: string;
    readonly leaderId: string;
    readonly deckName: string | null;
    readonly result: "win" | "loss" | null;
  }[];
  readonly perspective: Perspective;
  readonly perspectives: readonly Perspective[];
  readonly verification: {
    readonly verified: boolean;
    readonly expectedHash: string;
    readonly actualHash: string | null;
    readonly error: string | null;
  };
  readonly totalFrames: number;
  readonly frames: readonly Frame[];
}

const speeds = [0.5, 1, 2, 4] as const;

export function ReplayViewer({ matchId }: { readonly matchId: string }) {
  const account = useRequireAccount();
  const api = useApi();
  const { theme, term } = useGameTheme();
  const [perspective, setPerspective] = useState<Perspective | null>(null);
  const [page, setPage] = useState<ReplayPage | null>(null);
  const [frames, setFrames] = useState<readonly Frame[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1);
  const [error, setError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const tracked = useRef(false);

  useEffect(() => {
    if (!account) return;
    let active = true;
    const load = async () => {
      setError(null);
      const query = perspective ? `perspective=${perspective}&` : "";
      const firstPage = await api<ReplayPage>(
        `/api/matches/${encodeURIComponent(matchId)}/replay?${query}from=0&count=200`,
      );
      const all = [...firstPage.frames];
      while (all.length < firstPage.totalFrames) {
        const next = await api<ReplayPage>(
          `/api/matches/${encodeURIComponent(matchId)}/replay?perspective=${firstPage.perspective}&from=${all.length}&count=200`,
        );
        if (!next.frames.length) break;
        all.push(...next.frames);
      }
      if (!active) return;
      setPage(firstPage);
      setFrames(all);
      setPerspective(firstPage.perspective);
      setIndex((current) => Math.min(current, all.length - 1));
      if (!tracked.current) {
        tracked.current = true;
        track(api, "replay_opened", {
          verified: firstPage.verification.verified,
          frames: firstPage.totalFrames,
        });
      }
    };
    void load().catch((caught) => active && setError(messageFor(caught)));
    return () => {
      active = false;
    };
  }, [account, api, matchId, perspective]);

  useEffect(() => {
    if (!playing) return;
    if (index >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(
      () => setIndex((value) => value + 1),
      900 / speed,
    );
    return () => window.clearTimeout(timer);
  }, [frames.length, index, playing, speed]);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setIndex((value) =>
        Math.max(0, Math.min(frames.length - 1, value + delta)),
      );
    },
    [frames.length],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.tagName === "INPUT" ||
        (event.target as HTMLElement)?.tagName === "SELECT"
      )
        return;
      if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === " ") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const frame = frames[index];
  const previousFrame = index > 0 ? frames[index - 1] : undefined;
  const names = useMemo(() => {
    const result = { p1: "Player 1", p2: "Player 2" } as Record<
      PlayerId,
      string
    >;
    for (const participant of page?.participants ?? [])
      result[participant.seat] = participant.displayName;
    return result;
  }, [page]);
  const presentation = useMemo(() => {
    if (!frame || !previousFrame || !frame.events.length) return null;
    return {
      sequence: frame.index,
      cues: presentationCues(frame.events, previousFrame.view, frame.view),
    };
  }, [frame, previousFrame]);

  if (!account) return <p className="loading-line">Loading…</p>;
  if (error)
    return (
      <section className="auth-card">
        <h1>Replay unavailable</h1>
        <p className="form-error">{error}</p>
        <Link className="button button--primary" href="/history">
          Back to history
        </Link>
      </section>
    );
  if (!page || !frame)
    return (
      <p className="loading-line">Rebuilding the match from its command log…</p>
    );

  const viewer: PlayerId = frame.view.viewer;
  const commandText = frame.command
    ? frame.command.redacted
      ? `${names[frame.command.playerId]} ${frame.command.type === "mulligan" ? `replaced ${frame.command.count} card(s)` : "made a hidden choice"}`
      : `${names[frame.command.playerId]}: ${intentLabel(frame.view, frame.command, theme.terms)}`
    : "Opening state";
  const eventLines = frame.events
    .map((event) =>
      narrate(event, frame.view as unknown as BoardLike, names, theme.terms),
    )
    .filter((line): line is string => Boolean(line));
  const hand = frame.view.players[viewer].hand;
  const inspected = inspect ? cardMap.get(inspect) : undefined;

  return (
    <div
      className="replay-page"
      data-frame={frame.index}
      data-verified={page.verification.verified}
    >
      <header className="page-header">
        <div>
          <p className="eyebrow">
            Replay · {queueLabel[page.meta.queue ?? ""] ?? "Match"} ·{" "}
            {formatDate(page.meta.startedAt)}
          </p>
          <h1>
            {page.participants
              .map(
                (participant) =>
                  `${participant.displayName} (${leaderInfo(participant.leaderId).name})`,
              )
              .join(" vs ")}
          </h1>
          <p className="muted">
            {page.meta.winnerId
              ? `${names[page.meta.winnerId]} won`
              : "Unfinished"}{" "}
            · {page.meta.reason ? reasonLabel[page.meta.reason] : ""} ·{" "}
            {page.meta.cycles ?? "—"} Cycles
          </p>
        </div>
        <div className="page-header__actions">
          <label className="inline-field">
            <span>Perspective</span>
            <select
              onChange={(event) =>
                setPerspective(event.target.value as Perspective)
              }
              value={page.perspective}
            >
              {page.perspectives.map((option) => (
                <option key={option} value={option}>
                  {option === "public"
                    ? "Public (no hands)"
                    : `${names[option]}'s view`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <p
        className={`verification ${page.verification.verified ? "is-verified" : "is-failed"}`}
        role="status"
      >
        {page.verification.verified
          ? `✓ Verified: rebuilt from ${page.totalFrames - 1} commands; final state hash ${page.verification.expectedHash.slice(0, 12)} matches.`
          : `⚠ Verification failed: ${page.verification.error ?? "hash mismatch"}. This has been reported. The frames below may not match what was played.`}
      </p>

      <div className="replay-layout">
        <section className="replay-stage">
          <div className="replay-score">
            {(["p1", "p2"] as const).map((seat) => (
              <span className={seat === viewer ? "is-viewer" : ""} key={seat}>
                <strong>{names[seat]}</strong> ♥{" "}
                {frame.view.players[seat].integrity} · ♛{" "}
                {frame.view.players[seat].dominion}/6 · ◈{" "}
                {frame.view.players[seat].focus}/
                {frame.view.players[seat].maxFocus} · ⧗{" "}
                {frame.view.players[seat].time}
              </span>
            ))}
          </div>
          <BoardCanvas
            legalFronts={new Set()}
            legalSlots={new Set()}
            legalTargets={new Set()}
            onIntent={(intent) =>
              intent.entityId &&
              setInspect(
                frame.view.fronts[intent.front].slots[
                  intent.playerId ?? viewer
                ][intent.slot ?? "vanguard"]?.cardId ?? null,
              )
            }
            presentation={presentation}
            reducedMotion={false}
            selectedId={null}
            state={frame.view}
            themePalette={theme.palette}
            viewerId={viewer}
          />
          {hand?.length ? (
            <div className="replay-hand" aria-label={`${names[viewer]}'s hand`}>
              {hand.map((card) => {
                const definition = cardMap.get(card.cardId);
                return definition ? (
                  <button
                    className="hand-slot"
                    key={card.instanceId}
                    onClick={() => setInspect(card.cardId)}
                    type="button"
                  >
                    <CardFace card={definition} size="sm" />
                  </button>
                ) : null;
              })}
            </div>
          ) : null}
        </section>
        <aside className="match-side">
          <section className="match-panel">
            <h2 className="panel-title">
              Command {frame.index} of {frames.length - 1} · Cycle {frame.cycle}
            </h2>
            <p className="replay-command">{commandText}</p>
            <ul className="replay-events">
              {eventLines.map((line, lineIndex) => (
                <li key={`${lineIndex}-${line}`}>{line}</li>
              ))}
            </ul>
            <code
              className="hash-line"
              title="Canonical state hash after this command"
            >
              {frame.hash.slice(0, 16)}
            </code>
          </section>
          {inspected ? (
            <section className="match-panel">
              <CardFace card={inspected} size="lg" />
            </section>
          ) : (
            <p className="muted small">
              Tap a card on the board to read it. {term("leader")} hands are
              only shown from a player&apos;s own view.
            </p>
          )}
        </aside>
      </div>

      <div
        className="replay-controls"
        role="group"
        aria-label="Replay controls"
      >
        <button
          aria-label="First command"
          className="icon-button"
          onClick={() => step(-frames.length)}
          type="button"
        >
          ⏮
        </button>
        <button
          aria-label="Previous command"
          className="icon-button"
          onClick={() => step(-1)}
          type="button"
        >
          ◀
        </button>
        <button
          className="button button--primary"
          onClick={() => setPlaying((value) => !value)}
          type="button"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          aria-label="Next command"
          className="icon-button"
          onClick={() => step(1)}
          type="button"
        >
          ▶
        </button>
        <button
          aria-label="Last command"
          className="icon-button"
          onClick={() => step(frames.length)}
          type="button"
        >
          ⏭
        </button>
        <input
          aria-label="Jump to command"
          max={frames.length - 1}
          min={0}
          onChange={(event) => {
            setPlaying(false);
            setIndex(Number(event.target.value));
          }}
          type="range"
          value={index}
        />
        <select
          aria-label="Playback speed"
          onChange={(event) =>
            setSpeed(Number(event.target.value) as (typeof speeds)[number])
          }
          value={speed}
        >
          {speeds.map((option) => (
            <option key={option} value={option}>
              {option}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
