import { matchMaker, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { json, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  proofCardMap,
  proofFormat,
  validateDeck,
} from "@cardforge/rules-tempofront";
import { defaultTheme } from "@cardforge/theme-default";
import {
  aggregateBalanceOverview,
  competitivePatches,
  createCompetitiveProfile,
  seasonOne,
} from "@cardforge/competitive";
import { TempoFrontRankedRoom, TempoFrontRoom } from "./room.js";
import { TempoFrontTrainingRoom } from "./training-room.js";
import { cardForgeStore } from "./store.js";
import { cosmeticCatalog } from "@cardforge/economy";
import { trainingScenarios } from "@cardforge/training";

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
const transactionId = z.string().regex(/^[a-zA-Z0-9:_-]{8,120}$/);
const craftBody = z
  .object({
    transactionId,
    cardId: z.string().min(3).max(120),
    quantity: z.number().int().min(1).max(3),
  })
  .strict();
const cosmeticUnlockBody = z
  .object({
    transactionId,
    cosmeticId: z.string().min(3).max(120),
  })
  .strict();

function sendEconomyError(response: Response, error: unknown): void {
  const message =
    error instanceof Error ? error.message : "Economy operation failed";
  if (message.startsWith("Unknown account")) {
    response.status(404).json({ error: "ACCOUNT_NOT_FOUND" });
    return;
  }
  if (message.includes("conflicts") || message.includes("already unlocked")) {
    response.status(409).json({ error: "ECONOMY_CONFLICT", message });
    return;
  }
  response.status(422).json({ error: "ECONOMY_REJECTED", message });
}

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
    app.get(
      "/api/accounts/:accountId/economy",
      async (request: Request, response: Response) => {
        if (!ownsAccount(request, response)) return;
        const accountId = identifier.safeParse(request.params.accountId);
        if (!accountId.success) {
          response.status(400).json({ error: "INVALID_ACCOUNT" });
          return;
        }
        try {
          response.json({
            snapshot: await cardForgeStore.getEconomySnapshot(accountId.data),
          });
        } catch (error) {
          sendEconomyError(response, error);
        }
      },
    );
    app.post(
      "/api/accounts/:accountId/economy/craft",
      async (request: Request, response: Response) => {
        if (!ownsAccount(request, response)) return;
        const accountId = identifier.safeParse(request.params.accountId);
        const body = craftBody.safeParse(request.body);
        if (!accountId.success || !body.success) {
          response.status(400).json({ error: "INVALID_CRAFT_REQUEST" });
          return;
        }
        const card = proofCardMap.get(body.data.cardId);
        if (!card) {
          response.status(404).json({ error: "CARD_NOT_FOUND" });
          return;
        }
        try {
          response.json({
            snapshot: await cardForgeStore.craftCard(
              body.data.transactionId,
              accountId.data,
              card,
              body.data.quantity,
            ),
          });
        } catch (error) {
          sendEconomyError(response, error);
        }
      },
    );
    app.get("/api/cosmetics", (_request: Request, response: Response) => {
      response.json({ cosmetics: cosmeticCatalog });
    });
    app.get("/api/training", (_request: Request, response: Response) => {
      response.json({ scenarios: trainingScenarios });
    });
    app.get(
      "/api/accounts/:accountId/training-completions",
      async (request: Request, response: Response) => {
        if (!ownsAccount(request, response)) return;
        const accountId = identifier.safeParse(request.params.accountId);
        if (!accountId.success) {
          response.status(400).json({ error: "INVALID_ACCOUNT" });
          return;
        }
        response.json({
          scenarioIds: await cardForgeStore.listTrainingCompletions(
            accountId.data,
          ),
        });
      },
    );
    app.post(
      "/api/accounts/:accountId/economy/cosmetics",
      async (request: Request, response: Response) => {
        if (!ownsAccount(request, response)) return;
        const accountId = identifier.safeParse(request.params.accountId);
        const body = cosmeticUnlockBody.safeParse(request.body);
        if (!accountId.success || !body.success) {
          response.status(400).json({ error: "INVALID_COSMETIC_REQUEST" });
          return;
        }
        const cosmetic = cosmeticCatalog.find(
          (item) => item.cosmeticId === body.data.cosmeticId,
        );
        if (!cosmetic) {
          response.status(404).json({ error: "COSMETIC_NOT_FOUND" });
          return;
        }
        try {
          response.json({
            snapshot: await cardForgeStore.unlockCosmetic(
              body.data.transactionId,
              accountId.data,
              cosmetic,
            ),
          });
        } catch (error) {
          sendEconomyError(response, error);
        }
      },
    );
    app.get(
      "/api/accounts/:accountId/economy/transactions",
      async (request: Request, response: Response) => {
        if (!ownsAccount(request, response)) return;
        const accountId = identifier.safeParse(request.params.accountId);
        if (!accountId.success) {
          response.status(400).json({ error: "INVALID_ACCOUNT" });
          return;
        }
        response.json({
          transactions: await cardForgeStore.listEconomyTransactions(
            accountId.data,
            100,
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
    app.get("/api/competitive/season", (_request, response) => {
      response.json({ season: seasonOne, patches: competitivePatches });
    });
    app.get(
      "/api/accounts/:accountId/competitive-profile",
      async (request: Request, response: Response) => {
        if (!ownsAccount(request, response)) return;
        const accountId = identifier.safeParse(request.params.accountId);
        if (!accountId.success) {
          response.status(400).json({ error: "INVALID_ACCOUNT" });
          return;
        }
        let profile = await cardForgeStore.getCompetitiveProfile(
          accountId.data,
          seasonOne.seasonId,
        );
        if (!profile) {
          profile = createCompetitiveProfile(
            accountId.data,
            seasonOne.seasonId,
          );
          try {
            await cardForgeStore.saveCompetitiveProfile(profile);
          } catch {
            response.status(404).json({ error: "ACCOUNT_NOT_FOUND" });
            return;
          }
        }
        response.json({ profile });
      },
    );
    app.get(
      "/api/competitive/overview",
      async (_request: Request, response: Response) => {
        const telemetry = await cardForgeStore.listTelemetry(
          seasonOne.seasonId,
          10_000,
        );
        response.json({
          season: seasonOne,
          overview: aggregateBalanceOverview(telemetry),
        });
      },
    );
  },
});

server.define("tempofront", TempoFrontRoom);
server.define("tempofront-ranked", TempoFrontRankedRoom);
server.define("tempofront-training", TempoFrontTrainingRoom);
