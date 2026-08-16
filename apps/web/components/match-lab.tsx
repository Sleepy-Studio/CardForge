"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FrontId, PlayerId } from "@cardforge/card-schema";
import type { Command, GameState } from "@cardforge/rules-kernel";
import { generateRulesText } from "@cardforge/rules-tempofront";
import { BoardCanvas, type BoardIntent } from "./board-canvas";
import {
  activePlayer,
  browserEngine,
  chooseBotCommand,
  commandLabel,
  commandTime,
  createBrowserMatch,
  definitionForInstance,
  eventLabel,
  findInstance,
} from "@/lib/match-ui";

type MatchMode = "bot" | "hotseat";

function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === "p1" ? "p2" : "p1";
}

function playerName(playerId: PlayerId): string {
  return playerId === "p1" ? "Player 1" : "Player 2";
}

function Timeline({
  state,
  viewerId,
}: {
  readonly state: GameState;
  readonly viewerId: PlayerId;
}) {
  const rivalId = opponentOf(viewerId);
  return (
    <div className="timeline" aria-label="Shared Timeline">
      <div className="timeline__track">
        {Array.from({ length: 13 }, (_, value) => (
          <span className="timeline__tick" key={value}>
            {value}
          </span>
        ))}
        <span
          className="timeline__marker timeline__marker--rival"
          style={{
            left: `${Math.min(state.players[rivalId].time, 12) * (100 / 12)}%`,
          }}
          title={`${playerName(rivalId)} Time ${state.players[rivalId].time}`}
        />
        <span
          className="timeline__marker timeline__marker--player"
          style={{
            left: `${Math.min(state.players[viewerId].time, 12) * (100 / 12)}%`,
          }}
          title={`${playerName(viewerId)} Time ${state.players[viewerId].time}`}
        />
      </div>
      <div className="timeline__legend">
        <span>
          <i className="dot dot--player" /> {playerName(viewerId)}{" "}
          {state.players[viewerId].time}
        </span>
        <strong>SHARED TIMELINE // CYCLE {state.cycle}</strong>
        <span>
          <i className="dot dot--rival" /> {playerName(rivalId)}{" "}
          {state.players[rivalId].time}
        </span>
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <span className="stat-pill">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

export function MatchLab() {
  const [state, setState] = useState(() => createBrowserMatch());
  const [mode, setMode] = useState<MatchMode>("bot");
  const [viewerId, setViewerId] = useState<PlayerId>("p1");
  const [handoffTo, setHandoffTo] = useState<PlayerId | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mulliganIds, setMulliganIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [history, setHistory] = useState<readonly string[]>([
    "Match seed locked. Awaiting mulligans.",
  ]);
  const [matchOrdinal, setMatchOrdinal] = useState(0);
  const [botThinking, setBotThinking] = useState(false);

  const active = activePlayer(state);
  const rivalId = opponentOf(viewerId);
  const privacyLocked = mode === "hotseat" && handoffTo !== null;
  const legal = useMemo(
    () =>
      !privacyLocked && active === viewerId
        ? browserEngine.getLegalCommands(state, viewerId)
        : [],
    [active, privacyLocked, state, viewerId],
  );

  const apply = useCallback(
    (command: Command) => {
      const result = browserEngine.applyCommand(state, command);
      setHistory((items) =>
        [...result.events.map(eventLabel).reverse(), ...items].slice(0, 18),
      );
      setState(result.state);
      setSelectedId(null);
      if (mode === "hotseat") {
        const nextPlayer = activePlayer(result.state);
        if (nextPlayer && nextPlayer !== viewerId) setHandoffTo(nextPlayer);
      }
    },
    [mode, state, viewerId],
  );

  useEffect(() => {
    if (mode !== "bot" || active !== "p2" || state.winner) {
      setBotThinking(false);
      return;
    }
    setBotThinking(true);
    const timer = window.setTimeout(() => {
      const commands = browserEngine.getLegalCommands(state, "p2");
      const command = chooseBotCommand(state, commands);
      const result = browserEngine.applyCommand(state, command);
      setHistory((items) =>
        [...result.events.map(eventLabel).reverse(), ...items].slice(0, 18),
      );
      setState(result.state);
      setBotThinking(false);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [active, mode, state]);

  const selectedCommands = useMemo(() => {
    if (!selectedId) return legal;
    return legal.filter((command) => {
      switch (command.type) {
        case "play_card":
        case "prepare_card":
        case "play_reaction":
          return command.instanceId === selectedId;
        case "strike":
          return command.attackerId === selectedId;
        case "shift":
          return command.entityId === selectedId;
        case "activate_ability":
          return command.sourceId === selectedId;
        default:
          return true;
      }
    });
  }, [legal, selectedId]);

  const legalSlots = useMemo(() => {
    const result = new Set<string>();
    for (const command of selectedCommands) {
      if (command.type === "play_card" && command.front && command.slot)
        result.add(`${command.front}:${command.slot}`);
      if (command.type === "shift")
        result.add(`${command.toFront}:${command.toSlot}`);
    }
    return result;
  }, [selectedCommands]);

  const legalTargets = useMemo(() => {
    const result = new Set<string>();
    for (const command of selectedCommands) {
      if (
        (command.type === "play_card" ||
          command.type === "play_reaction" ||
          command.type === "activate_ability") &&
        command.targetId
      )
        result.add(command.targetId);
      if (
        (command.type === "play_card" ||
          command.type === "play_reaction" ||
          command.type === "activate_ability") &&
        command.targetIds
      )
        for (const target of command.targetIds) result.add(target);
      if (command.type === "strike" && command.targetId !== "leader")
        result.add(command.targetId);
    }
    return result;
  }, [selectedCommands]);

  const legalFronts = useMemo(() => {
    const result = new Set<FrontId>();
    for (const command of selectedCommands)
      if (command.type === "play_card" && command.front && !command.slot)
        result.add(command.front);
    return result;
  }, [selectedCommands]);

  const onBoardIntent = useCallback(
    (intent: BoardIntent) => {
      if (intent.entityId) {
        const command = selectedCommands.find((candidate) => {
          if (candidate.type === "strike")
            return candidate.targetId === intent.entityId;
          if (
            candidate.type === "play_card" ||
            candidate.type === "play_reaction" ||
            candidate.type === "activate_ability"
          )
            return candidate.targetId === intent.entityId;
          return false;
        });
        if (command) {
          apply(command);
          return;
        }
        setSelectedId(intent.entityId);
        return;
      }
      const destination = selectedCommands.find((candidate) => {
        if (candidate.type === "shift")
          return (
            candidate.toFront === intent.front &&
            candidate.toSlot === intent.slot
          );
        if (candidate.type !== "play_card") return false;
        return (
          candidate.front === intent.front &&
          (candidate.slot === intent.slot ||
            (!candidate.slot && intent.slot === undefined))
        );
      });
      if (destination) apply(destination);
    },
    [apply, selectedCommands],
  );

  const selected = selectedId ? findInstance(state, selectedId) : null;
  const selectedDefinition = definitionForInstance(state, selectedId);
  const visibleActions = useMemo(() => {
    const commands = selectedCommands.filter(
      (command) => command.type !== "mulligan",
    );
    const visible = commands.slice(0, 23);
    const pass = commands.find((command) => command.type === "pass");
    if (pass && !visible.includes(pass)) visible.push(pass);
    return visible;
  }, [selectedCommands]);

  const resetMatch = (nextMode = mode) => {
    const nextOrdinal = matchOrdinal + 1;
    setMatchOrdinal(nextOrdinal);
    setState(createBrowserMatch(20260816 + nextOrdinal));
    setMode(nextMode);
    setViewerId("p1");
    setHandoffTo(null);
    setBotThinking(false);
    setHistory([
      nextMode === "hotseat"
        ? "Hot-seat match locked. Player 1 may inspect the opening hand."
        : "New deterministic bot match seed locked.",
    ]);
    setMulliganIds(new Set());
    setSelectedId(null);
  };

  const revealHandoff = () => {
    if (!handoffTo) return;
    setViewerId(handoffTo);
    setHandoffTo(null);
    setMulliganIds(new Set());
    setSelectedId(null);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">CF</span>
          <div>
            <p>CARD FORGE // LAB BUILD 03</p>
            <h1>TempoFront</h1>
          </div>
        </div>
        <div className="match-meta">
          <div className="mode-switch" aria-label="Match mode">
            {(["bot", "hotseat"] as const).map((option) => (
              <button
                className={`mode-button ${mode === option ? "is-active" : ""}`}
                data-mode={option}
                key={option}
                onClick={() => {
                  if (option !== mode) resetMatch(option);
                }}
                type="button"
              >
                {option === "bot" ? "VS BOT" : "HOT-SEAT"}
              </button>
            ))}
          </div>
          <span
            className={`status-light ${botThinking ? "is-thinking" : ""}`}
          />
          {state.winner
            ? `${state.winner === viewerId ? "VICTORY" : "DEFEAT"} // ${state.victoryReason}`
            : botThinking
              ? "RIVAL CALCULATING"
              : privacyLocked
                ? "HANDOFF LOCKED"
                : active === viewerId
                  ? `${playerName(viewerId).toUpperCase()} PRIORITY`
                  : `AWAITING ${active ? playerName(active).toUpperCase() : "RESOLUTION"}`}
          <button
            className="button button--quiet"
            onClick={() => resetMatch()}
            type="button"
          >
            New seed
          </button>
        </div>
      </header>

      <section className="opponent-bar" aria-label="Opponent status">
        <div className="leader-chip leader-chip--rival">
          <small>{playerName(rivalId).toUpperCase()} CORE</small>
          <strong>{state.players[rivalId].integrity}</strong>
        </div>
        <div className="opponent-summary">
          <span>{state.players[rivalId].hand.length} cards</span>
          <span>{state.players[rivalId].deck.length} deck</span>
          <span>
            {state.players[rivalId].reserve ? "Reserve armed" : "Reserve empty"}
          </span>
        </div>
        <div className="stat-cluster">
          <StatPill
            label="FOCUS"
            value={`${state.players[rivalId].focus}/${state.players[rivalId].maxFocus}`}
          />
          <StatPill
            label="DOM"
            value={`${state.players[rivalId].dominion}/6`}
          />
        </div>
      </section>

      <Timeline state={state} viewerId={viewerId} />

      <div className="match-grid">
        <section className="arena-panel" aria-label="TempoFront board">
          <BoardCanvas
            state={state}
            viewerId={viewerId}
            selectedId={selectedId}
            legalSlots={legalSlots}
            legalTargets={legalTargets}
            legalFronts={legalFronts}
            onIntent={onBoardIntent}
          />
          <div className="sr-only">
            {(["left", "center", "right"] as const).map((front) => (
              <section key={front}>
                <h2>{front} Front</h2>
                {([rivalId, viewerId] as const).flatMap((side) =>
                  (["vanguard", "support"] as const).map((slot) => {
                    const entity = state.fronts[front].slots[side][slot];
                    const definition = entity
                      ? browserEngine.cards.get(entity.cardId)
                      : undefined;
                    return (
                      <p key={`${side}-${slot}`}>
                        {side === viewerId ? "Your" : "Opponent"} {slot}:{" "}
                        {definition?.name ?? "empty"}
                        {entity ? `, ${entity.damage} damage` : ""}
                      </p>
                    );
                  }),
                )}
              </section>
            ))}
          </div>
          <div className="board-caption">
            <span>PIXI // WEBGL FIELD</span>
            <span>Click an Entity or card, then a glowing destination.</span>
          </div>
        </section>

        <aside className="right-rail">
          <section className="panel inspector">
            <div className="panel-heading">
              <span>INSPECTOR</span>
              <small>{selectedDefinition?.type ?? "no selection"}</small>
            </div>
            {selectedDefinition ? (
              <div className="inspector-card">
                <div
                  className={`aspect-stripe aspect-stripe--${selectedDefinition.aspects[0] ?? "neutral"}`}
                />
                <p className="eyebrow">{selectedDefinition.cardId}</p>
                <h2>{selectedDefinition.name}</h2>
                <div className="cost-line">
                  <StatPill
                    label="FOCUS"
                    value={selectedDefinition.focusCost}
                  />
                  <StatPill label="TIME" value={selectedDefinition.playTime} />
                  {selectedDefinition.power !== undefined ? (
                    <StatPill
                      label="P/V/PR"
                      value={`${selectedDefinition.power}/${selectedDefinition.vitality}/${selectedDefinition.presence}`}
                    />
                  ) : null}
                </div>
                <p className="rules-text">
                  {generateRulesText(selectedDefinition) ||
                    "Persistent battlefield asset."}
                </p>
                {selected ? (
                  <p className="instance-line">
                    {selected.ready ? "READY" : "SPENT"} // DMG{" "}
                    {selected.damage} // {selected.statuses.length} STATUS
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="empty-copy">
                Select a card or Entity to inspect its authoritative definition.
              </p>
            )}
          </section>

          <section className="panel action-panel">
            <div className="panel-heading">
              <span>LEGAL ACTIONS</span>
              <small>{visibleActions.length}</small>
            </div>
            <div className="action-list">
              {visibleActions.map((command, index) => {
                const delta = commandTime(state, command);
                return (
                  <button
                    className="action-button"
                    key={`${JSON.stringify(command)}-${index}`}
                    onClick={() => apply(command)}
                    type="button"
                  >
                    <span>{commandLabel(state, command)}</span>
                    {delta > 0 ? (
                      <small>
                        +{delta}T → {state.players.p1.time + delta}
                      </small>
                    ) : null}
                  </button>
                );
              })}
              {visibleActions.length === 0 ? (
                <p className="empty-copy">
                  {privacyLocked
                    ? "Private controls are locked for handoff."
                    : active !== viewerId
                      ? `${playerName(active ?? rivalId)} has priority.`
                      : "Select a card or board piece."}
                </p>
              ) : null}
            </div>
          </section>

          <section className="panel history-panel">
            <div className="panel-heading">
              <span>EVENT STREAM</span>
              <small>latest first</small>
            </div>
            <ol className="history-list">
              {history.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <section
        className="player-dock"
        data-viewer={viewerId}
        aria-label={`${playerName(viewerId)} hand and resources`}
      >
        <div className="player-core">
          <div className="leader-chip">
            <small>{playerName(viewerId).toUpperCase()} CORE</small>
            <strong>{state.players[viewerId].integrity}</strong>
          </div>
          <div className="stat-cluster">
            <StatPill
              label="FOCUS"
              value={`${state.players[viewerId].focus}/${state.players[viewerId].maxFocus}`}
            />
            <StatPill
              label="DOM"
              value={`${state.players[viewerId].dominion}/6`}
            />
          </div>
        </div>

        {!privacyLocked &&
        state.phase === "mulligan" &&
        !state.players[viewerId].mulliganSubmitted ? (
          <div className="mulligan-callout">
            <div>
              <strong>OPENING SCAN</strong>
              <span>Select cards to replace, then lock the hand.</span>
            </div>
            <button
              className="button button--primary"
              onClick={() =>
                apply({
                  type: "mulligan",
                  playerId: viewerId,
                  instanceIds: [...mulliganIds],
                })
              }
              type="button"
            >
              Lock hand ({mulliganIds.size} out)
            </button>
          </div>
        ) : null}

        <div
          className={`hand ${privacyLocked ? "is-private" : ""}`}
          role="list"
          aria-label={`${playerName(viewerId)} hand`}
        >
          {!privacyLocked &&
            state.players[viewerId].hand.map((card) => {
              const definition = browserEngine.cards.get(card.cardId)!;
              const selectedForMulligan = mulliganIds.has(card.instanceId);
              return (
                <button
                  className={`hand-card ${selectedId === card.instanceId ? "is-selected" : ""} ${selectedForMulligan ? "is-mulligan" : ""}`}
                  key={card.instanceId}
                  onClick={() => {
                    if (state.phase === "mulligan") {
                      setMulliganIds((current) => {
                        const next = new Set(current);
                        if (next.has(card.instanceId))
                          next.delete(card.instanceId);
                        else next.add(card.instanceId);
                        return next;
                      });
                    } else setSelectedId(card.instanceId);
                  }}
                  type="button"
                >
                  <span
                    className={`card-aspect card-aspect--${definition.aspects[0] ?? "neutral"}`}
                  />
                  <span className="card-cost">{definition.focusCost}</span>
                  <small>{definition.type.toUpperCase()}</small>
                  <strong>{definition.name}</strong>
                  <span className="card-time">{definition.playTime}T</span>
                </button>
              );
            })}
        </div>
      </section>

      {handoffTo ? (
        <div
          className="handoff-screen"
          role="dialog"
          aria-labelledby="handoff-title"
          aria-describedby="handoff-description"
          aria-modal="true"
        >
          <div className="handoff-card">
            <p className="eyebrow">PRIVATE HANDOFF</p>
            <h2 id="handoff-title">
              Pass the device to {playerName(handoffTo)}
            </h2>
            <p id="handoff-description">
              The previous hand and legal controls are hidden. Reveal only when
              the next player is ready.
            </p>
            <button
              autoFocus
              className="button button--primary handoff-button"
              onClick={revealHandoff}
              type="button"
            >
              Reveal {playerName(handoffTo)} seat
            </button>
          </div>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {history[0]}
      </p>
    </main>
  );
}
