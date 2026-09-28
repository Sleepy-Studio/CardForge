import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReplayRecord } from "@cardforge/rules-kernel";
import {
  aggregateBalanceOverview,
  createCompetitiveProfile,
  createMatchTelemetry,
  progressUnrankedProfile,
  rankForRating,
  settleRankedMatch,
  unlockedLeadersForLevel,
} from "./competitive.js";
import { betaBalancePatch, launchPatch, seasonOne } from "./catalog.js";

const participants = {
  p1: {
    playerId: "p1",
    accountId: "account-one",
    leaderId: "leader.ember",
    aspects: ["force"],
  },
  p2: {
    playerId: "p2",
    accountId: "account-two",
    leaderId: "leader.citadel",
    aspects: ["bastion"],
  },
} as const;

const replay: ReplayRecord = {
  replayVersion: 1,
  matchId: "ranked-one",
  seed: 42,
  rulesetRevision: "tempofront@1",
  formatId: "standard",
  formatRevision: 1,
  contentHash: "hash",
  decks: { p1: [], p2: [] },
  acceptedCommands: [
    { type: "mulligan", playerId: "p1", instanceIds: [] },
    { type: "mulligan", playerId: "p2", instanceIds: [] },
    { type: "play_card", playerId: "p1", instanceId: "p1-1" },
    { type: "play_reaction", playerId: "p2", instanceId: "p2-1" },
    { type: "pass_response", playerId: "p1" },
    {
      type: "resolve_choice",
      playerId: "p1",
      choiceId: "choice-1",
      optionIds: ["a"],
    },
  ],
  finalStateHash: "final",
};

void describe("competitive domain", () => {
  void it("settles ratings, XP, mastery, and deterministic unlocks", () => {
    const profiles = {
      p1: createCompetitiveProfile("account-one", seasonOne.seasonId),
      p2: createCompetitiveProfile("account-two", seasonOne.seasonId),
    };
    const settled = settleRankedMatch(
      replay.matchId,
      seasonOne.seasonId,
      profiles,
      participants,
      "p1",
      8,
    );
    assert.deepEqual(settled.ratingDelta, { p1: 16, p2: -16 });
    assert.equal(settled.profiles.p1.wins, 1);
    assert.equal(settled.profiles.p2.losses, 1);
    assert.equal(settled.profiles.p1.aspectMastery.force, 50);
    assert.deepEqual(unlockedLeadersForLevel(7).slice(-1), ["leader.null"]);
  });

  void it("derives aggregate ladder telemetry from command records", () => {
    const telemetry = createMatchTelemetry({
      replay,
      queue: "ranked",
      seasonId: seasonOne.seasonId,
      participants,
      winnerId: "p1",
      victoryReason: "dominion",
      startingInitiative: "p1",
      cycles: 8,
    });
    assert.equal(telemetry.reactionCount, 1);
    assert.equal(telemetry.choiceCount, 1);
    assert.equal(telemetry.cardsPlayed, 2);
    const overview = aggregateBalanceOverview([telemetry]);
    assert.equal(overview.initiativeWinRate, 1);
    assert.equal(overview.dominionWins, 1);
    assert.deepEqual(overview.leaders, [
      { leaderId: "leader.citadel", matches: 1, wins: 0, winRate: 0 },
      { leaderId: "leader.ember", matches: 1, wins: 1, winRate: 1 },
    ]);
  });

  void it("pins a season to an immutable patch and format revision", () => {
    assert.equal(seasonOne.patchId, betaBalancePatch.patchId);
    assert.equal(seasonOne.formatRevision, betaBalancePatch.formatRevision);
    assert.equal(launchPatch.revision, 1);
    assert.deepEqual(launchPatch.cardRevisions, {});
    assert.equal(betaBalancePatch.cardRevisions["leader.vector"], 2);
  });
});

describe("rank presentation", () => {
  it("wraps the rating without altering it", () => {
    assert.equal(rankForRating(1_000).label, "Silver II");
    assert.equal(rankForRating(950).label, "Silver III");
    assert.equal(rankForRating(0).label, "Bronze III");
    assert.equal(rankForRating(949).tierId, "bronze");
    assert.equal(rankForRating(1_099).label, "Silver I");
    assert.equal(rankForRating(1_100).label, "Gold III");
    assert.equal(rankForRating(1_600).label, "Master");
    assert.equal(rankForRating(1_600).nextAt, null);
    for (let rating = 0; rating < 1_700; rating += 7) {
      const rank = rankForRating(rating);
      assert.ok(rank.progress >= 0 && rank.progress <= 1);
      if (rank.nextAt !== null) assert.ok(rating < rank.nextAt);
    }
  });

  it("advances unranked progression without touching rating", () => {
    const profile = createCompetitiveProfile("account-one", seasonOne.seasonId);
    const result = progressUnrankedProfile(profile, participants.p1, true, 8);
    assert.equal(result.profile.rating, profile.rating);
    assert.equal(result.profile.wins, 0);
    assert.equal(result.xp, 96);
    assert.equal(result.profile.accountXp, 96);
    assert.equal(result.profile.aspectMastery.force, 30);
  });
});
