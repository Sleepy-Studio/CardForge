/**
 * Operator role from a shell with database access (for example Coolify's
 * Terminal tab on the match-server container):
 *   node dist/admin-cli.js promote you@example.com
 *   node dist/admin-cli.js demote you@example.com
 * Accepts a sign-in email or an account ID. Every change is audited.
 */
import { randomUUID } from "node:crypto";
import { PostgresCardForgeStore } from "@cardforge/persistence";

const [command, target] = process.argv.slice(2);
if ((command !== "promote" && command !== "demote") || !target) {
  console.error(
    "usage: node dist/admin-cli.js promote|demote <email|accountId>",
  );
  process.exit(2);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const store = new PostgresCardForgeStore(databaseUrl);
try {
  const credential = target.includes("@")
    ? await store.getPasswordCredential(target.trim().toLowerCase())
    : null;
  const accountId = credential?.accountId ?? target;
  const role = command === "promote" ? "admin" : "player";
  const account = await store.updateAccountProfile(accountId, { role });
  if (!account) {
    console.error(`No account found for ${target}. Register it first.`);
    process.exitCode = 1;
  } else {
    await store.appendAudit({
      auditId: `audit:${randomUUID()}`,
      actorId: "admin-cli",
      action: "account.role",
      targetId: account.accountId,
      payload: { role },
    });
    console.log(
      `${account.displayName} (${account.accountId}) is now ${account.role}.`,
    );
  }
} finally {
  await store.close();
}
