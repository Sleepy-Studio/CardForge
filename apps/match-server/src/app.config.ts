import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { NextFunction, Request, Response } from "express";
import { TempoFrontRoom } from "./room.js";

export const server = new Server({
  greet: false,
  transport: new WebSocketTransport(),
  express: (app) => {
    const allowedOrigins = new Set(
      (
        process.env.CARDFORGE_ALLOWED_ORIGINS ??
        "http://localhost:3000,http://127.0.0.1:3000,http://192.168.8.182:3000"
      )
        .split(",")
        .map((origin) => origin.trim()),
    );
    app.use((request: Request, response: Response, next: NextFunction) => {
      const origin = request.header("origin");
      if (origin && allowedOrigins.has(origin)) {
        response.header("access-control-allow-origin", origin);
        response.header("vary", "origin");
        response.header(
          "access-control-allow-headers",
          "content-type,authorization",
        );
        response.header("access-control-allow-methods", "GET,POST,OPTIONS");
      }
      if (request.method === "OPTIONS") {
        response.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403);
        return;
      }
      next();
    });
    app.get("/health", (_request: Request, response: Response) => {
      response.json({ service: "cardforge-match-server", status: "ok" });
    });
  },
});

server.define("tempofront", TempoFrontRoom);
