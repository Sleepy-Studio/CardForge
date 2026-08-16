import type { PlayerId } from "@cardforge/card-schema";

export interface ActionClockSnapshot {
  readonly serverNowMs: number;
  readonly actionDurationMs: number;
  readonly deadlines: Readonly<Record<PlayerId, number | null>>;
}

export class ActionClock {
  readonly #deadlines: Record<PlayerId, number | null> = {
    p1: null,
    p2: null,
  };

  constructor(
    readonly actionDurationMs: number,
    readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(actionDurationMs) || actionDurationMs <= 0)
      throw new Error("Action clock duration must be a positive integer");
  }

  reconcile(activePlayers: readonly PlayerId[]): void {
    const active = new Set(activePlayers);
    const now = this.now();
    for (const playerId of ["p1", "p2"] as const) {
      if (!active.has(playerId)) this.#deadlines[playerId] = null;
      else if (this.#deadlines[playerId] === null)
        this.#deadlines[playerId] = now + this.actionDurationMs;
    }
  }

  expiredPlayers(): readonly PlayerId[] {
    const now = this.now();
    return (["p1", "p2"] as const).filter((playerId) => {
      const deadline = this.#deadlines[playerId];
      return deadline !== null && deadline <= now;
    });
  }

  nextDelayMs(): number | null {
    const deadlines = Object.values(this.#deadlines).filter(
      (deadline): deadline is number => deadline !== null,
    );
    if (!deadlines.length) return null;
    return Math.max(0, Math.min(...deadlines) - this.now());
  }

  snapshot(): ActionClockSnapshot {
    return {
      serverNowMs: this.now(),
      actionDurationMs: this.actionDurationMs,
      deadlines: { ...this.#deadlines },
    };
  }
}
