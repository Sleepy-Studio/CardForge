"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PlayerId } from "@cardforge/card-schema";
import type { CardInstance } from "@cardforge/rules-kernel";
import { glossaryById, tempoFrontRules } from "@cardforge/rules-tempofront";
import { cardMap, leaderInfo } from "@/lib/cards";
import type { MatchSnapshot } from "@/lib/match-connection";
import { remainingMs } from "@/lib/match-connection";
import {
  findInstance,
  presentationCues,
  type BoardLike,
  type PresentationBatch,
} from "@/lib/match-ui";
import {
  directIntents,
  focusCost,
  highlightsFor,
  intentForBoard,
  intentLabel,
  intentsFor,
  narrate,
  opponentOf,
  pendingActionText,
  priorityOf,
  timeCost,
  type Intent,
} from "@/lib/match-view";
import {
  BoardCanvas,
  type BoardHitTest,
  type BoardIntent,
} from "../board-canvas";
import { useGameTheme } from "../theme-provider";
import { CardFace, useThemeAssets } from "../ui/card-face";
import { resolveAsset } from "@/lib/assets";
import { TermTip } from "../ui/term-tip";

const handDragThreshold = 8;

function prettyOption(optionId: string): string {
  const text = optionId.replace(/[-_]+/g, " ").trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : optionId;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listener = () => setReduced(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return reduced;
}

function Clock({
  ms,
  active,
}: {
  readonly ms: number | null;
  readonly active: boolean;
}) {
  if (ms === null) return <span className="match-clock is-idle">—</span>;
  const seconds = Math.ceil(ms / 1_000);
  return (
    <span
      className={`match-clock ${active ? "is-active" : ""} ${seconds <= 10 ? "is-urgent" : ""}`}
      aria-label={`${seconds} seconds left`}
    >
      {seconds}s
    </span>
  );
}

function Timeline({
  view,
  seat,
  preview,
}: {
  readonly view: MatchSnapshot["view"];
  readonly seat: PlayerId;
  readonly preview: number | null;
}) {
  const rival = opponentOf(seat);
  const marks = Array.from(
    { length: tempoFrontRules.timelineLength + 1 },
    (_, index) => index,
  );
  const you = view.players[seat].time;
  const them = view.players[rival].time;
  return (
    <div
      className="match-timeline"
      aria-label={`Timeline: you ${you}, opponent ${them} of ${tempoFrontRules.timelineLength}`}
    >
      <TermTip entry={glossaryById.get("resource.time")}>Time</TermTip>
      <div className="match-timeline__track">
        {marks.map((mark) => (
          <span
            className="match-timeline__tick"
            key={mark}
            style={{
              left: `${(mark / tempoFrontRules.timelineLength) * 100}%`,
            }}
          />
        ))}
        <span
          className="match-timeline__marker is-rival"
          style={{ left: `${(them / tempoFrontRules.timelineLength) * 100}%` }}
        >
          {them}
        </span>
        <span
          className="match-timeline__marker is-you"
          style={{ left: `${(you / tempoFrontRules.timelineLength) * 100}%` }}
        >
          {you}
        </span>
        {preview !== null ? (
          <span
            className="match-timeline__marker is-preview"
            style={{
              left: `${(Math.min(preview, tempoFrontRules.timelineLength) / tempoFrontRules.timelineLength) * 100}%`,
            }}
          >
            {preview}
          </span>
        ) : null}
      </div>
      <TermTip entry={glossaryById.get("concept.initiative")}>
        {view.initiative === seat
          ? "You have Initiative"
          : "Opponent has Initiative"}
      </TermTip>
    </div>
  );
}

export interface MatchTableProps {
  readonly snapshot: MatchSnapshot;
  readonly previous: MatchSnapshot | null;
  readonly connection: "connected" | "reconnecting";
  readonly opponentPresence: "connected" | "reconnecting";
  readonly error: string | null;
  readonly onSend: (intent: Intent) => void;
  readonly onConcede: () => void;
  readonly onLeave: () => void;
}

export function MatchTable({
  snapshot,
  previous,
  connection,
  opponentPresence,
  error,
  onSend,
  onConcede,
  onLeave,
}: MatchTableProps) {
  const { theme, term } = useGameTheme();
  const reducedMotion = useReducedMotion();
  const assets = useThemeAssets();
  const boardArt = resolveAsset(theme, assets, "board", "default");
  const seat = snapshot.seat;
  const rival = opponentOf(seat);
  const view = snapshot.view;
  const board = view as unknown as BoardLike;
  const intents = snapshot.legalIntents;
  const me = view.players[seat];
  const them = view.players[rival];
  const names = {
    [seat]: "You",
    [rival]: snapshot.players[rival]?.displayName ?? "Opponent",
  } as Record<PlayerId, string>;
  const priority = priorityOf(view, seat, intents);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [hoverIntent, setHoverIntent] = useState<Intent | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mulliganIds, setMulliganIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [confirmConcede, setConfirmConcede] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [log, setLog] = useState<readonly string[]>([]);
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const hitTestRef = useRef<BoardHitTest | null>(null);
  const [skipFx, setSkipFx] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  // Selection and prompts reset whenever the authoritative state advances.
  useEffect(() => {
    setSelectedId(null);
    setHoverIntent(null);
    setFeedback(null);
    const lines = snapshot.events
      .map((event) => narrate(event, board, names, theme.terms))
      .filter((line): line is string => Boolean(line));
    if (lines.length)
      setLog((current) => [...lines.reverse(), ...current].slice(0, 60));
  }, [snapshot.commandNumber, snapshot.events]);

  const presentation = useMemo<PresentationBatch | null>(() => {
    if (skipFx || !previous || !snapshot.events.length) return null;
    const cues = presentationCues(snapshot.events, previous.view, board, {
      entity: term("entity"),
      leader: term("leader"),
      front: term("front"),
      dominion: term("dominion"),
    });
    return { sequence: snapshot.commandNumber, cues };
  }, [snapshot, previous, skipFx]);

  const selection = useMemo(
    () => intentsFor(intents, selectedId),
    [intents, selectedId],
  );
  const highlights = useMemo(() => highlightsFor(selection), [selection]);
  const direct = useMemo(() => directIntents(selection), [selection]);
  const passIntent = intents.find((intent) => intent.type === "pass");
  const responseIntents = intents.filter(
    (intent) =>
      intent.type === "play_reaction" || intent.type === "pass_response",
  );
  const choiceIntents = intents.filter(
    (intent) => intent.type === "resolve_choice",
  );
  const actionable = new Set(
    intents.map((intent) => {
      switch (intent.type) {
        case "play_card":
        case "prepare_card":
        case "play_reaction":
          return intent.instanceId;
        case "strike":
          return intent.attackerId;
        case "shift":
          return intent.entityId;
        case "activate_ability":
          return intent.sourceId;
        default:
          return "";
      }
    }),
  );

  const send = useCallback(
    (intent: Intent) => {
      setFeedback(null);
      onSend(intent);
    },
    [onSend],
  );

  const onBoard = useCallback(
    (target: BoardIntent) => {
      if (selectedId) {
        const intent = intentForBoard(selection, target);
        if (intent) {
          send(intent);
          return;
        }
        if (!target.entityId || target.entityId === selectedId) {
          setFeedback(
            "That is not a legal destination for this card. Highlighted spots are legal.",
          );
          return;
        }
      }
      if (target.entityId) {
        setInspectId(target.entityId);
        if (actionable.has(target.entityId)) setSelectedId(target.entityId);
        else if (selectedId)
          setFeedback(
            "That is not a legal target. Highlighted cards can be targeted.",
          );
      }
    },
    [actionable, selectedId, selection, send],
  );

  const selectCard = (instanceId: string) => {
    setInspectId(instanceId);
    setFeedback(null);
    if (priority === "mulligan") {
      setMulliganIds((current) => {
        const next = new Set(current);
        if (next.has(instanceId)) next.delete(instanceId);
        else next.add(instanceId);
        return next;
      });
      return;
    }
    if (!actionable.has(instanceId)) {
      setSelectedId(null);
      setFeedback(
        priority === "opponent"
          ? "Wait for your opponent to act."
          : "You cannot play that card right now — check its Focus and Time costs.",
      );
      return;
    }
    setSelectedId((current) => (current === instanceId ? null : instanceId));
  };

  // Pointer drag from hand onto the board; a plain tap selects instead.
  const onHandPointerDown = (event: ReactPointerEvent, instanceId: string) => {
    if (event.button !== 0 || priority === "mulligan") return;
    setDrag({
      id: instanceId,
      x: event.clientX,
      y: event.clientY,
      active: false,
    });
  };
  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) =>
      setDrag((current) =>
        current
          ? {
              ...current,
              x: event.clientX,
              y: event.clientY,
              active:
                current.active ||
                Math.hypot(
                  event.clientX - current.x,
                  event.clientY - current.y,
                ) > handDragThreshold,
            }
          : null,
      );
    const up = (event: PointerEvent) => {
      const current = drag;
      setDrag(null);
      if (!current.active) return;
      const target = hitTestRef.current?.(event.clientX, event.clientY);
      const dragIntents = intentsFor(intents, current.id);
      if (!dragIntents.length) {
        setFeedback("You cannot play that card right now.");
        return;
      }
      const intent = target ? intentForBoard(dragIntents, target) : null;
      if (intent) send(intent);
      else {
        setSelectedId(current.id);
        setFeedback(
          "Drop it on a highlighted spot, or tap a highlighted target.",
        );
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, intents, send]);

  useEffect(() => {
    if (drag?.active) setSelectedId(drag.id);
  }, [drag?.active, drag?.id]);

  const inspected = inspectId ? findInstance(board, inspectId) : null;
  const inspectedCard = inspected ? cardMap.get(inspected.cardId) : undefined;
  const preview = hoverIntent
    ? me.time + timeCost(view, seat, hoverIntent)
    : null;
  const myClock = remainingMs(snapshot, seat, now);
  const theirClock = remainingMs(snapshot, rival, now);
  const pending = pendingActionText(view, names);
  const hand: readonly CardInstance[] = me.hand ?? [];
  const status =
    priority === "mulligan"
      ? "Choose cards to replace, then confirm your opening hand."
      : priority === "your_action"
        ? "Your action. Select a card or Entity — or pass for this Cycle."
        : priority === "your_response"
          ? "Your opponent is acting. Respond with a Reaction or let it resolve."
          : priority === "your_counter"
            ? "Your opponent responded. Counter-respond or let the chain resolve."
            : priority === "your_choice"
              ? "Make a choice to continue."
              : priority === "finished"
                ? "The match is over."
                : `${names[rival]} is acting…`;

  return (
    <div
      className="match-table"
      data-command={snapshot.commandNumber}
      data-priority={priority}
      data-seat={seat}
      data-connection={connection}
    >
      <header className="match-bar match-bar--rival">
        <div className="match-player">
          <strong>{names[rival]}</strong>
          <small>
            {
              leaderInfo(
                snapshot.players[rival]?.leaderId ?? them.leader.cardId,
              ).name
            }
          </small>
          {opponentPresence === "reconnecting" ? (
            <em className="presence-warning">Reconnecting…</em>
          ) : null}
        </div>
        <div className="match-stats">
          <TermTip entry={glossaryById.get("victory.integrity")}>
            ♥ {them.integrity}
          </TermTip>
          <TermTip entry={glossaryById.get("victory.dominion")}>
            ♛ {them.dominion}/6
          </TermTip>
          <TermTip entry={glossaryById.get("resource.focus")}>
            ◈ {them.focus}/{them.maxFocus}
          </TermTip>
          <span title="Cards in hand">✋ {them.handCount}</span>
          <span title="Cards in deck">▤ {them.deckCount}</span>
          <Clock active={priority === "opponent"} ms={theirClock} />
        </div>
        <div className="match-menu">
          <span className="match-cycle">Cycle {view.cycle}</span>
          <button
            className="button button--quiet button--small"
            onClick={() => setSkipFx((value) => !value)}
            type="button"
          >
            {skipFx ? "Effects off" : "Effects on"}
          </button>
          <button
            className="button button--quiet button--small"
            onClick={() => setConfirmConcede(true)}
            type="button"
          >
            Concede
          </button>
        </div>
      </header>

      <Timeline preview={preview} seat={seat} view={view} />

      <div className="match-status-row">
        <p
          className={`match-status match-status--${priority}`}
          role="status"
          aria-live="polite"
        >
          {connection === "reconnecting"
            ? "Connection lost — reconnecting…"
            : status}
        </p>
        {snapshot.scenario ? (
          <details className="scenario-strip" open>
            <summary>
              <strong>{snapshot.scenario.title}</strong> —{" "}
              {snapshot.scenario.summary}
            </summary>
            <ol>
              {snapshot.scenario.steps.map((step) => (
                <li key={step.title}>
                  <b>{step.title}.</b> {step.instruction}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>

      <div className="match-layout">
        <section className="match-board" aria-label="Battlefield">
          <BoardCanvas
            aimAtLeader={highlights.leaderTargeted}
            backgroundUrl={boardArt}
            aimFrom={selectedId}
            legalFronts={highlights.fronts}
            legalSlots={highlights.slots}
            legalTargets={highlights.targets}
            onHitTest={(hitTest) => {
              hitTestRef.current = hitTest;
            }}
            onIntent={onBoard}
            presentation={presentation}
            reducedMotion={reducedMotion}
            selectedId={selectedId}
            state={view}
            themePalette={theme.palette}
            viewerId={seat}
          />
          {feedback ? (
            <p className="board-feedback" role="alert">
              {feedback}
            </p>
          ) : null}
        </section>

        <aside className="match-side">
          <section className="match-panel" aria-label="Card details">
            {inspectedCard ? (
              <CardFace
                card={inspectedCard}
                damage={inspected?.damage ?? 0}
                size="lg"
              />
            ) : (
              <p className="muted">
                Tap or hover any card to read it. Keywords explain themselves on
                tap.
              </p>
            )}
          </section>
          {selection.length ? (
            <section
              className="match-panel"
              aria-label="Actions for the selected card"
            >
              <h2 className="panel-title">Actions</h2>
              {selection.length > direct.length ? (
                <p className="hint">
                  Tap a highlighted slot or target on the board — or drag the
                  card there.
                </p>
              ) : null}
              <div className="intent-list">
                {(direct.length ? direct : selection.slice(0, 8)).map(
                  (intent, index) => {
                    const time = timeCost(view, seat, intent);
                    const focus = focusCost(view, intent);
                    return (
                      <button
                        className="intent-button"
                        key={`${JSON.stringify(intent)}-${index}`}
                        onBlur={() => setHoverIntent(null)}
                        onClick={() => send(intent)}
                        onFocus={() => setHoverIntent(intent)}
                        onMouseEnter={() => setHoverIntent(intent)}
                        onMouseLeave={() => setHoverIntent(null)}
                        type="button"
                      >
                        <span>{intentLabel(view, intent, theme.terms)}</span>
                        <small>
                          {focus ? `${focus} ${term("focus")} · ` : ""}+{time}{" "}
                          Time → {me.time + time}
                        </small>
                      </button>
                    );
                  },
                )}
              </div>
            </section>
          ) : null}
          <section className="match-panel match-log" aria-label="Match log">
            <h2 className="panel-title">Log</h2>
            <ol>
              {log.slice(0, 14).map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <footer className="match-dock">
        <div className="match-bar match-bar--you">
          <div className="match-player">
            <strong>You</strong>
            <small>{leaderInfo(me.leader.cardId).name}</small>
          </div>
          <div className="match-stats">
            <TermTip entry={glossaryById.get("victory.integrity")}>
              ♥ {me.integrity}
            </TermTip>
            <TermTip entry={glossaryById.get("victory.dominion")}>
              ♛ {me.dominion}/6
            </TermTip>
            <TermTip entry={glossaryById.get("resource.focus")}>
              ◈ {me.focus}/{me.maxFocus}
            </TermTip>
            <span title="Cards in deck">▤ {me.deckCount}</span>
            <Clock
              active={priority !== "opponent" && priority !== "finished"}
              ms={myClock}
            />
          </div>
          <div className="match-primary-actions">
            {intents.some(
              (intent) =>
                intent.type === "activate_ability" &&
                intent.sourceId === me.leader.instanceId,
            ) ? (
              <button
                className="button button--quiet"
                onClick={() => selectCard(me.leader.instanceId)}
                type="button"
              >
                {term("leader")} Command
              </button>
            ) : null}
            {passIntent && priority === "your_action" ? (
              <button
                className="button button--quiet"
                onClick={() => send(passIntent)}
                type="button"
              >
                Pass for this Cycle
              </button>
            ) : null}
          </div>
        </div>
        <div className="match-hand" aria-label="Your hand">
          {hand.map((card) => {
            const definition = cardMap.get(card.cardId);
            if (!definition) return null;
            const playable = actionable.has(card.instanceId);
            const replacing = mulliganIds.has(card.instanceId);
            return (
              <button
                aria-pressed={selectedId === card.instanceId || replacing}
                className={`hand-slot ${playable ? "is-playable" : ""} ${replacing ? "is-replacing" : ""}`}
                data-instance={card.instanceId}
                key={card.instanceId}
                onClick={() => selectCard(card.instanceId)}
                onMouseEnter={() => setInspectId(card.instanceId)}
                onPointerDown={(event) =>
                  onHandPointerDown(event, card.instanceId)
                }
                type="button"
              >
                <CardFace
                  card={definition}
                  dimmed={priority !== "mulligan" && !playable}
                  selected={selectedId === card.instanceId}
                  size="sm"
                />
                {replacing ? (
                  <span className="hand-slot__tag">Replace</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </footer>

      {priority === "mulligan" ? (
        <div className="prompt-bar" role="dialog" aria-label="Opening hand">
          <p>
            <strong>Opening hand.</strong> Tap cards to replace (
            {mulliganIds.size} selected). You may mulligan once.
          </p>
          <button
            className="button button--primary"
            onClick={() => {
              send({ type: "mulligan", instanceIds: [...mulliganIds] });
              setMulliganIds(new Set());
            }}
            type="button"
          >
            {mulliganIds.size
              ? `Replace ${mulliganIds.size} and start`
              : "Keep hand and start"}
          </button>
        </div>
      ) : null}

      {(priority === "your_response" || priority === "your_counter") &&
      responseIntents.length ? (
        <div
          className="prompt-bar prompt-bar--response"
          role="dialog"
          aria-label="Response window"
        >
          <p>
            <TermTip
              entry={glossaryById.get(
                priority === "your_counter"
                  ? "timing.counter-response"
                  : "timing.response",
              )}
            />{" "}
            {pending ?? "An action is waiting to resolve."}
          </p>
          <div className="prompt-actions">
            {responseIntents.map((intent, index) => (
              <button
                className={`button ${intent.type === "pass_response" ? "button--quiet" : "button--primary"}`}
                key={`${intent.type}-${index}`}
                onClick={() => send(intent)}
                type="button"
              >
                {intentLabel(view, intent, theme.terms)}
                {intent.type === "play_reaction"
                  ? ` (+${timeCost(view, seat, intent)} Time)`
                  : ""}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {priority === "your_choice" && choiceIntents.length ? (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="choice-title"
          >
            <h2 id="choice-title">
              {view.pendingChoice?.kind === "optional_focus"
                ? `Pay ${view.pendingChoice.focusAmount ?? ""} ${term("focus")}?`
                : view.pendingChoice?.kind === "select_card"
                  ? "Choose a card"
                  : "Choose one"}
            </h2>
            <div className="choice-grid">
              {choiceIntents.map((intent, index) => {
                if (intent.type !== "resolve_choice") return null;
                const option = intent.optionIds[0] ?? "";
                const card = view.pendingChoice?.cardOptions?.find(
                  (item) => item.instanceId === option,
                );
                const definition = card ? cardMap.get(card.cardId) : undefined;
                return (
                  <button
                    className="choice-option"
                    key={`${option}-${index}`}
                    onClick={() => send(intent)}
                    type="button"
                  >
                    {definition ? (
                      <CardFace card={definition} size="md" />
                    ) : (
                      <span>
                        {option === "pay"
                          ? `Pay ${term("focus")}`
                          : option === "decline"
                            ? "Decline"
                            : prettyOption(option)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {confirmConcede ? (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="concede-title"
          >
            <h2 id="concede-title">Concede this match?</h2>
            <p className="muted">
              Your opponent wins immediately. This cannot be undone.
            </p>
            <div className="action-row">
              <button
                className="button button--danger"
                onClick={onConcede}
                type="button"
              >
                Concede
              </button>
              <button
                className="button button--quiet"
                onClick={() => setConfirmConcede(false)}
                type="button"
              >
                Keep playing
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {drag?.active ? (
        <div
          className="drag-ghost"
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          {cardMap.get(findInstance(board, drag.id)?.cardId ?? "")?.name}
        </div>
      ) : null}
      {error ? (
        <p className="match-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="sr-only" onClick={onLeave} type="button">
        Leave match
      </button>
    </div>
  );
}
