"use client";

import { Client, type Room } from "@colyseus/sdk";
import type { PlayerId } from "@cardforge/card-schema";
import type { GameEvent, ProjectedGameView } from "@cardforge/rules-kernel";
import type { ApiFetch } from "./api";
import type { Intent } from "./match-view";

export type MatchMode =
  "casual" | "ranked" | "friend" | "practice" | "training";

export interface MatchRequest {
  readonly mode: MatchMode;
  readonly deckId?: string;
  readonly inviteCode?: string;
  readonly scenarioId?: string;
  readonly opponentLeaderId?: string;
}

export interface MatchReward {
  readonly shards: number;
  readonly xp: number;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly newlyUnlockedLeaderIds: readonly string[];
}

export interface MatchSnapshot {
  readonly seat: PlayerId;
  readonly matchId: string;
  readonly commandNumber: number;
  readonly hash: string;
  readonly view: ProjectedGameView;
  readonly events: readonly GameEvent[];
  readonly legalIntents: readonly Intent[];
  readonly clock: {
    readonly serverNowMs: number;
    readonly actionDurationMs: number;
    readonly deadlines: Readonly<Record<PlayerId, number | null>>;
  };
  readonly players: Partial<
    Record<
      PlayerId,
      { readonly displayName: string; readonly leaderId: string }
    >
  >;
  readonly competitive: {
    readonly queue: "casual" | "ranked" | "friend" | "practice" | "pve";
    readonly season?: { readonly name: string };
    readonly settlement?: {
      readonly ratingDelta: Readonly<Record<PlayerId, number>>;
      readonly xpGained: Readonly<Record<PlayerId, number>>;
      readonly profiles: Readonly<
        Record<
          PlayerId,
          { readonly rating: number; readonly accountLevel: number }
        >
      >;
    } | null;
  };
  readonly outcome: {
    readonly winnerId: PlayerId;
    readonly reason: "integrity" | "dominion" | "concession" | "abandonment";
    readonly reward: MatchReward | null;
  } | null;
  readonly scenario?: {
    readonly scenarioId: string;
    readonly title: string;
    readonly summary: string;
    readonly steps: readonly {
      readonly title: string;
      readonly instruction: string;
    }[];
  };
  readonly completion?: { readonly firstCompletion: boolean } | null;
  readonly finished?: boolean;
  /** Client receive time, to project the server clock locally. */
  readonly receivedAtMs: number;
}

const roomNames: Readonly<Record<MatchMode, string>> = {
  casual: "tempofront",
  ranked: "tempofront-ranked",
  friend: "tempofront-friend",
  practice: "tempofront-training",
  training: "tempofront-training",
};

const rejoinKey = "cardforge.match.rejoin";

export interface RejoinRecord {
  readonly token: string;
  readonly roomId: string;
  readonly mode: MatchMode;
  readonly savedAt: number;
}

/** Rejoin records survive a page reload within the server's grace window. */
export function readRejoin(): RejoinRecord | null {
  try {
    const record = JSON.parse(
      window.sessionStorage.getItem(rejoinKey) ?? "null",
    ) as RejoinRecord | null;
    return record && Date.now() - record.savedAt < 60_000 ? record : null;
  } catch {
    return null;
  }
}

export function saveRejoin(room: Room, mode: MatchMode): void {
  try {
    window.sessionStorage.setItem(
      rejoinKey,
      JSON.stringify({
        token: room.reconnectionToken,
        roomId: room.roomId,
        mode,
        savedAt: Date.now(),
      }),
    );
  } catch {
    // Storage may be unavailable (private mode); rejoin is a convenience.
  }
}

export function clearRejoin(): void {
  try {
    window.sessionStorage.removeItem(rejoinKey);
  } catch {
    // ignore
  }
}

/** Opens (or rejoins) a room with a fresh server-issued match ticket. */
export async function connectToMatch(
  api: ApiFetch,
  apiUrl: string,
  request: MatchRequest | { readonly rejoin: RejoinRecord },
): Promise<{ readonly room: Room; readonly mode: MatchMode }> {
  const client = new Client(apiUrl);
  if ("rejoin" in request) {
    const room = await client.reconnect(request.rejoin.token);
    return { room, mode: request.rejoin.mode };
  }
  const { ticket } = await api<{ ticket: string }>("/api/me/match-ticket", {
    body: {},
  });
  client.auth.token = ticket;
  const name = roomNames[request.mode];
  const options: Record<string, string> =
    request.mode === "training"
      ? { scenarioId: request.scenarioId ?? "" }
      : request.mode === "practice"
        ? {
            mode: "practice",
            ...(request.deckId ? { deckId: request.deckId } : {}),
            ...(request.opponentLeaderId
              ? { opponentLeaderId: request.opponentLeaderId }
              : {}),
          }
        : {
            deckId: request.deckId ?? "",
            ...(request.inviteCode ? { inviteCode: request.inviteCode } : {}),
          };
  const room =
    request.mode === "practice" || request.mode === "training"
      ? await client.create(name, options)
      : await client.joinOrCreate(name, options);
  return { room, mode: request.mode };
}

export function remainingMs(
  snapshot: MatchSnapshot,
  seat: PlayerId,
  nowMs: number,
): number | null {
  const deadline = snapshot.clock.deadlines[seat];
  if (deadline === null) return null;
  return Math.max(
    0,
    deadline - snapshot.clock.serverNowMs - (nowMs - snapshot.receivedAtMs),
  );
}
