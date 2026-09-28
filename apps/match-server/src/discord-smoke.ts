/**
 * Discord OAuth smoke against a local stub of Discord's token and profile
 * endpoints. Start the server with:
 *   DISCORD_CLIENT_ID=stub DISCORD_CLIENT_SECRET=stub
 *   CARDFORGE_DISCORD_API_BASE=http://127.0.0.1:2599/api
 */
import { createServer } from "node:http";
import { assert, endpoint } from "./smoke-kit.js";

const discordId = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
const stub = createServer((request, response) => {
  if (request.url === "/api/oauth2/token" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const params = new URLSearchParams(body);
      const ok = params.get("code") === "good-code" && params.get("client_secret") === "stub";
      response.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
      response.end(JSON.stringify(ok ? { access_token: "stub-access" } : { error: "invalid_grant" }));
    });
    return;
  }
  if (request.url === "/api/users/@me" && request.headers.authorization === "Bearer stub-access") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: discordId, username: "stubuser", global_name: "Stub Hero" }));
    return;
  }
  response.writeHead(404).end();
});
await new Promise<void>((resolve) => stub.listen(2599, "127.0.0.1", resolve));

async function start(): Promise<{ state: string; cookie: string }> {
  const response = await fetch(`${endpoint}/api/auth/discord/start?next=/decks`, { redirect: "manual" });
  assert(response.status === 302, "start redirects to Discord");
  const location = new URL(response.headers.get("location")!);
  assert(location.searchParams.get("scope") === "identify", "only the identify scope is requested");
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("cardforge_oauth="))!.split(";")[0]!;
  return { state: location.searchParams.get("state")!, cookie };
}

async function callback(query: string, cookie: string) {
  const response = await fetch(`${endpoint}/api/auth/discord/callback?${query}`, {
    headers: { cookie },
    redirect: "manual",
  });
  const session = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("cardforge_session=") && !value.startsWith("cardforge_session=;"));
  return { location: response.headers.get("location") ?? "", session: session?.split(";")[0] };
}

const mismatch = await start();
const forged = await callback(`code=good-code&state=not-the-state`, mismatch.cookie);
assert(forged.location.includes("error=oauth_state_mismatch") && !forged.session, "state mismatch is refused");

const first = await start();
const login = await callback(`code=good-code&state=${first.state}`, first.cookie);
assert(login.session, "a session cookie is issued");
assert(login.location.endsWith("/onboarding"), "new Discord players go to onboarding");
const me = await fetch(`${endpoint}/api/me`, { headers: { cookie: login.session } });
const body = (await me.json()) as { account: { displayName: string; accountId: string } };
assert(me.ok && body.account.displayName === "Stub Hero", "account uses the Discord display name");

const again = await start();
const second = await callback(`code=good-code&state=${again.state}`, again.cookie);
const meAgain = (await (await fetch(`${endpoint}/api/me`, { headers: { cookie: second.session! } })).json()) as typeof body;
assert(meAgain.account.accountId === body.account.accountId, "the same Discord identity maps to one account");

stub.close();
console.log(JSON.stringify({ smoke: "discord", accountId: body.account.accountId, ok: true }));
process.exit(0);
