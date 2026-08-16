"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FrontId, PlayerId } from "@cardforge/card-schema";
import type { Command, GameState } from "@cardforge/rules-kernel";
import { generateRulesText } from "@cardforge/rules-tempofront";
import { BoardCanvas, type BoardIntent } from "./board-canvas";
import { FieldGuide, type FieldGuideResult } from "./field-guide";
import {
  activePlayer,
  browserCardPoolSize,
  browserEngine,
  browserLeaderOptions,
  type BrowserLineup,
  chooseBotCommand,
  commandLabel,
  commandTime,
  createBrowserMatch,
  defaultBrowserLineup,
  definitionForInstance,
  eventLabel,
  findInstance,
  presentationCues,
  type PresentationBatch,
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
  const [lineup, setLineup] = useState<BrowserLineup>(defaultBrowserLineup);
  const [state, setState] = useState(() =>
    createBrowserMatch(20260816, defaultBrowserLineup),
  );
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
  const [presentation, setPresentation] = useState<PresentationBatch | null>(
    null,
  );
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [guideResult, setGuideResult] = useState<FieldGuideResult | null>(null);

  const active = activePlayer(state);
  const rivalId = opponentOf(viewerId);
  const privacyLocked = mode === "hotseat" && handoffTo !== null;
  const leaderDefinitions = {
    p1: browserEngine.cards.get(lineup.p1)!,
    p2: browserEngine.cards.get(lineup.p2)!,
  } as const;
  const legal = useMemo(
    () =>
      !privacyLocked && active === viewerId
        ? browserEngine.getLegalCommands(state, viewerId)
        : [],
    [active, privacyLocked, state, viewerId],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const publishEvents = useCallback(
    (
      before: GameState,
      after: GameState,
      events: Parameters<typeof presentationCues>[0],
    ) => {
      setHistory((items) =>
        [...events.map(eventLabel).reverse(), ...items].slice(0, 18),
      );
      const cues = presentationCues(events, before, after);
      if (cues.length > 0)
        setPresentation({ sequence: after.commandNumber, cues });
    },
    [],
  );

  const apply = useCallback(
    (command: Command) => {
      const result = browserEngine.applyCommand(state, command);
      publishEvents(state, result.state, result.events);
      setState(result.state);
      setSelectedId(null);
      if (mode === "hotseat") {
        const nextPlayer = activePlayer(result.state);
        if (nextPlayer && nextPlayer !== viewerId) setHandoffTo(nextPlayer);
      }
    },
    [mode, publishEvents, state, viewerId],
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
      publishEvents(state, result.state, result.events);
      setState(result.state);
      setBotThinking(false);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [active, mode, publishEvents, state]);

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
  const selectedCommand = selectedDefinition?.abilities?.find(
    (ability) => ability.type === "leader_command",
  );
  const visibleActions = useMemo(() => {
    const commands = selectedCommands.filter(
      (command) => command.type !== "mulligan",
    );
    const visible = commands.slice(0, 23);
    const pass = commands.find((command) => command.type === "pass");
    if (pass && !visible.includes(pass)) visible.push(pass);
    return visible;
  }, [selectedCommands]);

  const resetMatch = (nextMode = mode, nextLineup = lineup) => {
    const nextOrdinal = matchOrdinal + 1;
    setMatchOrdinal(nextOrdinal);
    setLineup(nextLineup);
    setState(createBrowserMatch(20260816 + nextOrdinal, nextLineup));
    setMode(nextMode);
    setViewerId("p1");
    setHandoffTo(null);
    setBotThinking(false);
    setPresentation(null);
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

  const changeLeader = (
    playerId: PlayerId,
    leaderId: BrowserLineup[PlayerId],
  ) => {
    if (lineup[playerId] === leaderId) return;
    resetMatch(mode, { ...lineup, [playerId]: leaderId });
  };
  const primaryCue = presentation?.cues.at(-1);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">CF</span>
          <div>
            <p>CARD FORGE // LAB BUILD 06 // {browserCardPoolSize} CARD POOL</p>
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
            className="button button--quiet guide-button"
            onClick={() => setGuideOpen(true)}
            type="button"
          >
            {guideResult
              ? `GUIDE ${guideResult.score}/${guideResult.total}`
              : "FIELD GUIDE"}
          </button>
          <button
            className={`button button--quiet fx-toggle ${effectsEnabled ? "is-active" : ""}`}
            data-fx={effectsEnabled ? "on" : "off"}
            onClick={() => setEffectsEnabled((enabled) => !enabled)}
            type="button"
          >
            {effectsEnabled
              ? prefersReducedMotion
                ? "FX REDUCED"
                : "FX ON"
              : "FX OFF"}
          </button>
          <button
            className="button button--quiet"
            onClick={() => resetMatch()}
            type="button"
          >
            New seed
          </button>
        </div>
      </header>

      <section className="leader-selectors" aria-label="Prototype Leaders">
        {(["p1", "p2"] as const).map((setupPlayerId) => {
          const selectedOption = browserLeaderOptions.find(
            (option) => option.cardId === lineup[setupPlayerId],
          )!;
          const definition = leaderDefinitions[setupPlayerId];
          const command = definition.abilities?.find(
            (ability) => ability.type === "leader_command",
          );
          return (
            <label className="leader-selector" key={setupPlayerId}>
              <span className="leader-selector__label">
                {playerName(setupPlayerId).toUpperCase()} //{" "}
                {selectedOption.archetype.toUpperCase()}
              </span>
              <select
                data-player={setupPlayerId}
                onChange={(event) =>
                  changeLeader(
                    setupPlayerId,
                    event.target.value as BrowserLineup[PlayerId],
                  )
                }
                value={lineup[setupPlayerId]}
              >
                {browserLeaderOptions.map((option) => (
                  <option key={option.cardId} value={option.cardId}>
                    {browserEngine.cards.get(option.cardId)?.name}
                  </option>
                ))}
              </select>
              <span className="leader-selector__detail">
                <strong>{definition.aspects.join(" / ").toUpperCase()}</strong>
                <small>{selectedOption.summary}</small>
              </span>
              <span className="leader-selector__command">
                {command?.focusCost ?? 0}F • {command?.timeCost ?? 0}T //{" "}
                {generateRulesText(definition)}
              </span>
            </label>
          );
        })}
      </section>

      <section className="opponent-bar" aria-label="Opponent status">
        <button
          className="leader-chip leader-chip--rival"
          onClick={() =>
            setSelectedId(state.players[rivalId].leader.instanceId)
          }
          type="button"
        >
          <small>{leaderDefinitions[rivalId].name}</small>
          <strong>{state.players[rivalId].integrity}</strong>
        </button>
        <div className="opponent-summary">
          <span>{playerName(rivalId)}</span>
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
            presentation={effectsEnabled ? presentation : null}
            reducedMotion={prefersReducedMotion}
            onIntent={onBoardIntent}
          />
          {primaryCue ? (
            <div
              className="event-callout"
              data-event-kind={primaryCue.kind}
              data-tone={primaryCue.tone}
              key={primaryCue.id}
              role="status"
            >
              <span>{primaryCue.label}</span>
              <strong>{primaryCue.detail}</strong>
              {effectsEnabled ? (
                <button
                  aria-label="Skip current board effect"
                  onClick={() => setPresentation(null)}
                  type="button"
                >
                  SKIP FX
                </button>
              ) : null}
            </div>
          ) : null}
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
                    value={
                      selectedCommand?.focusCost ?? selectedDefinition.focusCost
                    }
                  />
                  <StatPill
                    label="TIME"
                    value={
                      selectedCommand?.timeCost ?? selectedDefinition.playTime
                    }
                  />
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
        data-leader={lineup[viewerId]}
        data-viewer={viewerId}
        aria-label={`${playerName(viewerId)} hand and resources`}
      >
        <div className="player-core">
          <button
            className="leader-chip"
            onClick={() =>
              setSelectedId(state.players[viewerId].leader.instanceId)
            }
            type="button"
          >
            <small>{leaderDefinitions[viewerId].name}</small>
            <strong>{state.players[viewerId].integrity}</strong>
          </button>
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

      {guideOpen ? (
        <FieldGuide
          onClose={() => setGuideOpen(false)}
          onComplete={setGuideResult}
        />
      ) : null}

      <p className="sr-only" aria-live="polite">
        {history[0]}
      </p>
    </main>
  );
}
