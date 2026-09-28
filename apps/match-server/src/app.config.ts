import { matchMaker, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { json } from "express";
import { sessionMiddleware } from "./auth.js";
import { config } from "./config.js";
import { registerAdminRoutes } from "./http/admin-routes.js";
import { registerAuthRoutes } from "./http/auth-routes.js";
import {
  corsAndCsrf,
  errorHandler,
  requestContext,
  requireJsonBodies,
  securityHeaders,
} from "./http/middleware.js";
import { registerPlayerRoutes } from "./http/player-routes.js";
import { registerPublicRoutes } from "./http/public-routes.js";
import {
  TempoFrontFriendRoom,
  TempoFrontRankedRoom,
  TempoFrontRoom,
} from "./room.js";
import { cardForgeStore } from "./store.js";
import { TempoFrontTrainingRoom } from "./training-room.js";

const readiness: { ready: boolean; reason?: string } = {
  ready: false,
  reason: "migrations pending",
};

export function markReady(): void {
  readiness.ready = true;
  delete readiness.reason;
}

// Colyseus answers matchmaking requests itself; mirror the API origin policy.
matchMaker.controller.getCorsHeaders = (headers) => {
  const origin = headers.get("origin");
  const allowed = origin !== null && config.allowedOrigins.has(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    Vary: "Origin",
  };
};

export const server = new Server({
  greet: false,
  transport: new WebSocketTransport({ maxPayload: 16 * 1024 }),
  express: (app) => {
    app.disable("x-powered-by");
    app.set("trust proxy", config.trustProxy);
    app.use(requestContext());
    app.use(securityHeaders());
    app.use(corsAndCsrf(config));
    app.use("/api", requireJsonBodies());
    app.use("/api", json({ limit: "64kb" }));
    app.use(sessionMiddleware(cardForgeStore, { ttlMs: config.sessionTtlMs }));
    const deps = { store: cardForgeStore, config };
    registerPublicRoutes(app, { ...deps, readiness: () => readiness });
    registerAuthRoutes(app, deps);
    registerPlayerRoutes(app, deps);
    registerAdminRoutes(app, deps);
    app.use("/api", (_request, response) => {
      response.status(404).json({ error: "NOT_FOUND" });
    });
    app.use(errorHandler());
  },
});

server.define("tempofront", TempoFrontRoom);
server.define("tempofront-ranked", TempoFrontRankedRoom);
// Friend rooms are keyed by invite code so both players land in one room.
server
  .define("tempofront-friend", TempoFrontFriendRoom)
  .filterBy(["inviteCode"]);
server.define("tempofront-training", TempoFrontTrainingRoom);
