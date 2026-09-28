import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  hashPassword,
  issueMatchTicket,
  parseCookies,
  serializeCookie,
  signPayload,
  verifyMatchTicket,
  verifyPassword,
  verifyPayload,
} from "./auth.js";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { participantStats, emptyActivity } from "./match-stats.js";
import { cautionFor, playtestOverview, rate } from "./playtest-telemetry.js";
import { RateLimiter } from "./rate-limit.js";
import { reconstructReplay } from "./replay-frames.js";
import { AuthoritativeMatchSession } from "./session.js";
import { chooseTrainingBotCommand } from "./training-room.js";
import { intentFromCommand } from "./intents.js";
import { safeNextPath } from "./http/auth-routes.js";
import { generateInviteCode } from "./http/player-routes.js";

/** Plays a complete deterministic match through the authoritative session. */
function completedSession(seed = 91): AuthoritativeMatchSession {
  const session = new AuthoritativeMatchSession({ matchId: `m7-${seed}`, seed });
  session.join("alpha");
  session.join("bravo");
  for (let step = 0; step < 2_000 && !session.state.winner; step += 1) {
    const seat = session.activePlayers()[0];
    if (!seat) break;
    const command = chooseTrainingBotCommand(
      session.engine.getLegalCommands(session.state, seat),
    );
    if (!command) break;
    session.submitForPlayer(seat, intentFromCommand(command));
  }
  return session;
}

void describe("M7 authentication primitives", () => {
  void it("hashes passwords with scrypt and rejects wrong passwords", async () => {
    const hash = await hashPassword("correct horse battery");
    assert.match(hash, /^scrypt\$16384\$8\$1\$/);
    assert.equal(await verifyPassword("correct horse battery", hash), true);
    assert.equal(await verifyPassword("correct horse batterx", hash), false);
    assert.equal(await verifyPassword("anything", "plaintext"), false);
    assert.notEqual(await hashPassword("same"), await hashPassword("same"));
  });

  void it("issues match tickets that cannot be forged, reused for another purpose, or kept", () => {
    const secret = randomBytes(32);
    const ticket = issueMatchTicket(secret, "acct-one", 1_000);
    assert.equal(verifyMatchTicket(secret, ticket, 2_000), "acct-one");
    assert.equal(verifyMatchTicket(secret, ticket, 1_000 + 5 * 60_000), null, "expired");
    assert.equal(verifyMatchTicket(randomBytes(32), ticket, 2_000), null, "wrong key");
    const [body, signature] = ticket.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ sub: "acct-two", pur: "match", exp: 9_999_999_999_999 }),
    ).toString("base64url");
    assert.equal(verifyMatchTicket(secret, `${forgedBody}.${signature}`, 2_000), null);
    assert.equal(verifyMatchTicket(secret, `${body}.${signature}.x`, 2_000), null);
    const oauth = signPayload(secret, "oauth", { sub: "acct-one" }, 60_000, 1_000);
    assert.equal(verifyMatchTicket(secret, oauth, 2_000), null, "purpose-bound");
    assert.equal(verifyPayload(secret, "oauth", oauth, 2_000)?.sub, "acct-one");
  });

  void it("serialises HttpOnly SameSite cookies and parses headers defensively", () => {
    const cookie = serializeCookie("cardforge_session", "abc", { secure: true, domain: null }, 60);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/);
    assert.equal(parseCookies("a=1; cardforge_session=abc; bad=%E0%A4%A").get("cardforge_session"), "abc");
  });

  void it("only accepts relative post-login destinations", () => {
    assert.equal(safeNextPath("/decks"), "/decks");
    assert.equal(safeNextPath("/join/ABC234"), "/join/ABC234");
    assert.equal(safeNextPath("//evil.example"), null);
    assert.equal(safeNextPath("https://evil.example"), null);
    assert.equal(safeNextPath("/\\evil"), null);
  });

  void it("refuses unsafe production configuration", () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: "production" }),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.problems.some((problem) => problem.includes("SESSION_SECRET")) &&
        error.problems.some((problem) => problem.includes("DATABASE_URL")),
    );
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://db/cardforge",
      CARDFORGE_SESSION_SECRET: "x".repeat(40),
      CARDFORGE_ALLOWED_ORIGINS: "https://play.example.com",
    });
    assert.equal(config.cookieSecure, true);
    assert.equal(config.trustProxy, 1);
    assert.equal(config.webUrl, "https://play.example.com");
  });

  void it("rate limits within a window and resets afterwards", () => {
    const limiter = new RateLimiter(2, 1_000);
    assert.equal(limiter.take("ip", 0), true);
    assert.equal(limiter.take("ip", 10), true);
    assert.equal(limiter.take("ip", 20), false);
    assert.equal(limiter.take("ip", 1_001), true);
  });

  void it("generates unambiguous invite codes", () => {
    for (let index = 0; index < 200; index += 1)
      assert.match(generateInviteCode(), /^[A-HJ-NP-Z2-9]{6}$/);
  });

  void it("redacts credentials from structured logs", () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (line) => lines.push(line) });
    log.info("login", { password: "hunter2", nested: { sessionToken: "abc", ok: 1 } });
    log.critical("replay mismatch", { matchId: "m1" });
    const [first, second] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(first!.password, "[redacted]");
    assert.deepEqual(first!.nested, { sessionToken: "[redacted]", ok: 1 });
    assert.equal(second!.alert, true);
    assert.doesNotMatch(lines.join("\n"), /hunter2/);
  });
});

void describe("M7 replay reconstruction", () => {
  const session = completedSession();
  const replay = session.replay();

  void it("rebuilds and verifies a completed match frame by frame", () => {
    assert.ok(session.state.winner, "fixture reaches a winner");
    const result = reconstructReplay(replay, "p1");
    assert.equal(result.verified, true);
    assert.equal(result.frames.length, replay.acceptedCommands.length + 1);
    assert.equal(result.frames.at(-1)!.hash, replay.finalStateHash);
    assert.equal(result.frames[0]!.command, null);
    assert.ok(result.frames.at(-1)!.view.winner);
  });

  void it("hides both hands in the public perspective and the rival hand in a seat view", () => {
    const publicView = reconstructReplay(replay, "public").frames[1]!.view;
    assert.equal(publicView.players.p1.hand, undefined);
    assert.equal(publicView.players.p2.hand, undefined);
    const seatView = reconstructReplay(replay, "p1").frames[1]!.view;
    assert.ok(seatView.players.p1.hand);
    assert.equal(seatView.players.p2.hand, undefined);
    const rivalMulligan = reconstructReplay(replay, "p1").frames.find(
      (frame) => frame.command?.type === "mulligan" && frame.command.playerId === "p2",
    );
    assert.deepEqual(Object.keys(rivalMulligan!.command!).sort(), ["count", "playerId", "redacted", "type"]);
  });

  void it("flags a tampered replay instead of trusting it", () => {
    const tampered = { ...replay, finalStateHash: "sha256:tampered" };
    const result = reconstructReplay(tampered, "public");
    assert.equal(result.verified, false);
    assert.match(result.error ?? "", /hash/);
    const truncated = { ...replay, acceptedCommands: replay.acceptedCommands.slice(0, -1) };
    assert.equal(reconstructReplay(truncated, "public").verified, false);
    const corrupt = { ...replay, contentHash: "sha256:other" };
    assert.equal(reconstructReplay(corrupt, "public").verified, false);
  });

  void it("derives per-seat statistics from the replay", () => {
    const stats = participantStats(replay, { p1: emptyActivity(), p2: emptyActivity() });
    const winner = session.state.winner!;
    assert.equal(stats[winner].dominion, session.state.players[winner].dominion);
    assert.ok(stats.p1.cardsDrawn >= 5);
    assert.equal(
      Object.values(stats.p1.cardIdsPlayed).reduce((a, b) => a + b, 0),
      stats.p1.cardsPlayed,
    );
  });
});

void describe("wire intent schema", () => {
  void it("accepts every command the engine reports as legal", async () => {
    const { commandFromIntent } = await import("./intents.js");
    const { prototypeDecks } = await import("@cardforge/rules-tempofront");
    const leaders = Object.keys(prototypeDecks) as (keyof typeof prototypeDecks)[];
    let checked = 0;
    for (let game = 0; game < leaders.length; game += 1) {
      const session = new AuthoritativeMatchSession({
        matchId: `wire-${game}`,
        seed: 500 + game,
        leaders: { p1: leaders[game]!, p2: leaders[(game + 5) % leaders.length]! },
      });
      for (let step = 0; step < 600 && !session.state.winner; step += 1) {
        const seat = session.activePlayers()[step % session.activePlayers().length];
        if (!seat) break;
        const legal = session.engine.getLegalCommands(session.state, seat);
        for (const command of legal) {
          const intent = intentFromCommand(command);
          assert.deepEqual(commandFromIntent(seat, intent), command);
          checked += 1;
        }
        const choice = legal[(step * 7) % legal.length]!;
        session.submitForPlayer(seat, intentFromCommand(choice));
      }
    }
    assert.ok(checked > 1_000);
  });
});

void describe("M7 playtest telemetry", () => {
  void it("labels every rate with its sample size and caution", () => {
    assert.equal(cautionFor(5), "insufficient");
    assert.equal(cautionFor(50), "low");
    assert.equal(cautionFor(500), "adequate");
    assert.deepEqual(rate(0, 0), { value: null, numerator: 0, sample: 0, caution: "insufficient" });
    const overview = playtestOverview({
      matches: [],
      telemetry: [],
      events: [
        { eventId: "1", accountId: "a", name: "account_registered", properties: {}, createdAt: "" },
        { eventId: "2", accountId: "a", name: "tutorial_started", properties: {}, createdAt: "" },
      ],
      collectibleCardIds: ["entity.one"],
    });
    assert.equal(overview.onboarding.registered, 1);
    assert.equal(overview.onboarding.steps.find((step) => step.name === "tutorial_started")?.conversion.value, 1);
    assert.deepEqual(overview.cards.neverPlayed, [], "no conclusions without matches");
  });
});
