import { randomUUID } from "node:crypto";
import type { Application } from "express";
import { z } from "zod";
import { aggregateBalanceOverview, seasonOne } from "@cardforge/competitive";
import {
  liveOpsWarnings,
  stageLiveOps,
  validateLiveOps,
  type LiveOpsDefinition,
} from "@cardforge/live-ops";
import type { CardForgeStore } from "@cardforge/persistence";
import { prototypeCards } from "@cardforge/rules-tempofront";
import {
  digest,
  randomToken,
  requireAdmin,
  type AuthenticatedRequest,
} from "../auth.js";
import type { ServerConfig } from "../config.js";
import { currentLiveOps } from "../game-service.js";
import { playtestOverview } from "../playtest-telemetry.js";
import { parseBody } from "./middleware.js";

const reward = z
  .object({
    shards: z.number().int().min(0).max(10_000).optional(),
    styleTokens: z.number().int().min(0).max(10_000).optional(),
    cosmeticId: z.string().min(3).max(120).optional(),
  })
  .strict();

const eventSchema = z
  .object({
    eventId: z.string().regex(/^event\.[a-z0-9-]{3,60}$/),
    title: z.string().trim().min(3).max(60),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    featureFlag: z.string().regex(/^event\.[a-z0-9-]{3,60}$/),
    scenarioIds: z.array(z.string().max(80)).max(10).optional(),
    reward,
  })
  .strict();

const stageBody = z
  .object({
    revision: z.number().int().positive(),
    featureFlags: z.record(z.string().min(3).max(100), z.boolean()).default({}),
    events: z.array(eventSchema).max(20).optional(),
  })
  .strict();

const publishBody = z
  .object({
    sourceRevision: z.number().int().positive(),
    revision: z.number().int().positive(),
  })
  .strict();

const supportUpdateBody = z
  .object({
    status: z.enum(["open", "resolved"]).optional(),
    note: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()
  .refine((body) => body.status !== undefined || body.note !== undefined);

export function registerAdminRoutes(
  app: Application,
  deps: { readonly store: CardForgeStore; readonly config: ServerConfig },
): void {
  const { store, config } = deps;
  const admin = (
    request: AuthenticatedRequest,
    response: Parameters<typeof requireAdmin>[1],
  ) => requireAdmin(request, response, config.adminToken);
  const audit = (
    actorId: string,
    action: string,
    targetId: string,
    payload: Record<string, unknown>,
  ) =>
    store.appendAudit({
      auditId: `audit:${randomUUID()}`,
      actorId,
      action,
      targetId,
      payload,
    });

  app.get(
    "/api/admin/operations",
    async (request: AuthenticatedRequest, response) => {
      if (!admin(request, response)) return;
      const current = await currentLiveOps(store);
      response.json({
        current,
        warnings: liveOpsWarnings(current, Date.now()),
        revisions: await store.listLiveOpsDefinitions(),
        cases: await store.listSupportCases(),
        audit: await store.listAudit(100),
      });
    },
  );

  app.post(
    "/api/admin/live-ops/stage",
    async (request: AuthenticatedRequest, response) => {
      const actor = admin(request, response);
      if (!actor) return;
      const body = parseBody(
        stageBody,
        request,
        response,
        "INVALID_LIVE_OPS_STAGE",
      );
      if (!body) return;
      const base = await currentLiveOps(store);
      let staged: LiveOpsDefinition;
      try {
        staged = stageLiveOps(base, body.revision);
      } catch (error) {
        response.status(409).json({
          error: "LIVE_OPS_CONFLICT",
          message: (error as Error).message,
        });
        return;
      }
      const events = (body.events ?? staged.events).map((event) => ({
        ...event,
        reward: Object.fromEntries(
          Object.entries(event.reward).filter(
            ([, value]) => value !== undefined,
          ),
        ),
      })) as LiveOpsDefinition["events"];
      const definition: LiveOpsDefinition = {
        ...staged,
        events,
        featureFlags: { ...base.featureFlags, ...body.featureFlags },
      };
      const errors = validateLiveOps(definition);
      if (errors.length) {
        response
          .status(422)
          .json({ error: "INVALID_LIVE_OPS", details: errors });
        return;
      }
      try {
        await store.saveLiveOpsDefinition(definition);
      } catch (error) {
        response.status(409).json({
          error: "LIVE_OPS_CONFLICT",
          message: (error as Error).message,
        });
        return;
      }
      await audit(
        actor.actorId,
        "liveops.stage",
        `${definition.configId}@${definition.revision}`,
        {
          featureFlags: body.featureFlags,
          events: events.map((event) => event.eventId),
        },
      );
      response.status(201).json({
        definition,
        warnings: liveOpsWarnings(definition, Date.now()),
      });
    },
  );

  app.post(
    "/api/admin/live-ops/publish",
    async (request: AuthenticatedRequest, response) => {
      const actor = admin(request, response);
      if (!actor) return;
      const body = parseBody(
        publishBody,
        request,
        response,
        "INVALID_LIVE_OPS_PUBLISH",
      );
      if (!body) return;
      if (body.revision <= body.sourceRevision) {
        response.status(400).json({ error: "INVALID_LIVE_OPS_PUBLISH" });
        return;
      }
      const source = (await store.listLiveOpsDefinitions()).find(
        (definition) =>
          definition.revision === body.sourceRevision &&
          definition.state === "staged",
      );
      if (!source) {
        response.status(404).json({ error: "STAGED_REVISION_NOT_FOUND" });
        return;
      }
      const definition: LiveOpsDefinition = {
        ...source,
        revision: body.revision,
        state: "published",
      };
      try {
        await store.saveLiveOpsDefinition(definition);
      } catch (error) {
        response.status(409).json({
          error: "LIVE_OPS_CONFLICT",
          message: (error as Error).message,
        });
        return;
      }
      await audit(
        actor.actorId,
        "liveops.publish",
        `${definition.configId}@${definition.revision}`,
        {
          sourceRevision: source.revision,
        },
      );
      response.status(201).json({
        definition,
        warnings: liveOpsWarnings(definition, Date.now()),
      });
    },
  );

  app.post(
    "/api/admin/support-cases/:caseId",
    async (request: AuthenticatedRequest, response) => {
      const actor = admin(request, response);
      if (!actor) return;
      const caseId = z
        .string()
        .min(8)
        .max(120)
        .safeParse(request.params.caseId);
      const body = parseBody(
        supportUpdateBody,
        request,
        response,
        "INVALID_SUPPORT_UPDATE",
      );
      if (!body) return;
      if (!caseId.success) {
        response.status(400).json({ error: "INVALID_SUPPORT_UPDATE" });
        return;
      }
      try {
        const supportCase = await store.updateSupportCase({
          caseId: caseId.data,
          ...(body.status === undefined ? {} : { status: body.status }),
          ...(body.note === undefined ? {} : { note: body.note }),
        });
        await audit(actor.actorId, "support.update", supportCase.caseId, body);
        response.json({ case: supportCase });
      } catch {
        response.status(404).json({ error: "SUPPORT_CASE_NOT_FOUND" });
      }
    },
  );

  /** Support lookup: find an account by sign-in email or account ID. */
  app.get(
    "/api/admin/accounts",
    async (request: AuthenticatedRequest, response) => {
      if (!admin(request, response)) return;
      const query =
        typeof request.query.q === "string" ? request.query.q.trim() : "";
      if (!query || query.length > 254) {
        response.status(400).json({ error: "INVALID_QUERY" });
        return;
      }
      const credential = query.includes("@")
        ? await store.getPasswordCredential(query.toLowerCase())
        : null;
      const account = await store.getAccount(credential?.accountId ?? query);
      if (!account) {
        response.status(404).json({ error: "ACCOUNT_NOT_FOUND" });
        return;
      }
      response.json({
        account: {
          accountId: account.accountId,
          displayName: account.displayName,
          role: account.role,
          status: account.status,
          createdAt: account.createdAt,
        },
      });
    },
  );

  /** Grants or revokes the operator role; the only path to admin by email. */
  app.post(
    "/api/admin/accounts/:accountId/role",
    async (request: AuthenticatedRequest, response) => {
      const actor = admin(request, response);
      if (!actor) return;
      const body = parseBody(
        z.object({ role: z.enum(["player", "admin"]) }).strict(),
        request,
        response,
        "INVALID_ROLE",
      );
      if (!body) return;
      const accountId = String(request.params.accountId);
      if (accountId === actor.actorId && body.role !== "admin") {
        response.status(400).json({ error: "CANNOT_DEMOTE_SELF" });
        return;
      }
      const account = await store.updateAccountProfile(accountId, {
        role: body.role,
      });
      if (!account) {
        response.status(404).json({ error: "ACCOUNT_NOT_FOUND" });
        return;
      }
      await audit(actor.actorId, "account.role", accountId, body);
      response.json({ account: { accountId, role: account.role } });
    },
  );

  /**
   * Issues a one-time, 7-day code. For an account without a password it lets
   * the player attach one (legacy alpha claim); for an account with a
   * password it lets the player set a new one (support-assisted reset).
   */
  app.post(
    "/api/admin/accounts/:accountId/claim-code",
    async (request: AuthenticatedRequest, response) => {
      const actor = admin(request, response);
      if (!actor) return;
      const accountId = String(request.params.accountId);
      const account = await store.getAccount(accountId);
      if (!account) {
        response.status(404).json({ error: "ACCOUNT_NOT_FOUND" });
        return;
      }
      const code = randomToken(15);
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await store.createAccountClaim({
        codeHash: digest(code),
        accountId,
        expiresAt,
      });
      await audit(actor.actorId, "account.claim_code", accountId, {
        expiresAt,
      });
      response.status(201).json({ claimCode: code, expiresAt });
    },
  );

  app.get(
    "/api/admin/telemetry/balance",
    async (request: AuthenticatedRequest, response) => {
      if (!admin(request, response)) return;
      const telemetry = await store.listTelemetry(seasonOne.seasonId, 10_000);
      response.json({
        season: seasonOne,
        overview: aggregateBalanceOverview(telemetry),
      });
    },
  );

  app.get(
    "/api/admin/telemetry/playtest",
    async (request: AuthenticatedRequest, response) => {
      if (!admin(request, response)) return;
      const since = z.iso.datetime().safeParse(request.query.since);
      const window = since.success ? { since: since.data } : {};
      const [matches, telemetry, events] = await Promise.all([
        store.listCompletedMatches({ ...window, limit: 5_000 }),
        store.listTelemetry(undefined, 10_000),
        store.listProductEvents({ ...window, limit: 50_000 }),
      ]);
      response.json({
        overview: playtestOverview({
          matches,
          telemetry,
          events,
          collectibleCardIds: prototypeCards
            .filter((card) => card.type !== "leader" && !card.generatedOnly)
            .map((card) => card.cardId),
        }),
      });
    },
  );
}
