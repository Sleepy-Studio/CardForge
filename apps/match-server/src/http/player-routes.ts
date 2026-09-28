import { randomInt, randomUUID } from "node:crypto";
import type { Application, Response } from "express";
import { z } from "zod";
import { cosmeticCatalog, type EconomySnapshot } from "@cardforge/economy";
import {
  InviteError,
  type CardForgeStore,
  type MatchParticipantRecord,
} from "@cardforge/persistence";
import { proofCardMap } from "@cardforge/rules-tempofront";
import { requireAccount, type AuthenticatedRequest } from "../auth.js";
import type { ServerConfig } from "../config.js";
import {
  PlayabilityError,
  buildDeckRecord,
  competitiveView,
  currentLiveOps,
  currentProfile,
  deckLegalityErrors,
  deckStatus,
  grantStarterFor,
  liveEventsView,
  maxDecksPerAccount,
  questsFor,
  starterOptions,
} from "../game-service.js";
import { logger } from "../logger.js";
import { metrics } from "../metrics.js";
import { RateLimiter, rateLimit } from "../rate-limit.js";
import { ReplayCache, type ReplayPerspective } from "../replay-frames.js";
import { accountView, displayNameSchema } from "./auth-routes.js";
import { parseBody } from "./middleware.js";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/);
const transactionId = z.string().regex(/^[a-zA-Z0-9:_-]{8,120}$/);

const deckBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    leaderId: z.string().regex(/^leader\.[a-z_]{2,40}$/),
    cardIds: z.array(z.string().regex(/^[a-z]+\.[a-z0-9_]{2,60}$/)).max(60),
  })
  .strict();

const craftBody = z
  .object({
    transactionId,
    cardId: z.string().min(3).max(120),
    quantity: z.number().int().min(1).max(3),
  })
  .strict();

const cosmeticBody = z
  .object({ transactionId, cosmeticId: z.string().min(3).max(120) })
  .strict();

const supportCaseBody = z
  .object({ summary: z.string().trim().min(10).max(500) })
  .strict();

export const clientProductEvents = [
  "tutorial_started",
  "tutorial_step",
  "tutorial_completed",
  "tutorial_abandoned",
  "first_deck_selected",
  "onboarding_skipped",
  "practice_started",
  "deck_saved",
  "replay_opened",
] as const;

const productEventBody = z
  .object({
    name: z.enum(clientProductEvents),
    properties: z
      .record(
        z.string().regex(/^[a-zA-Z0-9_]{1,40}$/),
        z.union([z.string().max(80), z.number().finite(), z.boolean()]),
      )
      .refine((value) => Object.keys(value).length <= 10)
      .default({}),
  })
  .strict();

const inviteCodePattern = /^[A-HJ-NP-Z2-9]{6}$/;
const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const inviteTtlMs = 15 * 60_000;

export function generateInviteCode(): string {
  return Array.from(
    { length: 6 },
    () => inviteAlphabet[randomInt(inviteAlphabet.length)],
  ).join("");
}

function sendPlayability(response: Response, error: unknown): boolean {
  if (!(error instanceof PlayabilityError)) return false;
  response.status(error.code === "DECK_NOT_FOUND" ? 404 : 422).json({
    error: error.code,
    message: error.message,
  });
  return true;
}

function sendEconomyError(response: Response, error: unknown): void {
  const message =
    error instanceof Error ? error.message : "Economy operation failed";
  if (message.includes("conflicts") || message.includes("already unlocked")) {
    response.status(409).json({ error: "ECONOMY_CONFLICT", message });
    return;
  }
  if (message.startsWith("Insufficient")) {
    response.status(422).json({ error: "INSUFFICIENT_FUNDS", message });
    return;
  }
  response.status(422).json({ error: "ECONOMY_REJECTED", message });
}

export function registerPlayerRoutes(
  app: Application,
  deps: { readonly store: CardForgeStore; readonly config: ServerConfig },
): void {
  const { store, config } = deps;
  const replayCache = new ReplayCache();
  const writeLimiter = new RateLimiter(120, 60_000);
  const writes = rateLimit(
    writeLimiter,
    (request) =>
      (request as AuthenticatedRequest).account?.accountId ??
      request.ip ??
      "anon",
  );
  const inviteLimiter = rateLimit(
    new RateLimiter(20, 60 * 60_000),
    (request) =>
      (request as AuthenticatedRequest).account?.accountId ??
      request.ip ??
      "anon",
  );

  const decksWithStatus = async (
    accountId: string,
    economy?: EconomySnapshot,
  ) => {
    const [decks, snapshot, profile] = await Promise.all([
      store.listDecks(accountId),
      economy ? Promise.resolve(economy) : store.getEconomySnapshot(accountId),
      currentProfile(store, accountId),
    ]);
    return decks.map((deck) => ({
      deckId: deck.deckId,
      name: deck.name,
      leaderId: deck.leaderId,
      revision: deck.revision,
      cardIds: deck.cardIds,
      status: deckStatus(deck, snapshot.cards, profile),
    }));
  };

  app.get("/api/onboarding/starters", (_request, response) => {
    response.json({ starters: starterOptions() });
  });

  app.get("/api/me", (request: AuthenticatedRequest, response) => {
    const account = requireAccount(request, response);
    if (account) response.json({ account: accountView(account) });
  });

  app.patch(
    "/api/me",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const body = parseBody(
        z.object({ displayName: displayNameSchema }).strict(),
        request,
        response,
      );
      if (!body) return;
      const updated = await store.updateAccountProfile(account.accountId, body);
      response.json({ account: updated ? accountView(updated) : null });
    },
  );

  app.get("/api/me/home", async (request: AuthenticatedRequest, response) => {
    const account = requireAccount(request, response);
    if (!account) return;
    const [economy, profile, liveOps, history] = await Promise.all([
      store.getEconomySnapshot(account.accountId),
      currentProfile(store, account.accountId),
      currentLiveOps(store),
      store.listMatchHistory(account.accountId, { limit: 5 }),
    ]);
    const decks = await decksWithStatus(account.accountId, economy);
    response.json({
      account: accountView(account),
      competitive: competitiveView(profile),
      wallets: economy.wallets,
      decks: decks.map(({ cardIds: _cardIds, ...deck }) => {
        void _cardIds;
        return deck;
      }),
      quests: await questsFor(store, account.accountId, liveOps),
      events: liveEventsView(liveOps),
      recentMatches: history,
      featureFlags: liveOps.featureFlags,
    });
  });

  app.post(
    "/api/me/onboarding/starter",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const body = parseBody(
        z.object({ leaderId: z.string().max(60) }).strict(),
        request,
        response,
      );
      if (!body) return;
      try {
        const result = await grantStarterFor(store, account, body.leaderId);
        if (!result.granted) {
          response.status(409).json({ error: "STARTER_ALREADY_CHOSEN" });
          return;
        }
        void store.recordProductEvent({
          eventId: `evt:${randomUUID()}`,
          accountId: account.accountId,
          name: "starter_chosen",
          properties: { leaderId: body.leaderId },
        });
        const updated = await store.getAccount(account.accountId);
        response.status(201).json({
          account: updated ? accountView(updated) : null,
          deckId: result.deckId,
        });
      } catch (error) {
        if (!sendPlayability(response, error)) throw error;
      }
    },
  );

  app.post(
    "/api/me/onboarding/complete",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      if (!account.starterLeaderId) {
        response.status(409).json({ error: "STARTER_REQUIRED" });
        return;
      }
      const updated = await store.markOnboardingComplete(account.accountId);
      response.json({ account: updated ? accountView(updated) : null });
    },
  );

  app.post(
    "/api/me/events",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const body = parseBody(
        productEventBody,
        request,
        response,
        "INVALID_EVENT",
      );
      if (!body) return;
      await store.recordProductEvent({
        eventId: `evt:${randomUUID()}`,
        accountId: account.accountId,
        name: body.name,
        properties: body.properties,
      });
      response.sendStatus(204);
    },
  );

  app.get("/api/me/decks", async (request: AuthenticatedRequest, response) => {
    const account = requireAccount(request, response);
    if (!account) return;
    response.json({ decks: await decksWithStatus(account.accountId) });
  });

  app.put(
    "/api/me/decks/:deckId",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const deckId = identifier.safeParse(request.params.deckId);
      const body = parseBody(deckBody, request, response, "INVALID_DECK");
      if (!body) return;
      if (!deckId.success) {
        response.status(400).json({ error: "INVALID_DECK_ID" });
        return;
      }
      const errors = deckLegalityErrors(body.leaderId, body.cardIds);
      if (errors.length) {
        response.status(422).json({ error: "ILLEGAL_DECK", details: errors });
        return;
      }
      const existing = await store.getDeck(account.accountId, deckId.data);
      if (
        !existing &&
        (await store.listDecks(account.accountId)).length >= maxDecksPerAccount
      ) {
        response.status(409).json({ error: "DECK_LIMIT_REACHED" });
        return;
      }
      const deck = buildDeckRecord({
        accountId: account.accountId,
        deckId: deckId.data,
        ...body,
        revision: (existing?.revision ?? 0) + 1,
      });
      await store.saveDeck(deck);
      const [snapshot, profile] = await Promise.all([
        store.getEconomySnapshot(account.accountId),
        currentProfile(store, account.accountId),
      ]);
      response.json({
        deck: { ...deck, status: deckStatus(deck, snapshot.cards, profile) },
      });
    },
  );

  app.delete(
    "/api/me/decks/:deckId",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const deckId = identifier.safeParse(request.params.deckId);
      if (
        !deckId.success ||
        !(await store.deleteDeck(account.accountId, deckId.data))
      ) {
        response.status(404).json({ error: "DECK_NOT_FOUND" });
        return;
      }
      response.sendStatus(204);
    },
  );

  app.get(
    "/api/me/economy",
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      response.json({
        snapshot: await store.getEconomySnapshot(account.accountId),
      });
    },
  );

  app.get(
    "/api/me/economy/transactions",
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      response.json({
        transactions: await store.listEconomyTransactions(
          account.accountId,
          100,
        ),
      });
    },
  );

  app.post(
    "/api/me/economy/craft",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const body = parseBody(
        craftBody,
        request,
        response,
        "INVALID_CRAFT_REQUEST",
      );
      if (!body) return;
      const liveOps = await currentLiveOps(store);
      if (liveOps.featureFlags["economy.crafting"] === false) {
        response.status(503).json({ error: "CRAFTING_DISABLED" });
        return;
      }
      const card = proofCardMap.get(body.cardId);
      if (!card) {
        response.status(404).json({ error: "CARD_NOT_FOUND" });
        return;
      }
      try {
        response.json({
          snapshot: await store.craftCard(
            body.transactionId,
            account.accountId,
            card,
            body.quantity,
          ),
        });
      } catch (error) {
        sendEconomyError(response, error);
      }
    },
  );

  app.post(
    "/api/me/economy/cosmetics",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const body = parseBody(
        cosmeticBody,
        request,
        response,
        "INVALID_COSMETIC_REQUEST",
      );
      if (!body) return;
      const cosmetic = cosmeticCatalog.find(
        (item) => item.cosmeticId === body.cosmeticId,
      );
      if (!cosmetic) {
        response.status(404).json({ error: "COSMETIC_NOT_FOUND" });
        return;
      }
      try {
        response.json({
          snapshot: await store.unlockCosmetic(
            body.transactionId,
            account.accountId,
            cosmetic,
          ),
        });
      } catch (error) {
        sendEconomyError(response, error);
      }
    },
  );

  app.get(
    "/api/me/competitive-profile",
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      response.json({
        profile: competitiveView(
          await currentProfile(store, account.accountId),
        ),
      });
    },
  );

  app.get("/api/me/quests", async (request: AuthenticatedRequest, response) => {
    const account = requireAccount(request, response);
    if (!account) return;
    response.json({
      quests: await questsFor(
        store,
        account.accountId,
        await currentLiveOps(store),
      ),
    });
  });

  app.post(
    "/api/me/quests/:questId/claim",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const quests = await questsFor(
        store,
        account.accountId,
        await currentLiveOps(store),
      );
      const quest = quests.find(
        (item) => item.questId === request.params.questId,
      );
      if (!quest) {
        response.status(404).json({ error: "QUEST_NOT_FOUND" });
        return;
      }
      if (!quest.complete) {
        response.status(409).json({ error: "QUEST_INCOMPLETE" });
        return;
      }
      const cosmetic = quest.reward.cosmeticId
        ? cosmeticCatalog.find(
            (item) => item.cosmeticId === quest.reward.cosmeticId,
          )
        : undefined;
      const result = await store.claimQuestReward({
        accountId: account.accountId,
        questId: quest.questId,
        periodKey: quest.periodKey,
        reward: {
          ...(quest.reward.shards ? { shards: quest.reward.shards } : {}),
          ...(quest.reward.styleTokens
            ? { styleTokens: quest.reward.styleTokens }
            : {}),
          ...(cosmetic ? { cosmetic } : {}),
        },
      });
      response.status(result.claimed ? 200 : 409).json({
        ...(result.claimed ? {} : { error: "QUEST_ALREADY_CLAIMED" }),
        snapshot: result.snapshot,
      });
    },
  );

  app.get(
    "/api/me/training-completions",
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      response.json({
        scenarioIds: await store.listTrainingCompletions(account.accountId),
      });
    },
  );

  app.get(
    "/api/me/support-cases",
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      response.json({
        cases: await store.listSupportCases({ accountId: account.accountId }),
      });
    },
  );

  app.post(
    "/api/me/support-cases",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const body = parseBody(
        supportCaseBody,
        request,
        response,
        "INVALID_SUPPORT_CASE",
      );
      if (!body) return;
      const supportCase = await store.createSupportCase({
        caseId: `case:${randomUUID()}`,
        accountId: account.accountId,
        summary: body.summary,
      });
      await store.appendAudit({
        auditId: `audit:${randomUUID()}`,
        actorId: account.accountId,
        action: "support.create",
        targetId: supportCase.caseId,
        payload: { summary: supportCase.summary },
      });
      response.status(201).json({ case: supportCase });
    },
  );

  app.get(
    "/api/me/matches",
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const before = z.iso.datetime().safeParse(request.query.before);
      response.json({
        matches: await store.listMatchHistory(account.accountId, {
          limit: 25,
          ...(before.success ? { before: before.data } : {}),
        }),
      });
    },
  );

  app.get(
    "/api/matches/:matchId/replay",
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const matchId = z
        .string()
        .regex(/^[a-zA-Z0-9_-]{3,80}$/)
        .safeParse(request.params.matchId);
      if (!matchId.success) {
        response.status(400).json({ error: "INVALID_MATCH" });
        return;
      }
      const [record, meta, participants] = await Promise.all([
        store.getMatch(matchId.data),
        store.getMatchMeta(matchId.data),
        store.getMatchParticipants(matchId.data),
      ]);
      const own = participants.find(
        (row) => row.accountId === account.accountId,
      );
      const admin = account.role === "admin";
      if (!record || !meta || (!own && !admin)) {
        response.status(404).json({ error: "REPLAY_NOT_FOUND" });
        return;
      }
      if (!meta.completedAt && !admin) {
        response.status(409).json({ error: "MATCH_IN_PROGRESS" });
        return;
      }
      const perspectives: ReplayPerspective[] = admin
        ? ["public", "p1", "p2"]
        : ["public", own!.seat];
      const query = (key: string) =>
        typeof request.query[key] === "string" ? request.query[key] : undefined;
      const requested = query("perspective") ?? own?.seat ?? "public";
      const perspective = perspectives.find((item) => item === requested);
      if (!perspective) {
        response.status(403).json({ error: "PERSPECTIVE_FORBIDDEN" });
        return;
      }
      const { value } = replayCache.get(record.replay, perspective);
      if (!value.verified) {
        metrics.integrityFailures.inc({ kind: "replay_verification" });
        logger.critical("replay verification failed", {
          matchId: matchId.data,
          accountId: account.accountId,
          expectedHash: value.expectedHash,
          actualHash: value.actualHash,
          reason: value.error,
        });
      }
      const from = Math.max(0, Number.parseInt(query("from") ?? "0", 10) || 0);
      const count = Math.min(
        200,
        Math.max(1, Number.parseInt(query("count") ?? "200", 10) || 200),
      );
      response.json({
        matchId: matchId.data,
        meta,
        participants: participants.map((row: MatchParticipantRecord) => ({
          seat: row.seat,
          displayName: row.displayName,
          leaderId: row.leaderId,
          deckName: row.deckName,
          result: row.result,
        })),
        perspective,
        perspectives,
        verification: {
          verified: value.verified,
          expectedHash: value.expectedHash,
          actualHash: value.actualHash,
          error: value.error,
        },
        totalFrames: value.frames.length,
        from,
        frames: value.frames.slice(from, from + count),
      });
    },
  );

  app.post(
    "/api/me/invites",
    inviteLimiter,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const invite = await store.createInvite({
            code: generateInviteCode(),
            hostAccountId: account.accountId,
            expiresAt: new Date(Date.now() + inviteTtlMs).toISOString(),
          });
          response.status(201).json({
            invite,
            url: `${config.webUrl}/join/${invite.code}`,
          });
          return;
        } catch (error) {
          if (!(
            error instanceof InviteError && error.code === "INVITE_CODE_TAKEN"
          ))
            throw error;
        }
      }
      response.status(503).json({ error: "INVITE_UNAVAILABLE" });
    },
  );

  app.delete(
    "/api/me/invites/:code",
    writes,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const code = String(request.params.code).toUpperCase();
      response.sendStatus(
        inviteCodePattern.test(code) &&
          (await store.cancelInvite(code, account.accountId))
          ? 204
          : 404,
      );
    },
  );

  app.get(
    "/api/invites/:code",
    inviteLimiter,
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      const code = String(request.params.code).toUpperCase();
      const invite = inviteCodePattern.test(code)
        ? await store.getInvite(code)
        : null;
      if (!invite || invite.status === "cancelled") {
        response.status(404).json({ error: "INVITE_NOT_FOUND" });
        return;
      }
      const host = await store.getAccount(invite.hostAccountId);
      const expired = Date.parse(invite.expiresAt) <= Date.now();
      const isHost = invite.hostAccountId === account.accountId;
      const isGuest = invite.guestAccountId === account.accountId;
      const available =
        !expired &&
        invite.status !== "started" &&
        (isHost || isGuest || invite.guestAccountId === null);
      response.json({
        invite: {
          code: invite.code,
          status:
            expired && invite.status !== "started" ? "expired" : invite.status,
          expiresAt: invite.expiresAt,
          hostDisplayName: host?.displayName ?? "A player",
          role: isHost ? "host" : isGuest ? "guest" : "visitor",
          available,
        },
      });
    },
  );
}
