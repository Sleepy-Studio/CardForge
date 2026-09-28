import { randomUUID } from "node:crypto";
import type { Application, Request, Response } from "express";
import { z } from "zod";
import {
  AuthStoreError,
  type AccountRecord,
  type AccountRole,
  type CardForgeStore,
} from "@cardforge/persistence";
import {
  decoyPasswordHash,
  digest,
  hashPassword,
  issueMatchTicket,
  matchTicketTtlMs,
  newAccountId,
  normalizeEmail,
  parseCookies,
  randomToken,
  requireAccount,
  serializeCookie,
  sessionCookieName,
  signPayload,
  verifyPassword,
  verifyPayload,
  type AuthenticatedRequest,
} from "../auth.js";
import type { ServerConfig } from "../config.js";
import { metrics } from "../metrics.js";
import { RateLimiter, rateLimit } from "../rate-limit.js";
import { parseBody } from "./middleware.js";

export const displayNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u,
    "Use letters, numbers, spaces, and . _ ' -",
  );

const registerBody = z
  .object({
    email: z.email().max(254),
    password: z.string().min(10).max(200),
    displayName: displayNameSchema,
    signupCode: z.string().trim().max(80).optional(),
    claimCode: z.string().trim().min(8).max(80).optional(),
  })
  .strict();

const loginBody = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

const oauthCookieName = "cardforge_oauth";

/** Only same-app relative paths may be used as post-login destinations. */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return null;
  return /^\/[a-zA-Z0-9/_\-?=&.%]*$/.test(value) ? value : null;
}

export function accountView(account: AccountRecord) {
  return {
    accountId: account.accountId,
    displayName: account.displayName,
    role: account.role,
    onboarding: {
      starterLeaderId: account.starterLeaderId,
      completedAt: account.onboardingCompletedAt,
    },
    createdAt: account.createdAt,
  };
}

export function registerAuthRoutes(
  app: Application,
  deps: { readonly store: CardForgeStore; readonly config: ServerConfig },
): void {
  const { store, config } = deps;
  const cookiePolicy = {
    secure: config.cookieSecure,
    domain: config.cookieDomain,
  };
  const authLimiter = rateLimit(new RateLimiter(30, 10 * 60_000));
  const emailLimiter = new RateLimiter(10, 10 * 60_000);

  const startSession = async (response: Response, accountId: string) => {
    const token = randomToken();
    await store.createSession({
      tokenHash: digest(token),
      accountId,
      expiresAt: new Date(Date.now() + config.sessionTtlMs).toISOString(),
    });
    response.append(
      "set-cookie",
      serializeCookie(
        sessionCookieName,
        token,
        cookiePolicy,
        config.sessionTtlMs / 1_000,
      ),
    );
  };

  const signupAllowed = (code: string | undefined) =>
    config.signupMode === "open" ||
    (code !== undefined && config.signupCodes.has(code));

  const productEvent = (
    accountId: string,
    name: string,
    properties: Record<string, string>,
  ) =>
    store
      .recordProductEvent({
        eventId: `evt:${randomUUID()}`,
        accountId,
        name,
        properties,
      })
      .catch(() => undefined);

  app.get("/api/auth/providers", (_request, response) => {
    response.json({
      password: true,
      discord: config.discord !== null,
      signupMode: config.signupMode,
    });
  });

  app.get("/api/auth/session", (request: AuthenticatedRequest, response) => {
    response.json({
      account: request.account ? accountView(request.account) : null,
    });
  });

  app.post(
    "/api/auth/register",
    authLimiter,
    async (request: AuthenticatedRequest, response) => {
      const body = parseBody(
        registerBody,
        request,
        response,
        "INVALID_REGISTRATION",
      );
      if (!body) return;
      if (body.claimCode === undefined && !signupAllowed(body.signupCode)) {
        response.status(403).json({ error: "SIGNUP_CODE_REQUIRED" });
        return;
      }
      const email = normalizeEmail(body.email);
      const role: AccountRole = config.adminEmails.has(email)
        ? "admin"
        : "player";
      try {
        const accountId = await store.registerPasswordAccount({
          accountId: newAccountId(),
          displayName: body.displayName,
          email,
          passwordHash: await hashPassword(body.password),
          role,
          ...(body.claimCode === undefined
            ? {}
            : { claimCodeHash: digest(body.claimCode) }),
        });
        await startSession(response, accountId);
        metrics.authEvents.inc({ kind: "register", result: "ok" });
        void productEvent(accountId, "account_registered", {
          method: "password",
        });
        const account = await store.getAccount(accountId);
        response
          .status(201)
          .json({ account: account ? accountView(account) : null });
      } catch (error) {
        if (error instanceof AuthStoreError) {
          metrics.authEvents.inc({ kind: "register", result: error.code });
          response
            .status(error.code === "EMAIL_TAKEN" ? 409 : 400)
            .json({ error: error.code });
          return;
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/auth/login",
    authLimiter,
    async (request: AuthenticatedRequest, response) => {
      const body = parseBody(loginBody, request, response, "INVALID_LOGIN");
      if (!body) return;
      const email = normalizeEmail(body.email);
      if (!emailLimiter.take(email)) {
        response.status(429).json({ error: "RATE_LIMITED" });
        return;
      }
      const credential = await store.getPasswordCredential(email);
      // Always run scrypt so response timing does not reveal registered emails.
      const valid = await verifyPassword(
        body.password,
        credential?.passwordHash ?? (await decoyPasswordHash()),
      );
      const account =
        credential && valid
          ? await store.getAccount(credential.accountId)
          : null;
      if (!account || account.status !== "active") {
        metrics.authEvents.inc({ kind: "login", result: "rejected" });
        response.status(401).json({ error: "INVALID_CREDENTIALS" });
        return;
      }
      let current = account;
      if (config.adminEmails.has(email) && account.role !== "admin")
        current =
          (await store.updateAccountProfile(account.accountId, {
            role: "admin",
          })) ?? account;
      await startSession(response, current.accountId);
      metrics.authEvents.inc({ kind: "login", result: "ok" });
      response.json({ account: accountView(current) });
    },
  );

  app.post(
    "/api/auth/logout",
    async (request: AuthenticatedRequest, response) => {
      if (request.sessionTokenHash)
        await store.deleteSession(request.sessionTokenHash);
      response.append(
        "set-cookie",
        serializeCookie(sessionCookieName, "", cookiePolicy, 0),
      );
      response.sendStatus(204);
    },
  );

  app.post(
    "/api/auth/logout-all",
    async (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      await store.deleteAccountSessions(account.accountId);
      response.append(
        "set-cookie",
        serializeCookie(sessionCookieName, "", cookiePolicy, 0),
      );
      response.sendStatus(204);
    },
  );

  /** Short-lived credential for the WebSocket room handshake. */
  app.post(
    "/api/me/match-ticket",
    (request: AuthenticatedRequest, response) => {
      const account = requireAccount(request, response);
      if (!account) return;
      response.json({
        ticket: issueMatchTicket(config.sessionSecret, account.accountId),
        expiresInMs: matchTicketTtlMs,
      });
    },
  );

  app.get(
    "/api/auth/discord/start",
    authLimiter,
    (request: Request, response: Response) => {
      if (!config.discord) {
        response.status(404).json({ error: "PROVIDER_DISABLED" });
        return;
      }
      const state = randomToken(18);
      const signupCode =
        typeof request.query.signupCode === "string"
          ? request.query.signupCode.slice(0, 80)
          : "";
      const next = safeNextPath(request.query.next) ?? "/";
      const sealed = signPayload(
        config.sessionSecret,
        "oauth",
        { state, next, signupCode },
        10 * 60_000,
      );
      response.append(
        "set-cookie",
        serializeCookie(oauthCookieName, sealed, cookiePolicy, 600),
      );
      const url = new URL(config.discord.authorizeUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", config.discord.clientId);
      url.searchParams.set("scope", "identify");
      url.searchParams.set("state", state);
      url.searchParams.set(
        "redirect_uri",
        `${config.publicUrl}/api/auth/discord/callback`,
      );
      url.searchParams.set("prompt", "none");
      response.redirect(302, url.toString());
    },
  );

  app.get(
    "/api/auth/discord/callback",
    authLimiter,
    async (request: Request, response: Response) => {
      const fail = (reason: string) => {
        metrics.authEvents.inc({ kind: "discord", result: reason });
        response.append(
          "set-cookie",
          serializeCookie(oauthCookieName, "", cookiePolicy, 0),
        );
        response.redirect(
          302,
          `${config.webUrl}/login?error=${encodeURIComponent(reason)}`,
        );
      };
      if (!config.discord) return fail("provider_disabled");
      const sealed =
        parseCookies(request.header("cookie")).get(oauthCookieName) ?? "";
      const payload = verifyPayload(config.sessionSecret, "oauth", sealed);
      const code =
        typeof request.query.code === "string" ? request.query.code : "";
      if (
        !payload ||
        payload.state !== request.query.state ||
        !code ||
        code.length > 512
      )
        return fail("oauth_state_mismatch");
      let profile: { id?: unknown; username?: unknown; global_name?: unknown };
      try {
        const token = await fetch(`${config.discord.apiBase}/oauth2/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: `${config.publicUrl}/api/auth/discord/callback`,
            client_id: config.discord.clientId,
            client_secret: config.discord.clientSecret,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!token.ok) return fail("oauth_exchange_failed");
        const { access_token: accessToken } = (await token.json()) as {
          access_token?: string;
        };
        if (!accessToken) return fail("oauth_exchange_failed");
        const me = await fetch(`${config.discord.apiBase}/users/@me`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!me.ok) return fail("oauth_profile_failed");
        profile = (await me.json()) as typeof profile;
      } catch (error) {
        request.context?.log.warn("discord oauth request failed", { error });
        return fail("oauth_unavailable");
      }
      const subject =
        typeof profile.id === "string" && /^\d{5,30}$/.test(profile.id)
          ? profile.id
          : null;
      if (!subject) return fail("oauth_profile_failed");
      const existing = await store.findOAuthAccount("discord", subject);
      if (
        !existing &&
        !signupAllowed(
          typeof payload.signupCode === "string" && payload.signupCode
            ? payload.signupCode
            : undefined,
        )
      )
        return fail("signup_code_required");
      const rawName =
        typeof profile.global_name === "string"
          ? profile.global_name
          : typeof profile.username === "string"
            ? profile.username
            : "Player";
      const parsedName = displayNameSchema.safeParse(rawName.slice(0, 32));
      const { accountId, created } = await store.resolveOAuthAccount({
        provider: "discord",
        subject,
        newAccountId: newAccountId(),
        displayName: parsedName.success ? parsedName.data : "Player",
        role: config.adminDiscordIds.has(subject) ? "admin" : "player",
      });
      const account = await store.getAccount(accountId);
      if (!account || account.status !== "active")
        return fail("account_unavailable");
      if (config.adminDiscordIds.has(subject) && account.role !== "admin")
        await store.updateAccountProfile(accountId, { role: "admin" });
      await startSession(response, accountId);
      if (created)
        void productEvent(accountId, "account_registered", {
          method: "discord",
        });
      metrics.authEvents.inc({ kind: "discord", result: "ok" });
      response.append(
        "set-cookie",
        serializeCookie(oauthCookieName, "", cookiePolicy, 0),
      );
      const next = account.starterLeaderId
        ? (safeNextPath(payload.next) ?? "/")
        : "/onboarding";
      response.redirect(302, `${config.webUrl}${next}`);
    },
  );
}
