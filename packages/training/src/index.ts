import type { GameState, MatchSetup } from "@cardforge/rules-kernel";
import {
  prototypeDecks,
  proofCardMap,
  TempoFrontEngine,
  type PrototypeLeaderId,
} from "@cardforge/rules-tempofront";

export type TrainingScenarioKind = "tutorial" | "pve";

export interface TrainingStep {
  readonly title: string;
  readonly instruction: string;
  readonly teaches:
    "focus" | "timeline" | "strike" | "fronts" | "responses" | "puzzle";
}

export interface TrainingScenario {
  readonly scenarioId: string;
  readonly kind: TrainingScenarioKind;
  readonly title: string;
  readonly summary: string;
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly playerLeaderId: PrototypeLeaderId;
  readonly opponentLeaderId: PrototypeLeaderId;
  readonly modifiers: {
    readonly playerIntegrity?: number;
    readonly opponentIntegrity?: number;
    readonly playerDominion?: number;
    readonly opponentDominion?: number;
    readonly playerFocus?: number;
    readonly opponentFocus?: number;
  };
  readonly objective:
    | { readonly type: "win_match" }
    | { readonly type: "win_integrity" }
    | { readonly type: "win_dominion" }
    | { readonly type: "survive_cycles"; readonly cycles: number };
  readonly steps: readonly TrainingStep[];
  readonly reward: { readonly shards: number; readonly styleTokens: number };
}

export const trainingScenarios: readonly TrainingScenario[] = [
  {
    scenarioId: "tutorial.focus",
    kind: "tutorial",
    title: "Power the Front",
    summary: "Deploy an Entity and learn why Focus limits raw power.",
    difficulty: 1,
    playerLeaderId: "leader.ember",
    opponentLeaderId: "leader.citadel",
    modifiers: { playerFocus: 5, opponentFocus: 2 },
    objective: { type: "survive_cycles", cycles: 2 },
    steps: [
      {
        title: "Read the cost",
        instruction: "Choose an Entity your available Focus can pay for.",
        teaches: "focus",
      },
      {
        title: "Commit",
        instruction: "Deploy it into an open Vanguard or Support slot.",
        teaches: "focus",
      },
    ],
    reward: { shards: 150, styleTokens: 0 },
  },
  {
    scenarioId: "tutorial.timeline",
    kind: "tutorial",
    title: "The Shared Clock",
    summary: "Compare one heavy action with several fast actions.",
    difficulty: 1,
    playerLeaderId: "leader.vector",
    opponentLeaderId: "leader.ember",
    modifiers: { playerFocus: 6, opponentFocus: 6 },
    objective: { type: "survive_cycles", cycles: 3 },
    steps: [
      {
        title: "Preview Time",
        instruction:
          "Inspect the projected Time marker before confirming an action.",
        teaches: "timeline",
      },
      {
        title: "Stay ahead",
        instruction: "Use a low-Time action and observe who acts next.",
        teaches: "timeline",
      },
    ],
    reward: { shards: 150, styleTokens: 0 },
  },
  {
    scenarioId: "tutorial.strikes",
    kind: "tutorial",
    title: "Open the Line",
    summary: "Use Vanguard protection, Ranged reach, and an exposed Front.",
    difficulty: 1,
    playerLeaderId: "leader.ember",
    opponentLeaderId: "leader.vector",
    modifiers: { opponentIntegrity: 12 },
    objective: { type: "win_integrity" },
    steps: [
      {
        title: "Clear Vanguard",
        instruction:
          "Strike the protecting Vanguard before pressuring the Leader.",
        teaches: "strike",
      },
      {
        title: "Exploit the gap",
        instruction: "Strike through the empty Front to damage the Leader.",
        teaches: "strike",
      },
    ],
    reward: { shards: 200, styleTokens: 0 },
  },
  {
    scenarioId: "tutorial.fronts",
    kind: "tutorial",
    title: "Claim the Majority",
    summary: "Power wins fights. Presence wins Fronts.",
    difficulty: 2,
    playerLeaderId: "leader.verdant",
    opponentLeaderId: "leader.citadel",
    modifiers: { playerDominion: 4, opponentDominion: 3 },
    objective: { type: "win_dominion" },
    steps: [
      {
        title: "Count Presence",
        instruction: "Compare Presence totals across all three Fronts.",
        teaches: "fronts",
      },
      {
        title: "Secure two",
        instruction: "Shift or deploy to control a majority before Cycle end.",
        teaches: "fronts",
      },
    ],
    reward: { shards: 250, styleTokens: 0 },
  },
  {
    scenarioId: "tutorial.responses",
    kind: "tutorial",
    title: "Answer and Counter",
    summary: "Practice the bounded Response and Counter-Response chain.",
    difficulty: 2,
    playerLeaderId: "leader.cipher",
    opponentLeaderId: "leader.ember",
    modifiers: { playerFocus: 8, opponentFocus: 8 },
    objective: { type: "win_match" },
    steps: [
      {
        title: "Hold Focus",
        instruction: "Keep enough Focus available to play a Reaction.",
        teaches: "responses",
      },
      {
        title: "Pay the debt",
        instruction: "Watch Tempo Debt advance the responder's Time marker.",
        teaches: "responses",
      },
    ],
    reward: { shards: 300, styleTokens: 50 },
  },
  {
    scenarioId: "pve.broken-citadel",
    kind: "pve",
    title: "The Broken Citadel",
    summary:
      "A fortified boss begins near Dominion victory. Break its scoring lock.",
    difficulty: 3,
    playerLeaderId: "leader.skydancer",
    opponentLeaderId: "leader.citadel",
    modifiers: { opponentDominion: 4, opponentIntegrity: 26, opponentFocus: 6 },
    objective: { type: "win_match" },
    steps: [
      {
        title: "Deny the score",
        instruction:
          "Contest two Fronts before the Citadel reaches six Dominion.",
        teaches: "puzzle",
      },
    ],
    reward: { shards: 500, styleTokens: 75 },
  },
  {
    scenarioId: "pve.last-signal",
    kind: "pve",
    title: "The Last Signal",
    summary:
      "Win by Dominion while an attrition boss threatens your damaged Leader.",
    difficulty: 4,
    playerLeaderId: "leader.sanctuary",
    opponentLeaderId: "leader.hollow",
    modifiers: { playerIntegrity: 9, playerDominion: 3, opponentFocus: 7 },
    objective: { type: "win_dominion" },
    steps: [
      {
        title: "Stabilize",
        instruction:
          "Use healing and Presence instead of racing Leader damage.",
        teaches: "puzzle",
      },
    ],
    reward: { shards: 650, styleTokens: 100 },
  },
  {
    scenarioId: "pve.clockwork-hunt",
    kind: "pve",
    title: "Clockwork Hunt",
    summary: "Defeat a tempo boss that begins with maximum Focus.",
    difficulty: 5,
    playerLeaderId: "leader.null",
    opponentLeaderId: "leader.relay",
    modifiers: { playerIntegrity: 14, opponentIntegrity: 24, opponentFocus: 8 },
    objective: { type: "win_integrity" },
    steps: [
      {
        title: "Choose the opening",
        instruction:
          "Disrupt the enemy's fast actions, then attack the exposed line.",
        teaches: "puzzle",
      },
    ],
    reward: { shards: 800, styleTokens: 150 },
  },
];

export function validateTrainingScenarios(
  scenarios: readonly TrainingScenario[] = trainingScenarios,
): readonly string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (ids.has(scenario.scenarioId))
      errors.push(`Duplicate scenario ${scenario.scenarioId}`);
    ids.add(scenario.scenarioId);
    for (const leaderId of [
      scenario.playerLeaderId,
      scenario.opponentLeaderId,
    ]) {
      if (proofCardMap.get(leaderId)?.type !== "leader")
        errors.push(`${scenario.scenarioId} uses missing Leader ${leaderId}`);
      if (!prototypeDecks[leaderId])
        errors.push(
          `${scenario.scenarioId} uses a Leader without a starter deck`,
        );
    }
    if (scenario.reward.shards < 0 || scenario.reward.styleTokens < 0)
      errors.push(`${scenario.scenarioId} has a negative reward`);
    if (!scenario.steps.length)
      errors.push(`${scenario.scenarioId} has no teaching step`);
  }
  return errors;
}

export function createTrainingGame(
  scenario: TrainingScenario,
  input: { readonly matchId: string; readonly seed: number },
): GameState {
  const engine = new TempoFrontEngine();
  const state = engine.createGame({
    ...input,
    decks: {
      p1: prototypeDecks[scenario.playerLeaderId],
      p2: prototypeDecks[scenario.opponentLeaderId],
    },
    leaders: {
      p1: scenario.playerLeaderId,
      p2: scenario.opponentLeaderId,
    },
    setup: trainingMatchSetup(scenario),
  });
  return state;
}

export function trainingMatchSetup(scenario: TrainingScenario): MatchSetup {
  return {
    players: {
      p1: {
        ...(scenario.modifiers.playerIntegrity === undefined
          ? {}
          : { integrity: scenario.modifiers.playerIntegrity }),
        ...(scenario.modifiers.playerDominion === undefined
          ? {}
          : { dominion: scenario.modifiers.playerDominion }),
        ...(scenario.modifiers.playerFocus === undefined
          ? {}
          : { focus: scenario.modifiers.playerFocus }),
      },
      p2: {
        ...(scenario.modifiers.opponentIntegrity === undefined
          ? {}
          : { integrity: scenario.modifiers.opponentIntegrity }),
        ...(scenario.modifiers.opponentDominion === undefined
          ? {}
          : { dominion: scenario.modifiers.opponentDominion }),
        ...(scenario.modifiers.opponentFocus === undefined
          ? {}
          : { focus: scenario.modifiers.opponentFocus }),
      },
    },
  };
}
