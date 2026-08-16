import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthoritativeMatchSession, SessionError } from "./session.js";

function createSession(): AuthoritativeMatchSession {
  return new AuthoritativeMatchSession({ matchId: "room-test", seed: 7331 });
}

void describe("authoritative match session", () => {
  void it("assigns two stable seats and rejects a third connection", () => {
    const session = createSession();
    assert.equal(session.join("alpha"), "p1");
    assert.equal(session.join("bravo"), "p2");
    assert.equal(session.join("alpha"), "p1");
    assert.throws(
      () => session.join("charlie"),
      (error: unknown) =>
        error instanceof SessionError && error.code === "MATCH_FULL",
    );
  });

  void it("rejects forged player identity before it reaches the engine", () => {
    const session = createSession();
    session.join("alpha");
    assert.throws(
      () => session.submit("alpha", { type: "pass", playerId: "p2" }),
      (error: unknown) =>
        error instanceof SessionError && error.code === "INVALID_INTENT",
    );
    assert.equal(session.state.commandNumber, 0);
  });

  void it("rejects well-formed but illegal commands without mutating state", () => {
    const session = createSession();
    session.join("alpha");
    const before = session.snapshot("alpha").hash;
    assert.throws(
      () => session.submit("alpha", { type: "pass" }),
      (error: unknown) =>
        error instanceof SessionError && error.code === "ILLEGAL_COMMAND",
    );
    assert.equal(session.snapshot("alpha").hash, before);
    assert.equal(session.acceptedCommands.length, 0);
  });

  void it("projects private hands per seat and exactly replays accepted intents", () => {
    const session = createSession();
    session.join("alpha");
    session.join("bravo");
    const events = session.submit("alpha", {
      type: "mulligan",
      instanceIds: [],
    });
    const alpha = session.snapshot("alpha", events);
    const bravo = session.snapshot("bravo", events);
    assert.ok(alpha.legalIntents.every((intent) => !("playerId" in intent)));
    assert.equal(bravo.legalIntents[0]?.type, "mulligan");
    assert.equal(alpha.view.players.p1.hand?.length, 5);
    assert.equal(alpha.view.players.p2.hand, undefined);
    assert.equal(bravo.view.players.p2.hand?.length, 5);
    assert.equal(bravo.view.players.p1.hand, undefined);
    assert.equal(alpha.hash, bravo.hash);
    assert.equal(session.acceptedCommands.length, 1);
    assert.equal(session.verifyReplay(), true);
  });

  void it("turns a timeout into a deterministic legal fallback command", () => {
    const session = createSession();
    session.join("alpha");
    session.join("bravo");
    assert.deepEqual(session.activePlayers(), ["p1", "p2"]);
    session.submitTimeout("p1");
    assert.equal(session.acceptedCommands[0]?.type, "mulligan");
    assert.deepEqual(session.activePlayers(), ["p2"]);
    assert.equal(session.verifyReplay(), true);
  });
});
