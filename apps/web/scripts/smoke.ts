import { Browser } from "./cdp.ts";

interface SmokeEntry {
  readonly mulliganClosed: boolean;
  readonly hasCanvas: boolean;
  readonly hasEvents: boolean;
  readonly hasHand: boolean;
}

interface LeaderSetup {
  readonly poolLabel: string;
  readonly fxLabel: string;
  readonly selectors: number;
  readonly p1Options: number;
  readonly p2Options: number;
  readonly p1Leader: string;
  readonly p2Leader: string;
}

interface GuideResult {
  readonly score: string;
  readonly completeStep: string;
  readonly closed: boolean;
}

interface SmokeSelection {
  readonly inspectorName: string;
  readonly actionCount: number;
  readonly selectedCards: number;
}

interface SmokeResolution {
  readonly latestEvent: string;
  readonly canvasStillMounted: boolean;
  readonly pageTitle: string;
  readonly cueKind: string;
  readonly boardCueCount: number;
  readonly fxState: string;
}

interface HotseatPrivacy {
  readonly handoffVisible: boolean;
  readonly exposedHandCards: number;
  readonly viewer: string;
}

interface HotseatSeat {
  readonly viewer: string;
  readonly handCards: number;
  readonly actionCount: number;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const web = (process.env.CARDFORGE_WEB_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const browser = await Browser.launch();
const labPage = await browser.newPage(`${web}/lab`);
const send = <T>(method: string, params: object = {}): Promise<T> =>
  labPage.send<T>(method, params);
const evaluate = <T>(expression: string): Promise<T> =>
  labPage.evaluate<T>(expression);
await send("Runtime.enable");
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
await delay(300);
const initialLeaders = await evaluate<LeaderSetup>(`({
  poolLabel: document.querySelector('.brand-lockup p')?.textContent ?? '',
  fxLabel: document.querySelector('.fx-toggle')?.textContent ?? '',
  selectors: document.querySelectorAll('.leader-selector select').length,
  p1Options: document.querySelectorAll('select[data-player="p1"] option').length,
  p2Options: document.querySelectorAll('select[data-player="p2"] option').length,
  p1Leader: document.querySelector('select[data-player="p1"]')?.value ?? '',
  p2Leader: document.querySelector('select[data-player="p2"]')?.value ?? ''
})`);
if (
  !initialLeaders.poolLabel.includes("180 CARD POOL") ||
  !initialLeaders.poolLabel.includes("LAB BUILD 08") ||
  !initialLeaders.fxLabel.includes("FX REDUCED") ||
  initialLeaders.selectors !== 2 ||
  initialLeaders.p1Options !== 12 ||
  initialLeaders.p2Options !== 12
)
  throw new Error(
    `Leader setup smoke failed: ${JSON.stringify(initialLeaders)}`,
  );

const initialGuideStep = await evaluate<string>(
  `document.querySelector('.field-guide')?.getAttribute('data-guide-step') ?? ''`,
);
if (initialGuideStep !== "1")
  throw new Error(
    `Field Guide did not open at lesson one: ${initialGuideStep}`,
  );
for (let lesson = 0; lesson < 4; lesson += 1) {
  await evaluate(
    `document.querySelector('.field-guide__answers button[data-correct="true"]')?.click()`,
  );
  await delay(25);
  await evaluate(`document.querySelector('.field-guide__next')?.click()`);
  await delay(25);
}
const guideResult = await evaluate<GuideResult>(`({
  score: document.querySelector('[data-guide-score]')?.getAttribute('data-guide-score') ?? '',
  completeStep: document.querySelector('.field-guide')?.getAttribute('data-guide-step') ?? '',
  closed: false
})`);
if (guideResult.score !== "4/4" || guideResult.completeStep !== "complete")
  throw new Error(
    `Field Guide comprehension failed: ${JSON.stringify(guideResult)}`,
  );
await evaluate(`document.querySelector('.field-guide__finish')?.click()`);
await delay(25);
const guideClosed = await evaluate<boolean>(
  `!document.querySelector('.field-guide') && document.querySelector('.guide-button')?.textContent?.includes('4/4') === true`,
);
if (!guideClosed) throw new Error("Field Guide did not release the match UI");

await evaluate(`{
  const select = document.querySelector('select[data-player="p1"]');
  if (select) {
    select.value = 'leader.skydancer';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}`);
await delay(100);
const selectedLeader = await evaluate<{ leader: string; handCards: number }>(`({
  leader: document.querySelector('.player-dock')?.getAttribute('data-leader') ?? '',
  handCards: document.querySelectorAll('.hand-card').length
})`);
if (
  selectedLeader.leader !== "leader.skydancer" ||
  selectedLeader.handCards !== 5
)
  throw new Error(`Leader selection failed: ${JSON.stringify(selectedLeader)}`);

await evaluate(`document.querySelector('.player-core .leader-chip')?.click()`);
await delay(100);
const inspectedLeader = await evaluate<{ name: string; rules: string }>(`({
  name: document.querySelector('.inspector-card h2')?.textContent ?? '',
  rules: document.querySelector('.inspector-card .rules-text')?.textContent ?? ''
})`);
if (
  inspectedLeader.name !== "Arlen Skydancer" ||
  !inspectedLeader.rules.includes("Scout 2")
)
  throw new Error(
    `Leader inspection failed: ${JSON.stringify(inspectedLeader)}`,
  );

await evaluate(`document.querySelector('.button--primary')?.click()`);
await delay(1_200);

const enteredMatch = await evaluate<SmokeEntry>(`({
  mulliganClosed: !document.querySelector('.mulligan-callout'),
  hasCanvas: Boolean(document.querySelector('.board-canvas canvas')),
  hasEvents: document.querySelectorAll('.history-list li').length >= 2,
  hasHand: document.querySelectorAll('.hand-card').length > 0
})`);
if (
  !enteredMatch.mulliganClosed ||
  !enteredMatch.hasCanvas ||
  !enteredMatch.hasEvents ||
  !enteredMatch.hasHand
)
  throw new Error(`Match entry smoke failed: ${JSON.stringify(enteredMatch)}`);

await evaluate(`{
  const cards = [...document.querySelectorAll('.hand-card')];
  const playable = cards.find((card) => card.querySelector('small')?.textContent === 'ENTITY') ?? cards[0];
  playable?.click();
}`);
await delay(100);

const selected = await evaluate<SmokeSelection>(`({
  inspectorName: document.querySelector('.inspector-card h2')?.textContent ?? '',
  actionCount: document.querySelectorAll('.action-button').length,
  selectedCards: document.querySelectorAll('.hand-card.is-selected').length
})`);
if (
  !selected.inspectorName ||
  selected.actionCount === 0 ||
  selected.selectedCards !== 1
)
  throw new Error(`Selection smoke failed: ${JSON.stringify(selected)}`);

await evaluate(`document.querySelector('.action-button')?.click()`);
await delay(1_200);
const resolved = await evaluate<SmokeResolution>(`({
  latestEvent: document.querySelector('.history-list li')?.textContent ?? '',
  canvasStillMounted: Boolean(document.querySelector('.board-canvas canvas')),
  pageTitle: document.title,
  cueKind: document.querySelector('.event-callout')?.getAttribute('data-event-kind') ?? '',
  boardCueCount: Number(document.querySelector('.board-canvas')?.getAttribute('data-cue-count') ?? 0),
  fxState: document.querySelector('.fx-toggle')?.getAttribute('data-fx') ?? ''
})`);
if (
  !resolved.latestEvent ||
  !resolved.canvasStillMounted ||
  !resolved.cueKind ||
  resolved.boardCueCount === 0 ||
  resolved.fxState !== "on"
)
  throw new Error(`Action smoke failed: ${JSON.stringify(resolved)}`);

await evaluate(`document.querySelector('.event-callout button')?.click()`);
await delay(50);
const cueCleared = await evaluate<boolean>(
  `!document.querySelector('.event-callout') && document.querySelector('.board-canvas')?.getAttribute('data-cue-count') === '0'`,
);
if (!cueCleared) throw new Error("Skip FX did not clear the current cue batch");

await evaluate(
  `document.querySelector('.mode-button[data-mode="hotseat"]')?.click()`,
);
await delay(100);
await evaluate(`document.querySelector('.button--primary')?.click()`);
await delay(100);

const lockedForPlayer2 = await evaluate<HotseatPrivacy>(`({
  handoffVisible: Boolean(document.querySelector('.handoff-screen')),
  exposedHandCards: document.querySelectorAll('.hand-card').length,
  viewer: document.querySelector('.player-dock')?.getAttribute('data-viewer') ?? ''
})`);
if (
  !lockedForPlayer2.handoffVisible ||
  lockedForPlayer2.exposedHandCards !== 0 ||
  lockedForPlayer2.viewer !== "p1"
)
  throw new Error(
    `Player 2 handoff privacy failed: ${JSON.stringify(lockedForPlayer2)}`,
  );

await evaluate(`document.querySelector('.handoff-button')?.click()`);
await delay(100);
const player2Seat = await evaluate<HotseatSeat>(`({
  viewer: document.querySelector('.player-dock')?.getAttribute('data-viewer') ?? '',
  handCards: document.querySelectorAll('.hand-card').length,
  actionCount: document.querySelectorAll('.action-button').length
})`);
if (player2Seat.viewer !== "p2" || player2Seat.handCards === 0)
  throw new Error(`Player 2 reveal failed: ${JSON.stringify(player2Seat)}`);

await evaluate(`document.querySelector('.button--primary')?.click()`);
await delay(100);
const hasSecondHandoff = await evaluate<boolean>(
  `Boolean(document.querySelector('.handoff-screen'))`,
);
if (hasSecondHandoff) {
  const hidden = await evaluate<number>(
    `document.querySelectorAll('.hand-card').length`,
  );
  if (hidden !== 0)
    throw new Error("Completed mulligan exposed a private hand");
  await evaluate(`document.querySelector('.handoff-button')?.click()`);
  await delay(100);
}

await evaluate(`{
  const cards = [...document.querySelectorAll('.hand-card')];
  const playable = cards.find((card) => card.querySelector('small')?.textContent === 'ENTITY') ?? cards[0];
  playable?.click();
}`);
await delay(100);
await evaluate(`document.querySelector('.action-button')?.click()`);
await delay(100);
const lockedAfterAction = await evaluate<HotseatPrivacy>(`({
  handoffVisible: Boolean(document.querySelector('.handoff-screen')),
  exposedHandCards: document.querySelectorAll('.hand-card').length,
  viewer: document.querySelector('.player-dock')?.getAttribute('data-viewer') ?? ''
})`);
if (
  !lockedAfterAction.handoffVisible ||
  lockedAfterAction.exposedHandCards !== 0
)
  throw new Error(
    `Action handoff privacy failed: ${JSON.stringify(lockedAfterAction)}`,
  );

await evaluate(`document.querySelector('.handoff-button')?.click()`);
await delay(100);
const responseSeat = await evaluate<HotseatSeat>(`({
  viewer: document.querySelector('.player-dock')?.getAttribute('data-viewer') ?? '',
  handCards: document.querySelectorAll('.hand-card').length,
  actionCount: document.querySelectorAll('.action-button').length
})`);
if (responseSeat.handCards === 0 || responseSeat.actionCount === 0)
  throw new Error(
    `Response seat reveal failed: ${JSON.stringify(responseSeat)}`,
  );

await evaluate(`{
  const select = document.querySelector('.global-theme-switcher select');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, 'orbital-conflict');
  select.dispatchEvent(new Event('change', { bubbles: true }));
}`);
await delay(120);
const rebrand = await evaluate<{
  theme: string;
  title: string;
  resourceLabels: string;
  boardLabel: string;
}>(`({
  theme: document.documentElement.dataset.gameTheme ?? '',
  title: document.querySelector('.brand-lockup h1')?.textContent ?? '',
  resourceLabels: [...document.querySelectorAll('.stat-pill small')].map((node) => node.textContent).join(' // '),
  boardLabel: document.querySelector('.arena-panel')?.getAttribute('aria-label') ?? ''
})`);
if (
  rebrand.theme !== "orbital-conflict" ||
  rebrand.title !== "Orbital Conflict" ||
  !rebrand.resourceLabels.includes("POWER") ||
  !rebrand.resourceLabels.includes("SECTOR CONTROL") ||
  !rebrand.boardLabel.includes("Sector")
)
  throw new Error(`Live rebrand failed: ${JSON.stringify(rebrand)}`);

console.log(
  JSON.stringify(
    {
      enteredMatch,
      guide: { ...guideResult, closed: guideClosed },
      initialLeaders,
      selectedLeader,
      inspectedLeader,
      selected,
      resolved,
      hotseat: {
        lockedForPlayer2,
        player2Seat,
        lockedAfterAction,
        responseSeat,
      },
      rebrand,
    },
    null,
    2,
  ),
);

await browser.close();
