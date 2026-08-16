import { matchMaker, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { json, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  defaultTheme,
  proofCardMap,
  proofFormat,
  validateDeck,
} from "@cardforge/rules-tempofront";
import { TempoFrontRoom } from "./room.js";
import { cardForgeStore } from "./store.js";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/);
const accountBody = z
  .object({ displayName: z.string().trim().min(1).max(60) })
  .strict();
const deckBody = z
  .object({
    gameId: identifier,
    formatId: identifier,
    leaderId: identifier.or(z.string().regex(/^[a-z.]+$/)),
    name: z.string().trim().min(1).max(80),
    revision: z.number().int().positive(),
    cardIds: z.array(z.string().min(1).max(120)).max(60),
  })
  .strict();

function ownsAccount(request: Request, response: Response): boolean {
  const accountId = String(request.params.accountId);
  if (request.header("x-cardforge-account-id") === accountId) return true;
  response.status(403).json({ error: "ACCOUNT_SCOPE_REQUIRED" });
  return false;
}

const allowedOrigins = new Set(
  (
    process.env.CARDFORGE_ALLOWED_ORIGINS ??
    "http://localhost:3000,http://127.0.0.1:3000,http://192.168.8.182:3000"
  )
    .split(",")
    .map((origin) => origin.trim()),
);

matchMaker.controller.getCorsHeaders = (headers) => {
  const origin = headers.get("origin");
  return {
    "Access-Control-Allow-Origin":
      origin && allowedOrigins.has(origin) ? origin : "null",
    "Access-Control-Allow-Headers":
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-CardForge-Account-Id",
  };
};

export const server = new Server({
  greet: false,
  transport: new WebSocketTransport(),
  express: (app) => {
    app.use("/api", (request, response, next) => {
      if (
        request.is("application/json") ||
        request.method === "GET" ||
        request.method === "OPTIONS"
      ) {
        next();
        return;
      }
      response.status(415).json({ error: "JSON_REQUIRED" });
    });
    app.use("/api", json({ limit: "64kb" }));
    app.use((request: Request, response: Response, next: NextFunction) => {
      const origin = request.header("origin");
      if (origin && allowedOrigins.has(origin)) {
        response.header("access-control-allow-origin", origin);
        response.header("vary", "origin");
        response.header(
          "access-control-allow-headers",
          "content-type,authorization,x-cardforge-account-id",
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
    app.put(
      "/api/accounts/:accountId",
      async (request: Request, response: Response) => {
        if (!ownsAccount(request, response)) return;
        const accountId = identifier.safeParse(request.params.accountId);
        const body = accountBody.safeParse(request.body);
        if (!accountId.success || !body.success) {
          response.status(400).json({ error: "INVALID_ACCOUNT" });
          return;
        }
        await cardForgeStore.upsertAccount(
          accountId.data,
          body.data.displayName,
        );
        response.sendStatus(204);
      },
    );
    app.get(
      "/api/accounts/:accountId/decks",
      async (request: Request, response: Response) => {
        if (!ownsAccount(request, response)) return;
        response.json({
          decks: await cardForgeStore.listDecks(
            String(request.params.accountId),
          ),
        });
      },
    );
    app.put(
      "/api/accounts/:accountId/decks/:deckId",
      async (request: Request, response: Response) => {
        if (!ownsAccount(request, response)) return;
        const accountId = identifier.safeParse(request.params.accountId);
        const deckId = identifier.safeParse(request.params.deckId);
        const body = deckBody.safeParse(request.body);
        if (!accountId.success || !deckId.success || !body.success) {
          response.status(400).json({ error: "INVALID_DECK" });
          return;
        }
        if (
          body.data.gameId !== defaultTheme.gameId ||
          body.data.formatId !== proofFormat.formatId
        ) {
          response.status(400).json({ error: "UNSUPPORTED_GAME_OR_FORMAT" });
          return;
        }
        const errors = validateDeck(
          body.data.cardIds,
          proofCardMap,
          proofFormat,
          {
            leaderCardId: body.data.leaderId,
          },
        );
        if (errors.length) {
          response.status(422).json({ error: "ILLEGAL_DECK", details: errors });
          return;
        }
        await cardForgeStore.saveDeck({
          deckId: deckId.data,
          accountId: accountId.data,
          ...body.data,
        });
        response.sendStatus(204);
      },
    );
  },
});

server.define("tempofront", TempoFrontRoom);
