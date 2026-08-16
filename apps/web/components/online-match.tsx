"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Client, type Room } from "@colyseus/sdk";
import type { PlayerId } from "@cardforge/card-schema";
import type {
  Command,
  GameEvent,
  ProjectedGameView,
} from "@cardforge/rules-kernel";
import { BoardCanvas } from "./board-canvas";
import { useGameTheme } from "./theme-provider";
import { browserEngine, browserStarterDecks, eventLabel } from "@/lib/match-ui";

type ClientIntent = Command extends infer Candidate
  ? Candidate extends { readonly playerId: PlayerId }
    ? Omit<Candidate, "playerId">
    : never
  : never;

interface OnlineSnapshot {
  readonly seat: PlayerId;
  readonly commandNumber: number;
  readonly hash: string;
  readonly view: ProjectedGameView;
  readonly events: readonly GameEvent[];
  readonly legalIntents: readonly ClientIntent[];
  readonly clock: {
    readonly serverNowMs: number;
    readonly actionDurationMs: number;
    readonly deadlines: Readonly<Record<PlayerId, number | null>>;
  };
  readonly receivedAtMs: number;
}

interface SavedDeck {
  readonly deckId: string;
  readonly name: string;
  readonly leaderId: string;
}

type ConnectionState =
  "offline" | "matching" | "connected" | "reconnecting" | "closed";

function clockLabel(
  snapshot: OnlineSnapshot,
  playerId: PlayerId,
  clientNowMs: number,
): string {
  const deadline = snapshot.clock.deadlines[playerId];
  if (deadline === null) return "--";
  const remaining = Math.max(
    0,
    deadline -
      snapshot.clock.serverNowMs -
      (clientNowMs - snapshot.receivedAtMs),
  );
  return `${Math.ceil(remaining / 1_000)}s`;
}

function intentLabel(
  intent: ClientIntent,
  term: (semanticId: string) => string,
): string {
  switch (intent.type) {
    case "mulligan":
      return `Lock opening hand (${intent.instanceIds.length} out)`;
    case "resolve_choice":
      return `Choose ${intent.optionIds.join(" + ")}`;
    case "pass_response":
      return "Pass response";
    case "play_reaction":
      return "Play Reaction";
    case "play_card":
      return `Play card${intent.front ? ` → ${intent.front}` : ""}`;
    case "prepare_card":
      return "Prepare card";
    case "activate_ability":
      return "Activate ability";
    case "strike":
      return `Strike ${intent.targetId === "leader" ? term("leader") : term("entity")}`;
    case "shift":
      return `Shift → ${intent.toFront} ${intent.toSlot}`;
    case "pass":
      return "Pass for the Cycle";
  }
}

export function OnlineMatch() {
  const { theme, term } = useGameTheme();
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [snapshot, setSnapshot] = useState<OnlineSnapshot | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clientNowMs, setClientNowMs] = useState(() => Date.now());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [decks, setDecks] = useState<readonly SavedDeck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>("");
  const [storageReady, setStorageReady] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const endpoint =
    process.env.NEXT_PUBLIC_MATCH_SERVER_URL ?? "http://localhost:2567";

  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setInterval(() => setClientNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [snapshot]);

  useEffect(() => {
    let active = true;
    const provision = async () => {
      const storedAccount = window.localStorage.getItem(
        "cardforge.alpha.account",
      );
      const localAccount =
        storedAccount ?? `guest-${window.crypto.randomUUID()}`;
      window.localStorage.setItem("cardforge.alpha.account", localAccount);
      const headers = {
        "content-type": "application/json",
        "x-cardforge-account-id": localAccount,
      };
      await fetch(`${endpoint}/api/accounts/${localAccount}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ displayName: "Alpha Player" }),
      });
      let response = await fetch(
        `${endpoint}/api/accounts/${localAccount}/decks`,
        { headers },
      );
      let payload = (await response.json()) as { decks: SavedDeck[] };
      if (!payload.decks.length) {
        await fetch(
          `${endpoint}/api/accounts/${localAccount}/decks/starter-vanguard`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify({
              gameId: "cardforge-proof",
              formatId: "proof-constructed",
              leaderId: "leader.vanguard",
              name: "Vanguard Starter",
              revision: 1,
              cardIds: browserStarterDecks["leader.vanguard"],
            }),
          },
        );
        response = await fetch(
          `${endpoint}/api/accounts/${localAccount}/decks`,
          { headers },
        );
        payload = (await response.json()) as { decks: SavedDeck[] };
      }
      if (!active) return;
      setAccountId(localAccount);
      setDecks(payload.decks);
      setSelectedDeckId(payload.decks[0]?.deckId ?? "");
      setStorageReady(true);
    };
    void provision().catch((caught) => {
      if (!active) return;
      setError(
        caught instanceof Error ? caught.message : "Deck storage failed.",
      );
      setStorageReady(true);
    });
    return () => {
      active = false;
    };
  }, [endpoint]);

  const connect = async () => {
    if (!accountId || !selectedDeckId) return;
    setConnection("matching");
    setError(null);
    try {
      const client = new Client(endpoint);
      const requestedRoom = new URLSearchParams(window.location.search).get(
        "room",
      );
      const room = requestedRoom
        ? await client.joinById(requestedRoom, {
            accountId,
            deckId: selectedDeckId,
          })
        : await client.joinOrCreate("tempofront", {
            accountId,
            deckId: selectedDeckId,
          });
      roomRef.current = room;
      setRoomId(room.roomId);
      room.onMessage("snapshot", (message) => {
        setSnapshot({
          ...(message as Omit<OnlineSnapshot, "receivedAtMs">),
          receivedAtMs: Date.now(),
        });
        setClientNowMs(Date.now());
        setConnection("connected");
      });
      room.onMessage(
        "command_error",
        (message: { readonly message?: string }) =>
          setError(message.message ?? "The server rejected that command."),
      );
      room.onDrop(() => setConnection("reconnecting"));
      room.onReconnect(() => setConnection("connected"));
      room.onLeave(() => setConnection("closed"));
      room.send("ready");
    } catch (caught) {
      setConnection("offline");
      setError(
        caught instanceof Error ? caught.message : "Matchmaking failed.",
      );
    }
  };

  const disconnect = async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.leave();
    setSnapshot(null);
    setRoomId(null);
    setConnection("offline");
  };

  const send = (intent: ClientIntent) => {
    setError(null);
    roomRef.current?.send("command", intent);
  };

  const selectedDefinition = useMemo(() => {
    if (!selectedId || !snapshot) return undefined;
    const own = snapshot.view.players[snapshot.seat];
    const instance = [
      ...(own.hand ?? []),
      own.leader,
      ...own.discard,
      ...own.relics,
    ].find((card) => card.instanceId === selectedId);
    return instance ? browserEngine.cards.get(instance.cardId) : undefined;
  }, [selectedId, snapshot]);

  if (!snapshot)
    return (
      <main className="online-shell online-shell--lobby">
        <section className="online-lobby">
          <p className="eyebrow">CARDFORGE // ONLINE ALPHA</p>
          <h1>
            Authoritative{" "}
            {theme.themeId === "aetherfront"
              ? "Aetherfront"
              : "Orbital Conflict"}
          </h1>
          <p>
            Matchmaking assigns a seat. The server owns the seed, full state,
            legal actions, hidden information, and replay log.
          </p>
          <div className="online-lobby__actions">
            <label className="online-deck-select">
              <span>Saved deck</span>
              <select
                disabled={!storageReady || connection === "matching"}
                onChange={(event) => setSelectedDeckId(event.target.value)}
                value={selectedDeckId}
              >
                {decks.map((deck) => (
                  <option key={deck.deckId} value={deck.deckId}>
                    {deck.name} // {deck.leaderId.replace("leader.", "")}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button--primary online-connect"
              disabled={
                connection === "matching" ||
                !storageReady ||
                !accountId ||
                !selectedDeckId
              }
              onClick={() => void connect()}
              type="button"
            >
              {connection === "matching" ? "Finding room…" : "Join matchmaking"}
            </button>
            <a className="button button--quiet" href="/">
              Local lab
            </a>
            <a className="button button--quiet" href="/studio">
              Card Studio
            </a>
          </div>
          {error ? <p className="online-error">{error}</p> : null}
        </section>
      </main>
    );

  const seat = snapshot.seat;
  const opponent = seat === "p1" ? "p2" : "p1";
  const player = snapshot.view.players[seat];
  const rival = snapshot.view.players[opponent];
  return (
    <main
      className="online-shell"
      data-command={snapshot.commandNumber}
      data-connection={connection}
      data-room={roomId}
      data-seat={seat}
      data-seat-clock={clockLabel(snapshot, seat, clientNowMs)}
    >
      <header className="online-header">
        <div>
          <p className="eyebrow">ONLINE ALPHA // ROOM {roomId}</p>
          <h1>
            {theme.themeId === "aetherfront"
              ? "Aetherfront"
              : "Orbital Conflict"}
          </h1>
        </div>
        <div className="online-connection">
          <span
            className={`status-light ${connection === "reconnecting" ? "is-thinking" : ""}`}
          />
          {connection.toUpperCase()} // {seat.toUpperCase()} // CMD{" "}
          {snapshot.commandNumber}
          <button
            className="button button--quiet"
            onClick={() => void disconnect()}
            type="button"
          >
            Leave
          </button>
        </div>
      </header>

      <section className="online-scorebar">
        <span>
          RIVAL {rival.integrity} {term("integrity").toUpperCase()} //{" "}
          {rival.handCount} HAND // {rival.dominion}/6{" "}
          {term("dominion").toUpperCase()} // CLOCK{" "}
          {clockLabel(snapshot, opponent, clientNowMs)}
        </span>
        <code>{snapshot.hash.slice(0, 12)}</code>
        <span>
          YOU {player.integrity} {term("integrity").toUpperCase()} //{" "}
          {player.focus}/{player.maxFocus} {term("focus").toUpperCase()} //{" "}
          {player.dominion}/6 {term("dominion").toUpperCase()} // CLOCK{" "}
          {clockLabel(snapshot, seat, clientNowMs)}
        </span>
      </section>

      <div className="online-grid">
        <section className="arena-panel">
          <BoardCanvas
            state={snapshot.view}
            viewerId={seat}
            selectedId={selectedId}
            legalSlots={new Set()}
            legalTargets={new Set()}
            legalFronts={new Set()}
            presentation={null}
            reducedMotion={false}
            themePalette={theme.palette}
            onIntent={(intent) =>
              intent.entityId && setSelectedId(intent.entityId)
            }
          />
        </section>
        <aside className="online-rail">
          <section className="panel">
            <div className="panel-heading">
              <span>SERVER-LEGAL INTENTS</span>
              <small>{snapshot.legalIntents.length}</small>
            </div>
            <div className="action-list online-actions">
              {snapshot.legalIntents.map((intent, index) => (
                <button
                  className="action-button"
                  key={`${JSON.stringify(intent)}-${index}`}
                  onClick={() => send(intent)}
                  type="button"
                >
                  <span>{intentLabel(intent, term)}</span>
                </button>
              ))}
              {snapshot.legalIntents.length === 0 ? (
                <p className="empty-copy">Waiting for the other seat.</p>
              ) : null}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <span>INSPECTOR</span>
              <small>{selectedDefinition?.type ?? "none"}</small>
            </div>
            <div className="inspector-card">
              <h2>
                {selectedDefinition?.name ?? `Select an ${term("entity")}`}
              </h2>
              <p className="rules-text">
                {selectedDefinition
                  ? `${selectedDefinition.focusCost} ${term("focus")} // ${selectedDefinition.playTime} Time`
                  : "Only your projected state is available in this client."}
              </p>
            </div>
          </section>
          <section className="panel history-panel">
            <div className="panel-heading">
              <span>PROJECTED EVENTS</span>
              <small>latest batch</small>
            </div>
            <ol className="history-list">
              {[...snapshot.events].reverse().map((event, index) => (
                <li key={`${event.type}-${index}`}>
                  {eventLabel(event, {
                    entity: term("entity"),
                    leader: term("leader"),
                    front: term("front"),
                    dominion: term("dominion"),
                  })}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <section className="online-hand" aria-label="Your projected private hand">
        {(player.hand ?? []).map((card) => {
          const definition = browserEngine.cards.get(card.cardId);
          return (
            <button
              className={`hand-card ${selectedId === card.instanceId ? "is-selected" : ""}`}
              key={card.instanceId}
              onClick={() => setSelectedId(card.instanceId)}
              type="button"
            >
              <small>{definition?.type.toUpperCase()}</small>
              <strong>{definition?.name ?? card.cardId}</strong>
            </button>
          );
        })}
      </section>
      {error ? <p className="online-error">{error}</p> : null}
    </main>
  );
}
