import { setTimeout as delay } from "node:timers/promises";

export interface RetryOptions {
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly onRetry?: (error: unknown, attempt: number) => void;
}

/**
 * Runs `task` until it succeeds or `attempts` is spent, doubling the delay
 * between attempts. `task` receives the 1-based attempt number and must be
 * idempotent. The last error is rethrown.
 */
export async function retryWithBackoff<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt >= options.attempts) throw error;
      options.onRetry?.(error, attempt);
      await delay(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
