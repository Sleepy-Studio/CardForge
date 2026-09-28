import type { Keyword, StatusId } from "@cardforge/card-schema";
import { tempoFrontRules } from "./ruleset.js";

/*
 * Canonical TempoFront vocabulary. Every entry is semantic: the `name` is the
 * rules-kernel term, `termId` names the Theme Pack term that may alias it,
 * and `icon` is a semantic icon ID a Theme Pack maps to art. UI tooltips,
 * the Field Guide, and generated rules text all read from this one table so
 * the wording cannot drift between surfaces.
 */

export type GlossaryKind =
  "keyword" | "status" | "resource" | "action" | "timing" | "victory" | "zone";

export interface GlossaryEntry {
  readonly id: string;
  readonly kind: GlossaryKind;
  /** Canonical rules name. */
  readonly name: string;
  /** Theme term that renames this concept (see ThemeManifest.terms). */
  readonly termId?: string;
  /** Precise rules meaning, as the engine enforces it. */
  readonly rules: string;
  /** One line, ≤ 90 characters, for hover and long-press tooltips. */
  readonly tooltip: string;
  /** Plain-language explanation for new players. */
  readonly explanation: string;
  /** Semantic icon ID resolved by the active Theme Pack. */
  readonly icon: string;
}

const r = tempoFrontRules;

export const glossary: readonly GlossaryEntry[] = [
  {
    id: "keyword.ranged",
    kind: "keyword",
    name: "Ranged",
    rules:
      "May Strike from Support. May target either enemy Entity on its Front (or the enemy Leader if none). Always retaliates when struck.",
    tooltip: "Strikes from Support and can hit either enemy slot on its Front.",
    explanation:
      "Most Entities must stand in the Vanguard to attack and can only hit the closest enemy. Ranged Entities can attack from the back row and pick their target.",
    icon: "icon.ranged",
  },
  {
    id: "keyword.armor",
    kind: "keyword",
    name: "Armor",
    rules:
      "Armor N reduces each instance of damage dealt to this Entity by N, after Barrier and Protected. Silenced Entities lose Armor.",
    tooltip: "Reduces every hit it takes by the Armor value.",
    explanation:
      "Armor 2 means each hit deals 2 less damage. Many small hits struggle against Armor; one big hit does not.",
    icon: "icon.armor",
  },
  {
    id: "keyword.barrier",
    kind: "keyword",
    name: "Barrier",
    rules:
      "Prevents the entire next instance of damage to this Entity, then is removed. Barrier applies before Protected and Armor.",
    tooltip: "Prevents the next hit completely, then breaks.",
    explanation:
      "A Barrier absorbs one hit no matter how large. Break it with a small hit before sending the big one.",
    icon: "icon.barrier",
  },
  {
    id: "keyword.rapid",
    kind: "keyword",
    name: "Rapid",
    rules:
      "Enters play ready, so it may Strike during the Cycle it is deployed.",
    tooltip: "Can Strike the Cycle it arrives.",
    explanation:
      "Entities normally need a Cycle before they can attack. Rapid Entities can attack right away.",
    icon: "icon.rapid",
  },
  {
    id: "keyword.mobile",
    kind: "keyword",
    name: "Mobile",
    rules: "Shifting this Entity costs 1 Time instead of 2.",
    tooltip: "Shifts to an adjacent Front for 1 Time instead of 2.",
    explanation:
      "Mobile Entities reposition cheaply, letting you contest a different Front without falling behind on the Timeline.",
    icon: "icon.mobile",
  },
  {
    id: "keyword.structure",
    kind: "keyword",
    name: "Structure",
    rules: "Cannot Strike and cannot Shift.",
    tooltip: "Never attacks or moves; it holds its slot.",
    explanation:
      "Structures are anchors: they add Presence or effects where they stand but never attack or change Fronts.",
    icon: "icon.structure",
  },
  {
    id: "status.stunned",
    kind: "status",
    name: "Stunned",
    rules:
      "A Stunned Entity cannot Strike and its activated abilities cannot be used. Expires as its duration states.",
    tooltip: "Cannot Strike or activate abilities until it wears off.",
    explanation:
      "Stun takes an Entity out of the fight for a while without destroying it.",
    icon: "icon.stunned",
  },
  {
    id: "status.rooted",
    kind: "status",
    name: "Rooted",
    rules: "A Rooted Entity cannot Shift.",
    tooltip: "Cannot Shift to another Front.",
    explanation:
      "Root pins an Entity where it stands so it cannot rescue another Front.",
    icon: "icon.rooted",
  },
  {
    id: "status.silenced",
    kind: "status",
    name: "Silenced",
    rules:
      "A Silenced Entity loses its keywords (such as Armor and Ranged) and its abilities do not trigger or activate.",
    tooltip: "Loses its keywords and abilities.",
    explanation:
      "Silence turns a special Entity into a plain body with just its stats.",
    icon: "icon.silenced",
  },
  {
    id: "status.exposed",
    kind: "status",
    name: "Exposed",
    rules:
      "Exposed N adds N to the next instance of damage dealt to this Entity, then is removed. Applies before Barrier.",
    tooltip: "The next hit it takes deals extra damage.",
    explanation: "Expose sets up a kill: the next hit lands harder.",
    icon: "icon.exposed",
  },
  {
    id: "status.protected",
    kind: "status",
    name: "Protected",
    rules:
      "Protected N reduces the next instance of damage to this Entity by N after Barrier, then is removed.",
    tooltip: "Reduces the next hit it takes, then fades.",
    explanation: "Protection is a one-time shield that softens a single hit.",
    icon: "icon.protected",
  },
  {
    id: "resource.focus",
    kind: "resource",
    name: "Focus",
    termId: "focus",
    rules: `Spent to play cards and use abilities. You start with ${r.startingFocus} and gain 1 maximum each Cycle, up to ${r.maximumFocus}. Refills every Cycle.`,
    tooltip: `Spend it to play cards. Refills each Cycle; grows to ${r.maximumFocus}.`,
    explanation:
      "Focus is your budget for the Cycle. It refills at the start of every Cycle and your maximum grows, so bigger cards become affordable over time.",
    icon: "icon.focus",
  },
  {
    id: "resource.time",
    kind: "resource",
    name: "Time",
    rules: `Every action adds its Time cost to your Timeline (0–${r.timelineLength}). The player with less Time acts next; ties go to the player with Initiative. A player at ${r.timelineLength} Time can no longer act this Cycle.`,
    tooltip: "Actions cost Time. Whoever has spent less Time acts next.",
    explanation:
      "TempoFront has no turns. Both players share a clock: cheap actions let you act again sooner, heavy actions hand your opponent several actions in a row.",
    icon: "icon.time",
  },
  {
    id: "concept.initiative",
    kind: "timing",
    name: "Initiative",
    rules:
      "Breaks Time ties. Initiative alternates between players each Cycle.",
    tooltip: "Wins ties on the Timeline. Swaps every Cycle.",
    explanation:
      "When both players have spent the same Time, the Initiative holder acts first.",
    icon: "icon.initiative",
  },
  {
    id: "concept.cycle",
    kind: "timing",
    name: "Cycle",
    rules:
      "A Cycle ends when both players have passed or reached the end of the Timeline. Fronts are then scored, Focus refills, Time resets, and Initiative swaps.",
    tooltip: "A round. Ends when both players pass; then Fronts are scored.",
    explanation:
      "Each Cycle both players act until they pass. At the end, whoever controls more Fronts gains Dominion.",
    icon: "icon.cycle",
  },
  {
    id: "action.deploy",
    kind: "action",
    name: "Deploy",
    rules:
      "Play an Entity from hand into an empty friendly Vanguard or Support slot by paying its Focus and Time.",
    tooltip: "Put an Entity from your hand into an empty slot.",
    explanation:
      "Deploying puts a unit on the board. Vanguard units fight; Support units are safer.",
    icon: "icon.deploy",
  },
  {
    id: "action.strike",
    kind: "action",
    name: "Strike",
    rules:
      "A ready Entity attacks the nearest enemy on its Front (Vanguard first, then Support, then the enemy Leader). Vanguard-versus-Vanguard and Ranged defenders retaliate simultaneously.",
    tooltip:
      "Attack the nearest enemy on this Front. Costs the Entity's Strike Time.",
    explanation:
      "Striking clears the way. If a Front is empty on the enemy side, your Strike hits their Leader's Integrity.",
    icon: "icon.strike",
  },
  {
    id: "action.shift",
    kind: "action",
    name: "Shift",
    rules:
      "Move a friendly Entity to an empty slot on an adjacent Front for 2 Time (1 if Mobile), once per Cycle.",
    tooltip: "Move to an adjacent Front once per Cycle (2 Time).",
    explanation:
      "Shifting lets you reinforce the Front that matters most this Cycle.",
    icon: "icon.shift",
  },
  {
    id: "action.defeat",
    kind: "action",
    name: "Defeat",
    rules:
      "An Entity whose damage reaches its Vitality is defeated and moved to its owner's discard pile, with its Attachments. Defeat triggers then resolve.",
    tooltip: "Destroyed when damage reaches its Vitality.",
    explanation:
      "Damage stays on Entities between Cycles, so wounded units remain easy targets.",
    icon: "icon.defeat",
  },
  {
    id: "action.scout",
    kind: "action",
    name: "Scout",
    rules:
      "Scout N: look at the top N cards of your deck, choose one to put into your hand, and put the rest on the bottom.",
    tooltip: "Look at the top cards of your deck and keep one.",
    explanation: "Scouting finds the right card for the situation.",
    icon: "icon.scout",
  },
  {
    id: "action.prepare",
    kind: "action",
    name: "Prepare",
    rules:
      "For 1 Time, move an eligible card from hand to your Reserve. Playing it this Cycle applies its printed discount; unused Prepared cards return to hand at refresh.",
    tooltip: "Spend 1 Time now to play a card cheaper later this Cycle.",
    explanation:
      "Preparing plans ahead: pay a little Time now to make a key card cheaper when it matters.",
    icon: "icon.prepare",
  },
  {
    id: "timing.response",
    kind: "timing",
    name: "Response",
    rules:
      "After a main action is declared, the other player may play one Reaction in response before it resolves. Responses resolve first.",
    tooltip: "React to your opponent's action before it resolves.",
    explanation:
      "Holding a Reaction lets you punish or cancel an opponent's big play.",
    icon: "icon.response",
  },
  {
    id: "timing.counter-response",
    kind: "timing",
    name: "Counter-Response",
    rules:
      "After a Response, the acting player may answer with one Reaction of their own. The chain has at most two Reactions and resolves last-in, first-out.",
    tooltip: "Answer your opponent's Response with a Reaction of your own.",
    explanation:
      "A Counter-Response is the final word: after it, the chain resolves.",
    icon: "icon.counter-response",
  },
  {
    id: "timing.tempo-debt",
    kind: "timing",
    name: "Tempo Debt",
    rules:
      "The Time a Reaction adds to its player's Timeline when declared, instead of its play Time.",
    tooltip: "Reactions cost Time too, paid when you declare them.",
    explanation:
      "Reacting is never free: it pushes you back on the shared clock.",
    icon: "icon.tempo-debt",
  },
  {
    id: "victory.presence",
    kind: "victory",
    name: "Presence",
    rules:
      "At the end of each Cycle, each player's Presence on a Front is the sum of their Entities', Attachments', and Site's Presence there. Higher Presence controls the Front; ties control nothing.",
    tooltip:
      "Your strength on a Front. Higher Presence controls it at Cycle end.",
    explanation:
      "Presence decides who holds each Front when the Cycle is scored.",
    icon: "icon.presence",
  },
  {
    id: "victory.dominion",
    kind: "victory",
    name: "Dominion",
    termId: "dominion",
    rules: `At the end of each Cycle, a player controlling at least two Fronts gains 1 Dominion. Reaching ${r.dominionToWin} Dominion wins the match.`,
    tooltip: `Control 2 Fronts at Cycle end to gain 1. Reach ${r.dominionToWin} to win.`,
    explanation:
      "Dominion is the territory victory: hold the board for enough Cycles and you win.",
    icon: "icon.dominion",
  },
  {
    id: "victory.integrity",
    kind: "victory",
    name: "Integrity",
    termId: "integrity",
    rules: `Each Leader starts with ${r.startingIntegrity} Integrity. Reduce the enemy Leader to 0 to win. Drawing from an empty deck costs increasing Integrity (fatigue).`,
    tooltip: `Your Leader's life (${r.startingIntegrity}). Reduce the enemy's to 0 to win.`,
    explanation:
      "Integrity is the aggressive victory: break through a Front and hit the enemy Leader directly.",
    icon: "icon.integrity",
  },
  {
    id: "zone.front",
    kind: "zone",
    name: "Front",
    termId: "front",
    rules:
      "One of three lanes (left, center, right). Each side has a Vanguard and a Support slot per Front, plus one shared Site slot.",
    tooltip: "One of the three battle lanes.",
    explanation:
      "Fronts are where Entities fight and where Presence is scored.",
    icon: "icon.front",
  },
];

export const glossaryById: ReadonlyMap<string, GlossaryEntry> = new Map(
  glossary.map((entry) => [entry.id, entry]),
);

export function keywordEntry(keyword: Keyword): GlossaryEntry | undefined {
  return glossaryById.get(`keyword.${keyword}`);
}

export function statusEntry(statusId: StatusId): GlossaryEntry | undefined {
  return glossaryById.get(`status.${statusId}`);
}

/** Display name for an entry under a Theme Pack's terminology. */
export function glossaryName(
  entry: GlossaryEntry,
  terms: Readonly<Record<string, string>> = {},
): string {
  return (entry.termId && terms[entry.termId]) || entry.name;
}

/** Keywords as display text, e.g. "Armor 2 · Ranged". */
export function keywordLine(
  keywords: Readonly<Partial<Record<Keyword, number | true>>> | undefined,
): string {
  return Object.entries(keywords ?? {})
    .map(([keyword, value]) => {
      const name = keywordEntry(keyword as Keyword)?.name ?? keyword;
      return value === true ? name : `${name} ${value}`;
    })
    .join(" · ");
}
