import type { CardForgeStore } from "@cardforge/persistence";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";

/** Applies pending migrations with structured logs; failures are critical. */
export async function runMigrations(
  store: CardForgeStore,
): Promise<readonly string[]> {
  const startedAt = Date.now();
  try {
    const applied = await store.migrate((event) =>
      logger.info("migration applied", { ...event }),
    );
    logger.info("migrations complete", {
      applied: applied.length,
      durationMs: Date.now() - startedAt,
    });
    return applied;
  } catch (error) {
    metrics.integrityFailures.inc({ kind: "migration" });
    logger.critical("migration failed", { error });
    throw error;
  }
}
