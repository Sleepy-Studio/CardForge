import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { Request, Response } from "express";
import { TempoFrontRoom } from "./room.js";

export const server = new Server({
  greet: false,
  transport: new WebSocketTransport(),
  express: (app) => {
    app.get("/health", (_request: Request, response: Response) => {
      response.json({ service: "cardforge-match-server", status: "ok" });
    });
  },
});

server.define("tempofront", TempoFrontRoom);
