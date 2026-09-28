/**
 * Browser smoke for the M7 player journey. Two isolated browser contexts
 * register, onboard, save a deck, play a friend match through /join/CODE,
 * reload mid-match (automatic reconnect), concede, then check history, the
 * verified replay, crafting, and the operator dashboard.
 *
 * Needs the web app (CARDFORGE_WEB_URL, default http://localhost:3000) and a
 * match server started with CARDFORGE_ADMIN_EMAILS=smoke-ops@smoke.test.
 */
import { Browser, check, delay, type Page } from "./cdp.ts";

const web = (process.env.CARDFORGE_WEB_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const run = Date.now().toString(36);
const browser = await Browser.launch();
const log = (step: string, detail: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ smoke: "player-browser", step, ...detail }));

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

try {
  // --- New player: onboarding with the Field Guide -----------------------
  const host = await register(
    "Smoke Host",
    `host-${run}@smoke.test`,
    "leader.ember",
  );
  await host.clickText("button", "Start the Field Guide");
  for (let lesson = 0; lesson < 4; lesson += 1) {
    await host.click('.field-guide button[data-correct="true"]');
    await host.click(".field-guide__next");
    await delay(150);
  }
  await host.waitFor("location.search.includes('step=practice')");
  await host.clickText("button", "Go to Play");
  await host.waitFor("location.pathname === '/play'");
  log("onboarding");

  // --- Deckbuilder: save a copy of the starter ----------------------------
  await host.goto(`${web}/decks/starter-ember`);
  await host.waitForSelector(
    '.builder[data-deck-size="40"][data-legal="true"]',
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
  await ops.fill('input[autocomplete="nickname"]', "Smoke Ops");
  await ops.fill('input[type="email"]', "smoke-ops@smoke.test");
  await ops.fill('input[type="password"]', "browser-smoke-password");
  await fillSignupCode(ops);
  await ops.click('button[type="submit"]');
  await delay(800);
  if ((await ops.url()).includes("/login")) {
    // The operator account exists from an earlier run; sign in instead.
    await ops.clickText('[role="tab"]', "Sign in");
    await ops.fill('input[type="email"]', "smoke-ops@smoke.test");
    await ops.fill('input[type="password"]', "browser-smoke-password");
    await ops.click('button[type="submit"]');
  }
  await delay(800);
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
