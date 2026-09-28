"use client";

import type { Room } from "@colyseus/sdk";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerId } from "@cardforge/card-schema";
import { messageFor, useApi } from "@/lib/api";
import { leaderInfo } from "@/lib/cards";
import {
  clearRejoin,
  connectToMatch,
  readRejoin,
  saveRejoin,
  type MatchMode,
  type MatchRequest,
  type MatchSnapshot,
} from "@/lib/match-connection";
import type { Intent } from "@/lib/match-view";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { useRequireAccount } from "@/lib/session";
import { useGameTheme } from "../theme-provider";
import { MatchTable } from "./match-table";

type Phase =
  "connecting" | "searching" | "playing" | "finished" | "failed" | "left";

const modeTitle: Readonly<Record<MatchMode, string>> = {
  casual: "Casual",
  ranked: "Ranked",
  friend: "Friend Match",
  practice: "Practice",
  training: "Lesson",
};

const reasonText = (reason: string, terms: Readonly<Record<string, string>>) =>
  reason === "dominion"
    ? `${terms.dominion ?? "Dominion"} victory`
    : reason === "integrity"
      ? `${terms.integrity ?? "Integrity"} victory`
      : reason === "concession"
        ? "Concession"
        : "Opponent left the match";

function requestFromParams(params: URLSearchParams): MatchRequest | null {
  const mode = params.get("mode") as MatchMode | null;
  if (!mode || !(mode in modeTitle)) return null;
  const deckId = params.get("deck") ?? undefined;
  const inviteCode = params.get("code")?.toUpperCase() ?? undefined;
  const scenarioId = params.get("scenario") ?? undefined;
  const opponentLeaderId = params.get("opponent") ?? undefined;
  return {
    mode,
    ...(deckId ? { deckId } : {}),
    ...(inviteCode ? { inviteCode } : {}),
    ...(scenarioId ? { scenarioId } : {}),
    ...(opponentLeaderId ? { opponentLeaderId } : {}),
  };
}

/**
 * Owns one authoritative room: ticket → join or search → play → result.
 * All state shown comes from server snapshots; the client only sends
 * intents the server listed as legal.
 */
export function MatchClient() {
  const account = useRequireAccount();
  const api = useApi();
  const { apiUrl } = useRuntimeConfig();
  const { theme } = useGameTheme();
  const router = useRouter();
  const params = useSearchParams();
  const [phase, setPhase] = useState<Phase>("connecting");
  const [mode, setMode] = useState<MatchMode>(
    (params.get("mode") as MatchMode) ?? "casual",
  );
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [previous, setPrevious] = useState<MatchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<"connected" | "reconnecting">(
    "connected",
  );
  const [opponentPresence, setOpponentPresence] = useState<
    "connected" | "reconnecting"
  >("connected");
  const [searchStarted] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const roomRef = useRef<Room | null>(null);
  // One command in flight at a time: a double tap must not send twice.
  const inFlight = useRef<number | null>(null);
  const snapshotRef = useRef<MatchSnapshot | null>(null);
  const started = useRef(false);
  const onboarding = params.get("onboarding") === "1";

  useEffect(() => {
    if (phase !== "searching") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const attach = useCallback((room: Room, roomMode: MatchMode) => {
    roomRef.current = room;
    setMode(roomMode);
    saveRejoin(room, roomMode);
    room.onMessage("waiting", () => setPhase("searching"));
    room.onMessage("seat", () => undefined);
    room.onMessage(
      "snapshot",
      (message: Omit<MatchSnapshot, "receivedAtMs"> | null) => {
        if (!message) return;
        inFlight.current = null;
        const next = { ...message, receivedAtMs: Date.now() };
        setPrevious(snapshotRef.current);
        snapshotRef.current = next;
        setSnapshot(next);
        setConnection("connected");
        setPhase(message.outcome || message.finished ? "finished" : "playing");
        if (message.outcome || message.finished) clearRejoin();
        else saveRejoin(room, roomMode);
      },
    );
    room.onMessage(
      "presence",
      (message: { seat: PlayerId; status: "connected" | "reconnecting" }) => {
        setOpponentPresence(message.status);
      },
    );
    room.onMessage("command_error", (message: { message?: string }) => {
      inFlight.current = null;
      setError(message.message ?? "The server rejected that action.");
    });
    room.onDrop(() => setConnection("reconnecting"));
    room.onReconnect(() => {
      setConnection("connected");
      saveRejoin(room, roomMode);
    });
    room.onLeave(() =>
      setPhase((current) => (current === "finished" ? current : "left")),
    );
    room.send("ready");
  }, []);

  useEffect(() => {
    if (!account || started.current) return;
    started.current = true;
    // A fresh reconnection record means this tab was already in a match
    // (e.g. the page was reloaded): reconnect instead of joining again.
    const rejoin = readRejoin();
    const request = requestFromParams(params);
    const joinFresh = () => {
      if (!request) {
        setError("Choose a mode from the Play menu.");
        setPhase("failed");
        return;
      }
      void connectToMatch(api, apiUrl, request)
        .then(({ room, mode: roomMode }) => attach(room, roomMode))
        .catch((caught: unknown) => {
          setError(messageFor(caught));
          setPhase("failed");
        });
    };
    if (rejoin)
      void connectToMatch(api, apiUrl, { rejoin })
        .then(({ room, mode: roomMode }) => attach(room, roomMode))
        .catch(() => {
          clearRejoin();
          joinFresh();
        });
    else joinFresh();
  }, [account, api, apiUrl, attach, params]);

  useEffect(
    () => () => {
      void roomRef.current?.leave().catch(() => undefined);
    },
    [],
  );

  const leave = async (destination = "/play") => {
    const room = roomRef.current;
    roomRef.current = null;
    clearRejoin();
    await room?.leave().catch(() => undefined);
    router.push(destination);
  };

  const send = (intent: Intent) => {
    // Ignore repeats until the server answers (or 3 s pass, if a reply is lost).
    if (inFlight.current !== null && Date.now() - inFlight.current < 3_000)
      return;
    inFlight.current = Date.now();
    setError(null);
    roomRef.current?.send("command", intent);
  };

  if (!account) return <p className="loading-line">Loading…</p>;

  if (phase === "connecting" || phase === "searching") {
    const seconds = Math.floor((now - searchStarted) / 1_000);
    const inviteCode = params.get("code")?.toUpperCase();
    return (
      <section className="search-screen" data-phase={phase} aria-live="polite">
        <p className="eyebrow">{modeTitle[mode]}</p>
        <h1>
          {phase === "connecting"
            ? "Connecting…"
            : mode === "friend"
              ? "Waiting for your friend"
              : "Finding an opponent"}
        </h1>
        {phase === "searching" && mode === "friend" && inviteCode ? (
          <p className="muted">
            Share code <strong className="invite-code">{inviteCode}</strong> —
            the match starts as soon as they join.
          </p>
        ) : null}
        {phase === "searching" && mode !== "friend" ? (
          <p className="muted">
            Searching for {Math.floor(seconds / 60)}:
            {String(seconds % 60).padStart(2, "0")}. The match starts
            automatically.
          </p>
        ) : null}
        <div className="search-pulse" aria-hidden="true" />
        <button
          className="button button--quiet"
          onClick={() => void leave()}
          type="button"
        >
          Cancel
        </button>
      </section>
    );
  }

  if (phase === "failed" || (phase === "left" && !snapshot)) {
    return (
      <section className="search-screen" data-phase="failed">
        <h1>Could not start the match</h1>
        <p className="form-error" role="alert">
          {error ?? "The connection closed."}
        </p>
        <div className="action-row">
          <Link className="button button--primary" href="/play">
            Back to Play
          </Link>
          {mode !== "training" && mode !== "practice" ? (
            <Link className="button button--quiet" href="/decks">
              Check my decks
            </Link>
          ) : null}
        </div>
      </section>
    );
  }

  if (!snapshot) return <p className="loading-line">Loading…</p>;
  const outcome = snapshot.outcome;
  const won = outcome ? outcome.winnerId === snapshot.seat : false;
  const settlement = snapshot.competitive.settlement;
  const ratingDelta = settlement?.ratingDelta[snapshot.seat];
  const scenarioDone = snapshot.finished && !outcome;

  return (
    <>
      <MatchTable
        connection={connection}
        error={error}
        onConcede={() => roomRef.current?.send("concede")}
        onLeave={() => void leave()}
        onSend={send}
        opponentPresence={opponentPresence}
        previous={previous}
        snapshot={snapshot}
      />
      {phase === "finished" || phase === "left" ? (
        <div className="modal-backdrop">
          <section
            className={`result-card ${outcome ? (won ? "is-victory" : "is-defeat") : ""}`}
            data-result={outcome ? (won ? "victory" : "defeat") : "complete"}
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-title"
          >
            <p className="eyebrow">{modeTitle[mode]}</p>
            <h2 id="result-title">
              {outcome
                ? won
                  ? "Victory"
                  : "Defeat"
                : scenarioDone
                  ? "Scenario complete"
                  : "Match ended"}
            </h2>
            {outcome ? (
              <p className="muted">{reasonText(outcome.reason, theme.terms)}</p>
            ) : null}
            {snapshot.completion ? (
              <p>
                {snapshot.completion.firstCompletion
                  ? "First completion — reward added to your wallet."
                  : "Already completed — no new reward."}
              </p>
            ) : null}
            <dl className="reward-list">
              {outcome?.reward &&
              (outcome.reward.shards > 0 ||
                outcome.reward.xp > 0 ||
                settlement) ? (
                <>
                  <div>
                    <dt>Shards</dt>
                    <dd>+{outcome.reward.shards}</dd>
                  </div>
                  <div>
                    <dt>Experience</dt>
                    <dd>
                      +
                      {outcome.reward.xp +
                        (settlement?.xpGained[snapshot.seat] ?? 0)}{" "}
                      XP
                    </dd>
                  </div>
                  {outcome.reward.levelAfter > outcome.reward.levelBefore ? (
                    <div>
                      <dt>Level up</dt>
                      <dd>Level {outcome.reward.levelAfter}</dd>
                    </div>
                  ) : null}
                </>
              ) : null}
              {typeof ratingDelta === "number" ? (
                <div>
                  <dt>Rating</dt>
                  <dd
                    className={ratingDelta >= 0 ? "is-positive" : "is-negative"}
                  >
                    {ratingDelta >= 0 ? "+" : ""}
                    {ratingDelta} → {settlement?.profiles[snapshot.seat].rating}
                  </dd>
                </div>
              ) : null}
            </dl>
            {outcome?.reward?.newlyUnlockedLeaderIds.length ? (
              <p className="unlock-line">
                Unlocked:{" "}
                {outcome.reward.newlyUnlockedLeaderIds
                  .map((id) => leaderInfo(id).name)
                  .join(", ")}
              </p>
            ) : null}
            {mode === "friend" && outcome ? (
              <p className="muted">Friend matches do not award currency.</p>
            ) : null}
            <div className="action-row">
              {onboarding ? (
                <button
                  className="button button--primary"
                  onClick={() =>
                    void api("/api/me/onboarding/complete", { body: {} })
                      .catch(() => undefined)
                      .then(() => leave("/play"))
                  }
                  type="button"
                >
                  Continue to Play
                </button>
              ) : (
                <button
                  className="button button--primary"
                  onClick={() => void leave("/play")}
                  type="button"
                >
                  Play again
                </button>
              )}
              {outcome ? (
                <button
                  className="button button--quiet"
                  onClick={() => void leave(`/replay/${snapshot.matchId}`)}
                  type="button"
                >
                  Watch replay
                </button>
              ) : null}
              <button
                className="button button--quiet"
                onClick={() => void leave("/")}
                type="button"
              >
                Home
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
