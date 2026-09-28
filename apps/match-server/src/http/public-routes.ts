import type { Application, Request, Response } from "express";
import { competitivePatches, seasonOne } from "@cardforge/competitive";
import { cosmeticCatalog } from "@cardforge/economy";
import type { CardForgeStore } from "@cardforge/persistence";
import { trainingScenarios } from "@cardforge/training";
import { digest } from "../auth.js";
import type { ServerConfig } from "../config.js";
import { currentLiveOps, liveEventsView } from "../game-service.js";
import { renderMetrics } from "../metrics.js";

export const buildInfo = {
  version: process.env.CARDFORGE_VERSION ?? "dev",
  commit: process.env.CARDFORGE_COMMIT ?? "unknown",
  startedAt: new Date().toISOString(),
};

export function registerPublicRoutes(
  app: Application,
  deps: {
    readonly store: CardForgeStore;
    readonly config: ServerConfig;
    readonly readiness: () => { ready: boolean; reason?: string };
  },
): void {
  const { store, config } = deps;

  /** Liveness: the process is serving HTTP. No dependencies are checked. */
  app.get("/health", (_request, response) => {
    response.json({
      service: "cardforge-match-server",
      status: "ok",
      ...buildInfo,
    });
  });

  /** Readiness: migrations finished and the database answers. */
  app.get("/ready", async (_request, response) => {
    const state = deps.readiness();
    if (!state.ready) {
      response.status(503).json({ status: "starting", reason: state.reason });
      return;
    }
    try {
      await Promise.race([
        store.ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 2_000),
        ),
      ]);
      response.json({ status: "ready", database: "ok" });
    } catch {
      response
        .status(503)
        .json({ status: "degraded", database: "unreachable" });
    }
  });

  /**
   * Prometheus metrics. In production they require the operator token so
   * aggregate player counts are not public.
   */
  app.get("/metrics", (request: Request, response: Response) => {
    if (config.production) {
      const header = request.header("authorization") ?? "";
      const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!config.adminToken || digest(bearer) !== digest(config.adminToken)) {
        response.status(404).end();
        return;
      }
    }
    response.type("text/plain; version=0.0.4").send(renderMetrics());
  });

  app.get("/api/competitive/season", (_request, response) => {
    response.json({ season: seasonOne, patches: competitivePatches });
  });

  app.get("/api/cosmetics", (_request, response) => {
    response.json({ cosmetics: cosmeticCatalog });
  });

  app.get("/api/training", (_request, response) => {
    response.json({ scenarios: trainingScenarios });
  });

  app.get("/api/live-ops/current", async (_request, response) => {
    const definition = await currentLiveOps(store);
    response.json({
      configId: definition.configId,
      revision: definition.revision,
      quests: definition.quests,
      events: liveEventsView(definition),
      featureFlags: definition.featureFlags,
    });
  });
}
