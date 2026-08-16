const endpoint = process.env.CARDFORGE_SERVER_URL ?? "http://127.0.0.1:2567";
const accountId = `operations-smoke-${process.pid}`;
const adminHeaders = {
  "content-type": "application/json",
  "x-cardforge-admin-token": "cardforge-local-admin",
  "x-cardforge-admin-actor": "operations-smoke",
};

await fetch(`${endpoint}/api/accounts/${accountId}`, {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    "x-cardforge-account-id": accountId,
  },
  body: JSON.stringify({ displayName: "Operations Smoke" }),
});
const caseId = `case:operations-smoke-${process.pid}`;
const supportResponse = await fetch(
  `${endpoint}/api/accounts/${accountId}/support-cases`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cardforge-account-id": accountId,
    },
    body: JSON.stringify({
      caseId,
      summary: "Verify operations smoke workflow",
    }),
  },
);
if (supportResponse.status !== 201)
  throw new Error(`Support creation failed: ${await supportResponse.text()}`);

let operationsResponse = await fetch(`${endpoint}/api/admin/operations`, {
  headers: adminHeaders,
});
if (!operationsResponse.ok) throw new Error("Admin operations are unavailable");
let operations = (await operationsResponse.json()) as {
  current: { revision: number; featureFlags: Record<string, boolean> };
  revisions: { configId: string; revision: number }[];
  cases: { caseId: string; status: string }[];
  audit: { action: string; targetId: string }[];
};
const launchRevisions = operations.revisions
  .filter((item) => item.configId === "liveops.launch-2026")
  .map((item) => item.revision);
const stageRevision =
  Math.max(operations.current.revision, ...launchRevisions) + 1;
const stageResponse = await fetch(`${endpoint}/api/admin/live-ops/stage`, {
  method: "POST",
  headers: adminHeaders,
  body: JSON.stringify({
    revision: stageRevision,
    featureFlags: { "event.clockwork-gauntlet": true },
  }),
});
if (stageResponse.status !== 201)
  throw new Error(`Live-ops stage failed: ${await stageResponse.text()}`);

const resolveResponse = await fetch(
  `${endpoint}/api/admin/support-cases/${caseId}`,
  {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      status: "resolved",
      note: "Resolved by automated operations smoke.",
    }),
  },
);
if (!resolveResponse.ok)
  throw new Error(`Support resolution failed: ${await resolveResponse.text()}`);

const publishRevision = stageRevision + 1;
const publishResponse = await fetch(`${endpoint}/api/admin/live-ops/publish`, {
  method: "POST",
  headers: adminHeaders,
  body: JSON.stringify({
    sourceRevision: stageRevision,
    revision: publishRevision,
  }),
});
if (publishResponse.status !== 201)
  throw new Error(`Live-ops publish failed: ${await publishResponse.text()}`);

operationsResponse = await fetch(`${endpoint}/api/admin/operations`, {
  headers: adminHeaders,
});
operations = (await operationsResponse.json()) as typeof operations;
const supportCase = operations.cases.find((item) => item.caseId === caseId);
if (
  operations.current.revision !== publishRevision ||
  operations.current.featureFlags["event.clockwork-gauntlet"] !== true ||
  supportCase?.status !== "resolved" ||
  !operations.audit.some(
    (record) =>
      record.action === "support.update" && record.targetId === caseId,
  )
)
  throw new Error(
    `Operations result is invalid: ${JSON.stringify(operations)}`,
  );

console.log(
  JSON.stringify({
    stageRevision,
    publishRevision,
    supportCase: supportCase.caseId,
    auditRecords: operations.audit.length,
  }),
);
