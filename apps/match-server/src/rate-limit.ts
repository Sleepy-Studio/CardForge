import type { NextFunction, Request, Response } from "express";

/**
 * Fixed-window in-process rate limiter. The closed alpha runs one match-server
 * replica, so process memory is the correct scope; a multi-replica deployment
 * would move these counters to shared storage.
 */
export class RateLimiter {
  readonly #windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Returns true when the call is allowed. */
  take(key: string, nowMs = Date.now()): boolean {
    const window = this.#windows.get(key);
    if (!window || window.resetAt <= nowMs) {
      this.#windows.set(key, { count: 1, resetAt: nowMs + this.windowMs });
      if (this.#windows.size > 50_000) this.#sweep(nowMs);
      return true;
    }
    window.count += 1;
    return window.count <= this.limit;
  }

  #sweep(nowMs: number): void {
    for (const [key, window] of this.#windows)
      if (window.resetAt <= nowMs) this.#windows.delete(key);
  }
}

export function rateLimit(
  limiter: RateLimiter,
  keyFor: (request: Request) => string = (request) => request.ip ?? "unknown",
) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (limiter.take(keyFor(request))) {
      next();
      return;
    }
    response.setHeader("retry-after", Math.ceil(limiter.windowMs / 1_000));
    response.status(429).json({ error: "RATE_LIMITED" });
  };
}
