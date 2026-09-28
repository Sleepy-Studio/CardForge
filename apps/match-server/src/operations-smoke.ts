/**
 * Operations smoke. Requires the server to run with CARDFORGE_ADMIN_TOKEN.
 */
import { SmokeAccount, assert, endpoint } from "./smoke-kit.js";

const token = process.env.CARDFORGE_ADMIN_TOKEN;
assert(
  token && token.length >= 32,
  "set CARDFORGE_ADMIN_TOKEN for the operations smoke",
);
const bearer = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
const adminFetch = async <T>(
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> => {
  const response = await fetch(`${endpoint}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: bearer,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as T };
};

const player = await new SmokeAccount("Support Seeker").register();
assert(
  (await player.api("/api/admin/operations")).status === 403,
  "players cannot reach operations APIs",
);
assert(
  (await fetch(`${endpoint}/api/admin/operations`)).status === 401,
  "anonymous operators are refused",
);
assert(
  (
    await fetch(`${endpoint}/api/admin/operations`, {
      headers: { authorization: "Bearer wrong-token-wrong-token-wrong-token" },
    })
  ).status === 403,
  "a wrong operator token is refused",
);

// Operator promotion: registration never grants admin; operators promote.
const candidate = await new SmokeAccount("Ops Candidate").register();
assert(
  (
    await player.api(`/api/admin/accounts/${candidate.accountId}/role`, {
      body: { role: "admin" },
    })
  ).status === 403,
  "players cannot promote accounts",
);
const promoted = await adminFetch<{ account: { role: string } }>(
  `/api/admin/accounts/${candidate.accountId}/role`,
  { role: "admin" },
);
assert(
  promoted.status === 200 && promoted.body.account.role === "admin",
  "operators can grant the admin role",
);
assert(
  (await candidate.api("/api/admin/operations")).status === 200,
  "a promoted account reaches operations APIs",
);
await adminFetch(`/api/admin/accounts/${candidate.accountId}/role`, {
  role: "player",
});
assert(
  (await candidate.api("/api/admin/operations")).status === 403,
  "a demoted account loses operations access",
);

const created = await player.api<{ case: { caseId: string } }>(
  "/api/me/support-cases",
  {
    body: { summary: "Verify operations smoke workflow" },
    expect: 201,
  },
);
const caseId = created.body.case.caseId;

type Operations = {
  current: { revision: number; featureFlags: Record<string, boolean> };
  revisions: { configId: string; revision: number }[];
  cases: { caseId: string; status: string }[];
  audit: { action: string; targetId: string; actorId: string }[];
};
let operations = (await adminFetch<Operations>("/api/admin/operations")).body;
assert(
  operations.current.revision >= 2,
  "the additive autumn live-ops revision is current",
);
const stageRevision =
  Math.max(...operations.revisions.map((item) => item.revision)) + 1;
const staged = await adminFetch("/api/admin/live-ops/stage", {
  revision: stageRevision,
  featureFlags: { "event.clockwork-gauntlet-2": false },
});
assert(
  staged.status === 201,
  `live-ops stage succeeded (${JSON.stringify(staged.body)})`,
);
const resolved = await adminFetch(
  `/api/admin/support-cases/${encodeURIComponent(caseId)}`,
  {
    status: "resolved",
    note: "Resolved by automated operations smoke.",
  },
);
assert(resolved.status === 200, "support case resolved");
const published = await adminFetch("/api/admin/live-ops/publish", {
  sourceRevision: stageRevision,
  revision: stageRevision + 1,
});
assert(published.status === 201, "live-ops publish succeeded");
operations = (await adminFetch<Operations>("/api/admin/operations")).body;
assert(
  operations.current.revision === stageRevision + 1,
  "published revision is current",
);
assert(
  operations.current.featureFlags["event.clockwork-gauntlet-2"] === false,
  "flag change applied",
);
const audit = operations.audit.find(
  (record) => record.action === "support.update" && record.targetId === caseId,
);
assert(audit?.actorId === "ops-token", "audit actor is derived server-side");

// Legacy claim: an operator issues a code; a player registers onto that account.
const legacy = await new SmokeAccount("Legacy").register();
const claim = await adminFetch<{ claimCode: string }>(
  `/api/admin/accounts/${legacy.accountId}/claim-code`,
  {},
);
assert(claim.status === 201, "claim code issued");
const claimant = new SmokeAccount("Claimant");
const claimed = await claimant.api("/api/auth/register", {
  body: {
    email: claimant.email,
    password: "claim-password-1",
    displayName: "Claimant",
    claimCode: claim.body.claimCode,
  },
});
assert(
  claimed.status === 400,
  "an account that already has credentials cannot be claimed",
);
const lookup = await adminFetch<{ account: { accountId: string } }>(
  `/api/admin/accounts?q=${encodeURIComponent(legacy.email)}`,
);
assert(
  lookup.body.account.accountId === legacy.accountId,
  "operators can find an account by email",
);
const reset = await new SmokeAccount("Reset").api("/api/auth/reset-password", {
  body: { code: claim.body.claimCode, password: "fresh-password-456" },
});
assert(reset.status === 200, "a support code resets the password");
const oldLogin = await new SmokeAccount("Old").api("/api/auth/login", {
  body: { email: legacy.email, password: "smoke-password-123" },
});
assert(oldLogin.status === 401, "the old password stops working");
const newLogin = await new SmokeAccount("New").api("/api/auth/login", {
  body: { email: legacy.email, password: "fresh-password-456" },
});
assert(newLogin.status === 200, "the new password works");
assert(
  (await legacy.api("/api/me")).status === 401,
  "existing sessions were revoked",
);
const reuse = await new SmokeAccount("Reuse").api("/api/auth/reset-password", {
  body: { code: claim.body.claimCode, password: "another-password-789" },
});
assert(reuse.status === 400, "reset codes are single use");

const playtest = await adminFetch<{
  overview: {
    matches: { completed: number };
    onboarding: { registered: number };
  };
}>("/api/admin/telemetry/playtest");
assert(
  playtest.status === 200 && playtest.body.overview.onboarding.registered >= 2,
  "playtest dashboard reports onboarding",
);
const metrics = await fetch(`${endpoint}/metrics`, {
  headers: { authorization: `Bearer ${token}` },
});
assert(
  metrics.ok &&
    (await metrics.text()).includes("cardforge_http_requests_total"),
  "metrics are exposed",
);
console.log(
  JSON.stringify({ smoke: "operations", stageRevision, caseId, ok: true }),
);
process.exit(0);
