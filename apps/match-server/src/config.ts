import { randomBytes } from "node:crypto";

/**
 * Runtime configuration read once at startup. Production refuses to boot with
 * unsafe defaults rather than silently weakening authentication.
 */
export interface ServerConfig {
  readonly production: boolean;
  readonly port: number;
  readonly databaseUrl: string | null;
  readonly allowedOrigins: ReadonlySet<string>;
  /** Public browser URL of the web client, used for OAuth redirects. */
  readonly webUrl: string;
  /** Public URL of this API, used to build the OAuth callback. */
  readonly publicUrl: string;
  readonly sessionSecret: Buffer;
  readonly sessionTtlMs: number;
  readonly cookieSecure: boolean;
  readonly cookieDomain: string | null;
  readonly signupMode: "open" | "invite";
  readonly signupCodes: ReadonlySet<string>;
  readonly adminEmails: ReadonlySet<string>;
  readonly adminToken: string | null;
  readonly adminDiscordIds: ReadonlySet<string>;
  readonly discord: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly apiBase: string;
    readonly authorizeUrl: string;
  } | null;
  readonly actionClockMs: number;
  readonly trustProxy: number;
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid CardForge configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === "production";
  const problems: string[] = [];
  const origins = list(env.CARDFORGE_ALLOWED_ORIGINS);
  const allowedOrigins = origins.length
    ? origins
    : production
      ? []
      : ["http://localhost:3000", "http://127.0.0.1:3000"];
  if (production && !allowedOrigins.length)
    problems.push("CARDFORGE_ALLOWED_ORIGINS is required in production");
  for (const origin of allowedOrigins)
    if (!/^https?:\/\/[^/]+$/.test(origin))
      problems.push(`Allowed origin must be scheme://host[:port]: ${origin}`);

  const secret = env.CARDFORGE_SESSION_SECRET ?? "";
  if (production && secret.length < 32)
    problems.push("CARDFORGE_SESSION_SECRET must be at least 32 characters");
  const adminToken = env.CARDFORGE_ADMIN_TOKEN?.trim() || null;
  if (adminToken && adminToken.length < 32)
    problems.push("CARDFORGE_ADMIN_TOKEN must be at least 32 characters");
  if (production && !env.DATABASE_URL)
    problems.push("DATABASE_URL is required in production");

  const signupMode = env.CARDFORGE_SIGNUP_MODE === "invite" ? "invite" : "open";
  const signupCodes = list(env.CARDFORGE_SIGNUP_CODES);
  if (signupMode === "invite" && !signupCodes.length)
    problems.push(
      "CARDFORGE_SIGNUP_MODE=invite requires CARDFORGE_SIGNUP_CODES",
    );

  const discordId = env.DISCORD_CLIENT_ID?.trim();
  const discordSecret = env.DISCORD_CLIENT_SECRET?.trim();
  if (Boolean(discordId) !== Boolean(discordSecret))
    problems.push(
      "DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must be set together",
    );

  if (problems.length) throw new ConfigError(problems);
  const port = integer(env.PORT, 2567);
  return {
    production,
    port,
    databaseUrl: env.DATABASE_URL ?? null,
    allowedOrigins: new Set(allowedOrigins),
    webUrl: (
      env.CARDFORGE_WEB_URL ??
      allowedOrigins[0] ??
      "http://localhost:3000"
    ).replace(/\/$/, ""),
    publicUrl: (env.CARDFORGE_PUBLIC_URL ?? `http://localhost:${port}`).replace(
      /\/$/,
      "",
    ),
    sessionSecret:
      secret.length >= 32 ? Buffer.from(secret, "utf8") : randomBytes(32),
    sessionTtlMs: integer(env.CARDFORGE_SESSION_TTL_DAYS, 30) * 86_400_000,
    cookieSecure:
      env.CARDFORGE_COOKIE_SECURE === undefined
        ? production
        : env.CARDFORGE_COOKIE_SECURE === "true",
    cookieDomain: env.CARDFORGE_COOKIE_DOMAIN?.trim() || null,
    signupMode,
    signupCodes: new Set(signupCodes),
    adminEmails: new Set(
      list(env.CARDFORGE_ADMIN_EMAILS).map((email) => email.toLowerCase()),
    ),
    adminToken,
    adminDiscordIds: new Set(list(env.CARDFORGE_ADMIN_DISCORD_IDS)),
    discord:
      discordId && discordSecret
        ? {
            clientId: discordId,
            clientSecret: discordSecret,
            // Overridable only so integration tests can use a local stub.
            apiBase: (
              env.CARDFORGE_DISCORD_API_BASE ?? "https://discord.com/api"
            ).replace(/\/$/, ""),
            authorizeUrl:
              env.CARDFORGE_DISCORD_AUTHORIZE_URL ??
              "https://discord.com/oauth2/authorize",
          }
        : null,
    actionClockMs: integer(env.CARDFORGE_ACTION_CLOCK_MS, 30_000),
    trustProxy:
      env.CARDFORGE_TRUST_PROXY === "0"
        ? 0
        : integer(env.CARDFORGE_TRUST_PROXY, production ? 1 : 0),
  };
}

export const config = loadConfig();
