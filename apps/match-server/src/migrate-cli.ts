/**
 * One-shot migration command for deploy pipelines:
 *   node apps/match-server/dist/migrate-cli.js
 * The server also migrates on start; both paths share one advisory lock.
 */
import { PostgresCardForgeStore } from "@cardforge/persistence";
import { logger } from "./logger.js";
import { runMigrations } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  logger.critical("DATABASE_URL is required to run migrations");
  process.exit(1);
}
const store = new PostgresCardForgeStore(databaseUrl);
try {
  await runMigrations(store);
} catch {
  process.exitCode = 1;
} finally {
  await store.close();
}
