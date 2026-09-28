/**
 * Post-deploy checks for a live CardForge stack. Read-only unless
 * CARDFORGE_SMOKE_SIGNUP_CODE is set (or signup is open), in which case it
 * registers one throwaway account to inspect the session cookie.
 *
 *   node scripts/verify-deployment.ts https://play.example.com https://api.example.com
 *
 * Exits non-zero when any check fails; warnings do not fail the run.
 */
const [webArg, apiArg] = process.argv.slice(2);
if (!webArg || !apiArg) {
  console.error("usage: node scripts/verify-deployment.ts <web-url> <api-url>");
  process.exit(2);
}
const web = new URL(webArg).origin;
const api = new URL(apiArg).origin;

type Level = "ok" | "warn" | "fail";
const results: { level: Level; check: string; detail: string }[] = [];
const record = (level: Level, check: string, detail = "") => {
  results.push({ level, check, detail });
  const mark = level === "ok" ? "PASS" : level === "warn" ? "WARN" : "FAIL";
  console.log(`${mark}  ${check}${detail ? ` — ${detail}` : ""}`);
};
const expect = (condition: boolean, check: string, detail = "") =>
  record(condition ? "ok" : "fail", check, detail);

async function probe(
  url: string,
  init: RequestInit = {},
): Promise<Response | null> {
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      ...init,
    });
  } catch (error) {
    record("fail", `reach ${url}`, String((error as Error).message));
    return null;
  }
}

/** Registrable-domain approximation: the last two labels. */
const site = (origin: string) =>
  new URL(origin).hostname.split(".").slice(-2).join(".");
const publicSuffixHosts = ["sslip.io", "nip.io", "traefik.me"];

// --- Topology -----------------------------------------------------------
expect(web.startsWith("https://"), "web URL uses HTTPS", web);
expect(api.startsWith("https://"), "API URL uses HTTPS", api);
if (publicSuffixHosts.includes(site(web)) || site(web) !== site(api))
  record(
    "fail",
    "web and API share a registrable domain",
    `${site(web)} vs ${site(api)}; the session cookie would be third-party`,
  );
else record("ok", "web and API share a registrable domain", site(web));

// --- Match server -------------------------------------------------------
const health = await probe(`${api}/health`);
if (health) {
  const body = (await health.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  expect(health.ok, "API /health", JSON.stringify(body));
  if (body.commit === "unknown" || body.commit === undefined)
    record("warn", "build reports its commit", "commit is unknown");
}
const ready = await probe(`${api}/ready`);
if (ready)
  expect(
    ready.status === 200,
    "API /ready (migrations applied, database reachable)",
    `${ready.status} ${await ready.text()}`,
  );
const metrics = await probe(`${api}/metrics`);
if (metrics)
  expect(!metrics.ok, "/metrics is not public", `status ${metrics.status}`);

const providers = await probe(`${api}/api/auth/providers`, {
  headers: { origin: web },
});
let signupMode = "unknown";
if (providers?.ok) {
  const body = (await providers.json()) as {
    discord: boolean;
    signupMode: string;
  };
  signupMode = body.signupMode;
  record("ok", "auth providers", JSON.stringify(body));
  if (signupMode !== "invite")
    record("warn", "signup mode", "open signup; anyone can register");
  const allowed = providers.headers.get("access-control-allow-origin");
  expect(
    allowed === web &&
      providers.headers.get("access-control-allow-credentials") === "true",
    "CORS allows the web origin with credentials",
    `allow-origin: ${allowed}`,
  );
}
for (const foreign of ["https://evil.example", "null"]) {
  const response = await probe(`${api}/api/auth/providers`, {
    headers: { origin: foreign },
  });
  if (response)
    expect(
      !response.headers.get("access-control-allow-origin"),
      `CORS refuses origin ${foreign}`,
    );
}
const csrf = await probe(`${api}/api/auth/login`, {
  method: "POST",
  headers: {
    origin: "https://evil.example",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    email: "nobody@example.com",
    password: "x".repeat(12),
  }),
});
if (csrf)
  expect(
    csrf.status === 403,
    "mutating requests from foreign origins are refused",
    `status ${csrf.status}`,
  );

// --- Session cookie (creates one account) -------------------------------
const code = process.env.CARDFORGE_SMOKE_SIGNUP_CODE;
if (signupMode === "open" || code) {
  const stamp = Date.now().toString(36);
  const register = await probe(`${api}/api/auth/register`, {
    method: "POST",
    headers: { origin: web, "content-type": "application/json" },
    body: JSON.stringify({
      email: `deploy-check-${stamp}@example.invalid`,
      password: `deploy-check-${stamp}-pw`,
      displayName: `Deploy check ${stamp}`,
      ...(code ? { signupCode: code } : {}),
    }),
  });
  if (register) {
    expect(
      register.status === 201,
      "registration works",
      `status ${register.status}`,
    );
    const cookie = register.headers.get("set-cookie") ?? "";
    expect(/HttpOnly/i.test(cookie), "session cookie is HttpOnly");
    expect(/;\s*Secure/i.test(cookie), "session cookie is Secure");
    expect(/SameSite=Lax/i.test(cookie), "session cookie is SameSite=Lax");
  }
} else
  record(
    "warn",
    "session cookie flags",
    "skipped; set CARDFORGE_SMOKE_SIGNUP_CODE to register one test account",
  );

// --- Web ----------------------------------------------------------------
const healthz = await probe(`${web}/healthz`);
if (healthz) expect(healthz.ok, "web /healthz", `status ${healthz.status}`);
const home = await probe(`${web}/login`);
if (home) {
  expect(home.ok, "web /login renders", `status ${home.status}`);
  for (const [header, value] of [
    ["x-frame-options", "DENY"],
    ["x-content-type-options", "nosniff"],
  ] as const)
    expect(
      home.headers.get(header)?.toUpperCase() === value.toUpperCase(),
      `web sends ${header}`,
    );
  const html = await home.text();
  expect(
    html.includes(api),
    "web is configured with this API URL",
    html.includes(api) ? api : "CARDFORGE_PUBLIC_API_URL does not match",
  );
}

const failed = results.filter((result) => result.level === "fail").length;
const warned = results.filter((result) => result.level === "warn").length;
console.log(
  `\n${results.length - failed - warned} passed, ${warned} warnings, ${failed} failed`,
);
process.exit(failed ? 1 : 0);
