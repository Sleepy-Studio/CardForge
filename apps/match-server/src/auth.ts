import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AccountRecord, CardForgeStore } from "@cardforge/persistence";

/*
 * Authentication primitives. Session tokens are 256-bit random values kept in
 * an HttpOnly cookie; the database stores only their SHA-256 digest, so a
 * database leak does not yield usable sessions. WebSocket joins use a short
 * HMAC ticket minted from an authenticated HTTP request because the room
 * handshake cannot rely on cross-origin cookies.
 */

function scrypt(
  password: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(password, salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

const scryptParameters = { N: 16_384, r: 8, p: 1 } as const;
const keyLength = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, keyLength, {
    ...scryptParameters,
    maxmem: 64 * 1024 * 1024,
  });
  const { N, r, p } = scryptParameters;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map((part) => Number.parseInt(part, 10));
  if (!N || !r || !p || N > 1_048_576) return false;
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");
  const actual = await scrypt(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash to verify against when an email is unknown, equalising timing. */
let decoyHash: Promise<string> | null = null;
export function decoyPasswordHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(12).toString("base64url"));
  return decoyHash;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function newAccountId(): string {
  return `acct-${randomBytes(12).toString("base64url")}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sign(secret: Buffer, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Signs a small JSON payload with an expiry: `<payload>.<signature>`. */
export function signPayload(
  secret: Buffer,
  purpose: string,
  payload: Readonly<Record<string, unknown>>,
  ttlMs: number,
  nowMs = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, pur: purpose, exp: nowMs + ttlMs }),
  ).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

export function verifyPayload(
  secret: Buffer,
  purpose: string,
  token: string,
  nowMs = Date.now(),
): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length > 2_048) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, sign(secret, body))) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (payload.pur !== purpose) return null;
    if (typeof payload.exp !== "number" || payload.exp <= nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

export const matchTicketTtlMs = 5 * 60_000;

export function issueMatchTicket(
  secret: Buffer,
  accountId: string,
  nowMs = Date.now(),
): string {
  return signPayload(
    secret,
    "match",
    { sub: accountId },
    matchTicketTtlMs,
    nowMs,
  );
}

export function verifyMatchTicket(
  secret: Buffer,
  ticket: string,
  nowMs = Date.now(),
): string | null {
  const payload = verifyPayload(secret, "match", ticket, nowMs);
  return typeof payload?.sub === "string" ? payload.sub : null;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      if (!cookies.has(name)) cookies.set(name, decodeURIComponent(value));
    } catch {
      // Ignore malformed cookie encodings rather than failing the request.
    }
  }
  return cookies;
}

export interface CookiePolicy {
  readonly secure: boolean;
  readonly domain: string | null;
}

export const sessionCookieName = "cardforge_session";

export function serializeCookie(
  name: string,
  value: string,
  policy: CookiePolicy,
  maxAgeSeconds: number,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    ...(policy.secure ? ["Secure"] : []),
    ...(policy.domain ? [`Domain=${policy.domain}`] : []),
  ].join("; ");
}

export interface AuthenticatedRequest extends Request {
  account?: AccountRecord;
  sessionTokenHash?: string;
}

/** Refresh the sliding expiry at most this often to avoid a write per call. */
const sessionTouchIntervalMs = 60 * 60_000;

export function sessionMiddleware(
  store: CardForgeStore,
  options: { readonly ttlMs: number },
) {
  return async (
    request: AuthenticatedRequest,
    _response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token = parseCookies(request.header("cookie")).get(
        sessionCookieName,
      );
      if (token && token.length <= 128) {
        const tokenHash = digest(token);
        const session = await store.getSession(tokenHash);
        if (session) {
          const account = await store.getAccount(session.accountId);
          if (account && account.status === "active") {
            request.account = account;
            request.sessionTokenHash = tokenHash;
            if (
              Date.now() - Date.parse(session.lastSeenAt) >
              sessionTouchIntervalMs
            )
              await store.touchSession(
                tokenHash,
                new Date(Date.now() + options.ttlMs).toISOString(),
              );
          }
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAccount(
  request: AuthenticatedRequest,
  response: Response,
): AccountRecord | null {
  if (request.account) return request.account;
  response.status(401).json({ error: "AUTHENTICATION_REQUIRED" });
  return null;
}

export interface AdminActor {
  readonly actorId: string;
  readonly kind: "account" | "token";
}

/**
 * Operations APIs accept an administrator session or, for automation, the
 * operator bearer token. The audit actor is always derived server-side.
 */
export function requireAdmin(
  request: AuthenticatedRequest,
  response: Response,
  adminToken: string | null,
): AdminActor | null {
  if (request.account?.role === "admin")
    return { actorId: request.account.accountId, kind: "account" };
  const header = request.header("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (adminToken && bearer && safeEqual(digest(bearer), digest(adminToken)))
    return { actorId: "ops-token", kind: "token" };
  response
    .status(request.account || bearer ? 403 : 401)
    .json({ error: "ADMIN_SCOPE_REQUIRED" });
  return null;
}
