/**
 * Browser smoke for the M7 player journey. Two isolated browser contexts
 * register, onboard, save a deck, play a friend match through /join/CODE,
 * reload mid-match (automatic reconnect), concede, then check history, the
 * verified replay, crafting, and the operator dashboard.
 *
 * Needs the web app (CARDFORGE_WEB_URL, default http://localhost:3000) and a
 * match server (CARDFORGE_SERVER_URL, default http://localhost:2567) started
 * with CARDFORGE_ADMIN_TOKEN, which the smoke uses to promote its operator.
 */
import { Browser, check, delay, type Page } from "./cdp.ts";

const web = (process.env.CARDFORGE_WEB_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const server = (
  process.env.CARDFORGE_SERVER_URL ?? "http://localhost:2567"
).replace(/\/$/, "");
const run = Date.now().toString(36);
const browser = await Browser.launch();
const log = (step: string, detail: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ smoke: "player-browser", step, ...detail }));

/**
 * Waits until React owns the auth form: submit stays disabled until then, and
 * typing earlier would be reset by hydration of the controlled inputs.
 */
async function waitForAuthForm(page: Page): Promise<void> {
  await page.waitFor(
    "document.querySelector('button[type=\"submit\"]')?.disabled === false",
  );
}

/** Invite-only deployments need a signup code on the register form. */
async function fillSignupCode(page: Page): Promise<void> {
  const code = process.env.CARDFORGE_SMOKE_SIGNUP_CODE;
  if (!code) return;
  await page.waitForSelector('input[name="signupCode"]');
  await page.fill('input[name="signupCode"]', code);
}

async function register(
  name: string,
  email: string,
  leader: string,
): Promise<Page> {
  const page = await browser.newPage(`${web}/login?mode=register`);
  await waitForAuthForm(page);
  await page.fill('input[autocomplete="nickname"]', name);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "browser-smoke-password");
  await fillSignupCode(page);
  await page.click('button[type="submit"]');
  await page.waitFor("location.pathname === '/onboarding'");
  await page.click(`[data-leader="${leader}"]`);
  await page.clickText("button", "Take this deck");
  await page.waitFor(
    "document.querySelector('[data-onboarding-step=\"learn\"]')",
  );
  return page;
}

/** Operators are promoted out of band, never by registration email. */
async function promoteOperator(email: string): Promise<void> {
  const token = process.env.CARDFORGE_ADMIN_TOKEN;
  check(token, "set CARDFORGE_ADMIN_TOKEN to promote the smoke operator");
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const lookup = await fetch(
    `${server}/api/admin/accounts?q=${encodeURIComponent(email)}`,
    { headers },
  );
  check(lookup.ok, `operator account lookup (${lookup.status})`);
  const { account } = (await lookup.json()) as {
    account: { accountId: string };
  };
  const promoted = await fetch(
    `${server}/api/admin/accounts/${account.accountId}/role`,
    { method: "POST", headers, body: JSON.stringify({ role: "admin" }) },
  );
  check(promoted.ok, `operator promotion (${promoted.status})`);
}

try {
  // --- New player: onboarding with the Field Guide -----------------------
  const host = await register(
    "Smoke Host",
    `host-${run}@smoke.test`,
    "leader.ember",
  );
  await host.clickText("button", "Start the tutorial");
  for (let lesson = 0; lesson < 4; lesson += 1) {
    await host.click('.field-guide button[data-correct="true"]');
    await host.click(".field-guide__next");
    await delay(150);
  }
  await host.waitFor("location.search.includes('step=practice')");
  await host.clickText("button", "Go to Play");
  await host.waitFor("location.pathname === '/play'");
  log("onboarding");

  // --- Generated card art ---------------------------------------------------
  for (const theme of ["aetherfront", "orbital-conflict"]) {
    const art = await fetch(`${web}/art/${theme}/leader.ember.svg`);
    check(
      art.ok &&
        art.headers.get("content-type")?.startsWith("image/svg+xml") &&
        (await art.text()).startsWith("<svg"),
      `generated art is served for ${theme}`,
    );
  }
  check(
    (await fetch(`${web}/art/aetherfront/not-a-card.svg`)).status === 404,
    "unknown cards have no art",
  );

  // --- Deckbuilder: save a copy of the starter ----------------------------
  await host.goto(`${web}/decks/starter-ember`);
  await host.waitForSelector(
    '.builder[data-deck-size="40"][data-legal="true"]',
  );
  check(
    (
      await host.evaluate<string>(
        `getComputedStyle(document.querySelector('.card-face__art')).backgroundImage`,
      )
    ).includes("/art/"),
    "card faces show illustrations",
  );
  await host.evaluate(
    `document.querySelector('[aria-label="Remove one Linebreaker"]').click()`,
  );
  await host.waitForSelector('.builder[data-deck-size="39"]');
  check(
    (await host.text(".legality")).includes("40"),
    "legality explains the 40-card rule",
  );
  await host.evaluate(
    `document.querySelector('[aria-label="Add one Linebreaker"]').click()`,
  );
  await host.waitForSelector(
    '.builder[data-deck-size="40"][data-legal="true"]',
  );
  await host.clickText("button", "Save deck");
  await host.waitFor("document.body.textContent.includes('ready to play')");
  log("deckbuilder");

  // --- Friend invite through /join/CODE -------------------------------------
  const guest = await register(
    "Smoke Guest",
    `guest-${run}@smoke.test`,
    "leader.citadel",
  );
  await guest.clickText("button", "Skip the introduction");
  await guest.waitFor("location.pathname === '/play'");
  await host.goto(`${web}/play`);
  await host.click('[data-mode="friend"]');
  await host.clickText("button", "Create invite code");
  await host.waitForSelector(".invite-box");
  const code = await host.attribute(".invite-box", "data-invite");
  check(code && /^[A-Z2-9]{6}$/.test(code), "invite code is shown");
  await host.click('[data-start-mode="friend"]');
  await host.waitForSelector('.search-screen[data-phase="searching"]');
  await guest.goto(`${web}/join/${code}`);
  await guest.waitForSelector(".join-page");
  await guest.clickText("button", "Accept and join");
  await Promise.all([
    host.waitForSelector(".match-table"),
    guest.waitForSelector(".match-table"),
  ]);
  const hostSeat = await host.attribute(".match-table", "data-seat");
  const guestSeat = await guest.attribute(".match-table", "data-seat");
  check(
    hostSeat && guestSeat && hostSeat !== guestSeat,
    "players hold different seats",
  );
  log("friend-match", { code });

  // --- Mulligan, reload (reconnect), concede --------------------------------
  for (const page of [host, guest]) {
    await page.waitFor(
      "document.querySelector('.match-table')?.dataset.priority === 'mulligan'",
    );
    await page.clickText(".prompt-bar button", "Keep hand");
  }
  for (const page of [host, guest])
    await page.waitFor(
      "Number(document.querySelector('.match-table').dataset.command) >= 2",
    );
  const before = await guest.attribute(".match-table", "data-command");
  await guest.send("Page.reload");
  await guest.waitFor(
    `document.querySelector('.match-table')?.dataset.command === ${JSON.stringify(before)}`,
  );
  log("reconnect", { command: before });
  await host.clickText("button", "Concede");
  await host.clickText(".modal button", "Concede");
  await Promise.all([
    host.waitForSelector('.result-card[data-result="defeat"]'),
    guest.waitForSelector('.result-card[data-result="victory"]'),
  ]);
  log("concession");

  // --- History and verified replay --------------------------------------------
  await guest.goto(`${web}/history`);
  await guest.waitForSelector(".match-row.is-win");
  await guest.click(".match-row.is-win a");
  await guest.waitForSelector('.replay-page[data-verified="true"]');
  await guest.click('[aria-label="Last command"]');
  await guest.waitFor(
    "Number(document.querySelector('.replay-page').dataset.frame) >= 2",
  );
  log("replay");

  // --- Crafting ----------------------------------------------------------------
  await guest.goto(`${web}/collection`);
  await guest.fill('input[aria-label="Search"]', "Linebreaker");
  await guest.click('[data-card="entity.linebreaker"]');
  await guest.clickText(".collection-detail button", "Craft 1");
  await guest.clickText(".modal button", "Confirm craft");
  await guest.waitFor(
    "document.body.textContent.includes('Crafted 1× Linebreaker')",
  );
  log("crafting");

  // --- Operator dashboard ---------------------------------------------------------
  const ops = await browser.newPage(`${web}/login?mode=register`);
  await waitForAuthForm(ops);
  await ops.fill('input[autocomplete="nickname"]', "Smoke Ops");
  await ops.fill('input[type="email"]', "smoke-ops@smoke.test");
  await ops.fill('input[type="password"]', "browser-smoke-password");
  await fillSignupCode(ops);
  await ops.click('button[type="submit"]');
  // Registered (left /login) or already exists from an earlier run (error).
  await ops.waitFor(
    "location.pathname !== '/login' || document.querySelector('.form-error')",
  );
  if ((await ops.url()).includes("/login")) {
    await ops.clickText('[role="tab"]', "Sign in");
    await ops.fill('input[type="email"]', "smoke-ops@smoke.test");
    await ops.fill('input[type="password"]', "browser-smoke-password");
    await ops.click('button[type="submit"]');
    await ops.waitFor("location.pathname !== '/login'");
  }
  await promoteOperator("smoke-ops@smoke.test");
  await ops.goto(`${web}/operations`);
  await ops.waitForSelector(".telemetry-grid");
  check(
    (await ops.text(".telemetry")).includes("First session funnel"),
    "playtest dashboard renders",
  );
  log("operations");

  const errors = [host, guest, ops].flatMap((page) => page.errors);
  check(errors.length === 0, `no uncaught page errors (${errors.join(" | ")})`);
  log("complete", { ok: true });
} finally {
  await browser.close();
}
