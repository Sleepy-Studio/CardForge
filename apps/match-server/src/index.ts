import { markReady, server } from "./app.config.js";
import { config } from "./config.js";
import { seedLiveOps } from "./game-service.js";
import { logger, observeErrors } from "./logger.js";
import { metrics } from "./metrics.js";
import { runMigrations } from "./migrate.js";
import { cardForgeStore } from "./store.js";

observeErrors((level) => metrics.logErrors.inc({ level }));
process.on("unhandledRejection", (error) =>
  logger.error("unhandled promise rejection", { error }),
);

// Listen first so liveness probes pass while migrations run; readiness
// stays 503 until the schema is current.
await server.listen(config.port);
logger.info("match server listening", {
  port: config.port,
  production: config.production,
  storage: config.databaseUrl ? "postgres" : "memory",
  allowedOrigins: [...config.allowedOrigins],
  discord: config.discord !== null,
  signupMode: config.signupMode,
});
if (!config.databaseUrl)
  logger.warn(
    "DATABASE_URL is not set; using the in-memory store (data is lost on restart)",
  );

try {
  await runMigrations(cardForgeStore);
  const seeded = await seedLiveOps(cardForgeStore);
  if (seeded.length)
    logger.info("seeded live-ops revisions", { revisions: seeded });
  markReady();
  logger.info("match server ready");
} catch (error) {
  logger.critical("startup failed", { error });
  process.exit(1);
}

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });
    void server
      .gracefullyShutdown(false)
      .then(() => cardForgeStore.close())
      .finally(() => process.exit(0));
  });

export { server } from "./app.config.js";
export * from "./action-clock.js";
export * from "./intents.js";
export * from "./room.js";
export * from "./session.js";
export * from "./store.js";
