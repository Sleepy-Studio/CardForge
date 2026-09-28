import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import type { ServerConfig } from "../config.js";
import { logger, type Logger } from "../logger.js";
import { metrics } from "../metrics.js";

export interface RequestContext {
  readonly requestId: string;
  readonly log: Logger;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

const requestIdPattern = /^[a-zA-Z0-9._-]{8,80}$/;

/** Assigns a request ID (honouring a sane upstream one) and logs completion. */
export function requestContext() {
  return (request: Request, response: Response, next: NextFunction) => {
    const upstream = request.header("x-request-id");
    const requestId =
      upstream && requestIdPattern.test(upstream) ? upstream : randomUUID();
    const log = logger.child({ requestId });
    request.context = { requestId, log };
    response.setHeader("x-request-id", requestId);
    const startedAt = process.hrtime.bigint();
    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const routeClass = routeClassFor(request.path);
      const statusClass = `${Math.floor(response.statusCode / 100)}xx`;
      metrics.httpRequests.inc({ route: routeClass, status: statusClass });
      if (response.statusCode >= 500) metrics.httpErrors.inc({ route: routeClass });
      if (routeClass === "probe" && response.statusCode < 400) return;
      const account = (request as Request & { account?: { accountId: string } }).account;
      log[response.statusCode >= 500 ? "error" : "info"]("http request", {
        method: request.method,
        route: routeClass,
        path: request.path.slice(0, 120),
        status: response.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        ...(account ? { accountId: account.accountId } : {}),
      });
    });
    next();
  };
}

function routeClassFor(path: string): string {
  if (path === "/health" || path === "/ready" || path === "/metrics") return "probe";
  if (path.startsWith("/api/auth")) return "auth";
  if (path.startsWith("/api/admin")) return "admin";
  if (path.startsWith("/api/me")) return "player";
  if (path.startsWith("/api")) return "public";
  if (path.startsWith("/matchmake")) return "matchmake";
  return "other";
}

/**
 * Credentialed CORS for the configured web origins plus a CSRF guard: any
 * state-changing request carrying an Origin must come from an allowed origin.
 * Requests must also be JSON, which forces a browser preflight cross-origin.
 */
export function corsAndCsrf(config: ServerConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.header("origin");
    const allowed = origin !== undefined && config.allowedOrigins.has(origin);
    if (allowed) {
      response.header("access-control-allow-origin", origin);
      response.header("access-control-allow-credentials", "true");
      response.header(
        "access-control-allow-headers",
        "content-type,authorization,x-request-id",
      );
      response.header("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      response.header("access-control-max-age", "600");
    }
    response.header("vary", "origin");
    if (request.method === "OPTIONS") {
      response.sendStatus(allowed ? 204 : 403);
      return;
    }
    const mutating = !["GET", "HEAD"].includes(request.method);
    if (mutating && origin !== undefined && !allowed) {
      response.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
      return;
    }
    next();
  };
}

export function requireJsonBodies() {
  return (request: Request, response: Response, next: NextFunction) => {
    const hasBody =
      !["GET", "HEAD", "OPTIONS", "DELETE"].includes(request.method) &&
      Number(request.header("content-length") ?? "0") > 0;
    if (!hasBody || request.is("application/json")) {
      next();
      return;
    }
    response.status(415).json({ error: "JSON_REQUIRED" });
  };
}

export function securityHeaders() {
  return (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("cache-control", "no-store");
    next();
  };
}

/** Parses a body with a strict schema, answering 400 with field paths. */
export function parseBody<T>(
  schema: ZodType<T>,
  request: Request,
  response: Response,
  error = "INVALID_REQUEST",
): T | null {
  const result = schema.safeParse(request.body ?? {});
  if (result.success) return result.data;
  response.status(400).json({
    error,
    issues: result.error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
  return null;
}

export function errorHandler() {
  return (
    error: unknown,
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    void next;
    if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      error.type === "entity.parse.failed"
    ) {
      response.status(400).json({ error: "MALFORMED_JSON" });
      return;
    }
    if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
      response.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
      return;
    }
    (request.context?.log ?? logger).error("unhandled request error", { error });
    if (!response.headersSent)
      response.status(500).json({
        error: "INTERNAL_ERROR",
        requestId: request.context?.requestId,
      });
  };
}
