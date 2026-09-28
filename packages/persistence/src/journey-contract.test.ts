import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { cosmeticCatalog } from "@cardforge/economy";
import { persistenceTestReplay } from "./fixtures.js";
import { MemoryCardForgeStore } from "./memory-store.js";
import { PostgresCardForgeStore } from "./postgres-store.js";
import {
  AuthStoreError,
  InviteError,
  type CardForgeStore,
  type ParticipantStats,
} from "./types.js";

const stats = (dominion: number, reactions: number): ParticipantStats => ({
  cardsPlayed: 4,
  cardIdsPlayed: { "entity.test": 4 },
  cardsDrawn: 9,
  mulliganCount: 1,
  reactions,
  choices: 0,
  dominion,
  integrity: 10,
  actions: 12,
  actionMsTotal: 42_000,
  disconnects: 0,
  reconnects: 0,
  timeouts: 0,
});

const adapters: [string, () => CardForgeStore][] = [
  ["memory", () => new MemoryCardForgeStore()],
];
const databaseUrl = process.env.CARDFORGE_TEST_DATABASE_URL;
if (databaseUrl)
  adapters.push(["postgres", () => new PostgresCardForgeStore(databaseUrl)]);

for (const [name, create] of adapters)
  void describe(`${name} store: M7 journey contract`, () => {
    const store = create();
    const run = randomUUID().slice(0, 8);
    const id = (label: string) => `${label}-${run}`;
    after(() => store.close());

    void it("migrates idempotently", async () => {
      await store.migrate();
      assert.deepEqual(await store.migrate(), []);
      await store.ping();
    });

    void it("registers, rejects duplicate email, and resolves sessions", async () => {
      const email = `${id("player")}@example.test`;
      const accountId = await store.registerPasswordAccount({
        accountId: id("acct-a"),
        displayName: "Player A",
        email,
        passwordHash: "scrypt$hash",
        role: "player",
      });
      assert.equal(accountId, id("acct-a"));
      await assert.rejects(
        store.registerPasswordAccount({
          accountId: id("acct-dupe"),
          displayName: "Dupe",
          email,
          passwordHash: "scrypt$hash",
          role: "player",
        }),
        (error: unknown) =>
          error instanceof AuthStoreError && error.code === "EMAIL_TAKEN",
      );
      assert.equal(
        (await store.getPasswordCredential(email))?.accountId,
        accountId,
      );
      const account = await store.getAccount(accountId);
      assert.equal(account?.role, "player");
      assert.equal(account?.starterLeaderId, null);

      const future = new Date(Date.now() + 60_000).toISOString();
      await store.createSession({
        tokenHash: id("session"),
        accountId,
        expiresAt: future,
      });
      assert.equal(
        (await store.getSession(id("session")))?.accountId,
        accountId,
      );
      await store.createSession({
        tokenHash: id("expired"),
        accountId,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      });
      assert.equal(await store.getSession(id("expired")), null);
      await store.deleteAccountSessions(accountId);
      assert.equal(await store.getSession(id("session")), null);
    });

    void it("lets a legacy account be claimed exactly once", async () => {
      await store.upsertAccount(id("legacy"), "Legacy Alpha");
      await store.createAccountClaim({
        codeHash: id("claim"),
        accountId: id("legacy"),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const claimed = await store.registerPasswordAccount({
        accountId: id("unused"),
        displayName: "ignored",
        email: `${id("legacy")}@example.test`,
        passwordHash: "scrypt$hash",
        role: "player",
        claimCodeHash: id("claim"),
      });
      assert.equal(claimed, id("legacy"));
      await assert.rejects(
        store.registerPasswordAccount({
          accountId: id("unused-2"),
          displayName: "again",
          email: `${id("legacy2")}@example.test`,
          passwordHash: "scrypt$hash",
          role: "player",
          claimCodeHash: id("claim"),
        }),
        (error: unknown) =>
          error instanceof AuthStoreError && error.code === "CLAIM_INVALID",
      );
    });

    void it("resets a password once with an operator code and revokes sessions", async () => {
      const accountId = id("acct-a");
      await store.createSession({
        tokenHash: id("reset-session"),
        accountId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      await store.createAccountClaim({
        codeHash: id("reset"),
        accountId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      assert.equal(
        await store.resetPasswordWithClaim({
          codeHash: id("reset"),
          passwordHash: "scrypt$new",
        }),
        accountId,
      );
      assert.equal(
        (await store.getPasswordCredential(`${id("player")}@example.test`))
          ?.passwordHash,
        "scrypt$new",
      );
      assert.equal(await store.getSession(id("reset-session")), null);
      assert.equal(
        await store.resetPasswordWithClaim({
          codeHash: id("reset"),
          passwordHash: "scrypt$again",
        }),
        null,
        "codes are single use",
      );
      await store.upsertAccount(id("no-password"), "Discord Only");
      await store.createAccountClaim({
        codeHash: id("reset-2"),
        accountId: id("no-password"),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      assert.equal(
        await store.resetPasswordWithClaim({
          codeHash: id("reset-2"),
          passwordHash: "x",
        }),
        null,
        "accounts without a password cannot be reset",
      );
    });

    void it("resolves OAuth identities to one account", async () => {
      const first = await store.resolveOAuthAccount({
        provider: "discord",
        subject: id("discord"),
        newAccountId: id("acct-discord"),
        displayName: "Discord Player",
        role: "player",
      });
      const second = await store.resolveOAuthAccount({
        provider: "discord",
        subject: id("discord"),
        newAccountId: id("acct-discord-2"),
        displayName: "Discord Player",
        role: "player",
      });
      assert.deepEqual(first, { accountId: id("acct-discord"), created: true });
      assert.deepEqual(second, {
        accountId: id("acct-discord"),
        created: false,
      });
    });

    void it("grants the starter collection exactly once", async () => {
      const accountId = id("acct-a");
      const deck = {
        deckId: "starter-ember",
        accountId,
        gameId: "cardforge-proof",
        formatId: "proof-constructed",
        leaderId: "leader.ember",
        name: "Starter",
        revision: 1,
        cardIds: ["entity.test", "entity.test"],
      };
      const grant = [{ cardId: "entity.test", quantity: 2 }];
      assert.equal(
        await store.grantStarter({
          accountId,
          starterLeaderId: "leader.ember",
          grant,
          deck,
        }),
        true,
      );
      assert.equal(
        await store.grantStarter({
          accountId,
          starterLeaderId: "leader.citadel",
          grant: [{ cardId: "entity.other", quantity: 3 }],
          deck: { ...deck, deckId: "starter-citadel" },
        }),
        false,
      );
      const snapshot = await store.getEconomySnapshot(accountId);
      assert.deepEqual(snapshot.cards, [
        { cardId: "entity.test", quantity: 2 },
      ]);
      assert.equal(
        (await store.getAccount(accountId))?.starterLeaderId,
        "leader.ember",
      );
      assert.equal((await store.listDecks(accountId)).length, 1);
      assert.equal(await store.deleteDeck(accountId, "starter-ember"), true);
      assert.equal(await store.deleteDeck(accountId, "starter-ember"), false);
      const completed = await store.markOnboardingComplete(accountId);
      assert.ok(completed?.onboardingCompletedAt);
    });

    void it("records history, outcomes, and rewards exactly once", async () => {
      const hostId = id("acct-a");
      const guestId = id("acct-discord");
      const matchId = id("match");
      await store.saveMatch({
        status: "active",
        replay: persistenceTestReplay(matchId),
      });
      await store.recordMatchStart({
        matchId,
        queue: "casual",
        participants: [
          {
            seat: "p1",
            accountId: hostId,
            displayName: "Player A",
            deckId: "d1",
            deckName: "Deck",
            leaderId: "leader.ember",
          },
          {
            seat: "p2",
            accountId: guestId,
            displayName: "Discord Player",
            deckId: "d2",
            deckName: "Other",
            leaderId: "leader.citadel",
          },
        ],
      });
      const outcome = {
        matchId,
        winnerId: "p1" as const,
        reason: "dominion" as const,
        cycles: 9,
        stats: { p1: stats(6, 2), p2: stats(3, 1) },
      };
      assert.equal(await store.recordMatchOutcome(outcome), true);
      assert.equal(
        await store.recordMatchOutcome({ ...outcome, winnerId: "p2" }),
        false,
      );
      // A late save must not reopen a completed match.
      await store.saveMatch({
        status: "active",
        replay: persistenceTestReplay(matchId),
      });
      assert.equal((await store.getMatchMeta(matchId))?.status, "complete");

      const before = await store.getEconomySnapshot(hostId);
      const shardsBefore = before.wallets.find(
        (w) => w.currencyId === "shards",
      )!.balance;
      const rewardInput = {
        matchId,
        accountId: hostId,
        queue: "casual" as const,
        seasonId: "frontier-test",
        participant: {
          playerId: "p1" as const,
          accountId: hostId,
          leaderId: "leader.ember",
          aspects: ["force" as const],
        },
        won: true,
        cycles: 9,
        shards: 60,
        grantUnrankedXp: true,
      };
      const [first, second] = await Promise.all([
        store.settleMatchReward(rewardInput),
        store.settleMatchReward(rewardInput),
      ]);
      assert.equal(
        [first, second].filter(Boolean).length,
        1,
        "reward settled once under concurrency",
      );
      assert.equal(await store.settleMatchReward(rewardInput), null);
      const afterSnapshot = await store.getEconomySnapshot(hostId);
      assert.equal(
        afterSnapshot.wallets.find((w) => w.currencyId === "shards")!.balance,
        shardsBefore + 60,
      );

      const history = await store.listMatchHistory(hostId);
      const entry = history.find((row) => row.matchId === matchId);
      assert.equal(entry?.result, "win");
      assert.equal(entry?.opponent?.displayName, "Discord Player");
      assert.equal(entry?.reward?.shards, 60);
      assert.equal(entry?.reason, "dominion");

      const activity = await store.questActivity(
        hostId,
        new Date(Date.now() - 60_000).toISOString(),
      );
      assert.equal(activity.matchesPlayed, 1);
      assert.equal(activity.matchesWon, 1);
      assert.equal(activity.dominion, 6);
      assert.ok(
        (await store.listCompletedMatches({ limit: 50 })).some(
          (m) => m.meta.matchId === matchId,
        ),
      );
    });

    void it("admits one guest per invite and rejects expired codes", async () => {
      const code = `Q${run
        .toUpperCase()
        .replace(/[^A-Z2-9]/g, "Z")
        .slice(0, 5)
        .padEnd(5, "Z")}`;
      await store.createInvite({
        code,
        hostAccountId: id("acct-a"),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      await assert.rejects(
        store.createInvite({
          code,
          hostAccountId: id("acct-a"),
          expiresAt: new Date().toISOString(),
        }),
        (error: unknown) =>
          error instanceof InviteError && error.code === "INVITE_CODE_TAKEN",
      );
      assert.equal(
        (await store.admitToInvite(code, id("acct-a"))).status,
        "open",
      );
      assert.equal(
        (await store.admitToInvite(code, id("acct-discord"))).guestAccountId,
        id("acct-discord"),
      );
      await store.upsertAccount(id("third"), "Third");
      await assert.rejects(
        store.admitToInvite(code, id("third")),
        (error: unknown) =>
          error instanceof InviteError && error.code === "INVITE_USED",
      );
      await store.markInviteStarted(code, id("friend-match"));
      assert.equal((await store.getInvite(code))?.status, "started");
      await assert.rejects(store.admitToInvite("ZZZZZZ", id("third")));
    });

    void it("claims quest rewards once per period", async () => {
      const cosmetic = cosmeticCatalog.find(
        (item) => item.cosmeticId === "frame.founder-brass",
      )!;
      const input = {
        accountId: id("acct-a"),
        questId: "season.first-six",
        periodKey: "frontier-test",
        reward: { shards: 10, cosmetic },
      };
      assert.equal((await store.claimQuestReward(input)).claimed, true);
      const repeat = await store.claimQuestReward(input);
      assert.equal(repeat.claimed, false);
      assert.ok(
        repeat.snapshot.entitlements.some(
          (e) => e.entitlementId === cosmetic.cosmeticId,
        ),
      );
      assert.ok(
        (await store.listQuestClaims(id("acct-a"))).some(
          (c) => c.questId === "season.first-six",
        ),
      );
    });

    void it("stores product analytics idempotently", async () => {
      const event = {
        eventId: id("evt"),
        accountId: id("acct-a"),
        name: "tutorial_started",
        properties: { step: 1 },
      };
      await store.recordProductEvent(event);
      await store.recordProductEvent(event);
      const events = await store.listProductEvents({ limit: 1_000 });
      assert.equal(events.filter((row) => row.eventId === id("evt")).length, 1);
    });
  });
