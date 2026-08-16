interface CdpTarget {
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

interface CdpEnvelope<T = unknown> {
  readonly id?: number;
  readonly error?: { readonly message: string };
  readonly result?: T;
}

interface EvaluationResult<T> {
  readonly exceptionDetails?: { readonly text?: string };
  readonly result: { readonly value: T };
}

interface SmokeEntry {
  readonly mulliganClosed: boolean;
  readonly hasCanvas: boolean;
  readonly hasEvents: boolean;
  readonly hasHand: boolean;
}

interface LeaderSetup {
  readonly poolLabel: string;
  readonly selectors: number;
  readonly p1Options: number;
  readonly p2Options: number;
  readonly p1Leader: string;
  readonly p2Leader: string;
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

const endpoint = process.env.CARDFORGE_CDP_URL ?? "http://127.0.0.1:9222";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const discoveryResponse = await fetch(`${endpoint}/json`);
if (!discoveryResponse.ok)
  throw new Error(`CDP discovery failed: ${discoveryResponse.status}`);
const targets = (await discoveryResponse.json()) as CdpTarget[];
const page = targets.find(
  (target) => target.type === "page" && target.url.includes("localhost:3000"),
);
if (!page) throw new Error("CardForge page target was not found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
  socket.addEventListener("open", () => resolve(), { once: true });
  socket.addEventListener(
    "error",
    () => reject(new Error("CDP socket failed")),
    {
      once: true,
    },
  );
});

let nextId = 1;
const pending = new Map<
  number,
  {
    readonly resolve: (value: unknown) => void;
    readonly reject: (reason: Error) => void;
  }
>();
socket.addEventListener("message", (message) => {
  const payload = JSON.parse(String(message.data)) as CdpEnvelope;
  if (!payload.id) return;
  const callback = pending.get(payload.id);
  if (!callback) return;
  pending.delete(payload.id);
  if (payload.error) callback.reject(new Error(payload.error.message));
  else callback.resolve(payload.result);
});

function send<T>(method: string, params: object = {}): Promise<T> {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
  });
}

async function evaluate<T>(expression: string): Promise<T> {
  const response = await send<EvaluationResult<T>>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw new Error(
      response.exceptionDetails.text ?? "Browser evaluation failed",
    );
  return response.result.value;
}

await send("Runtime.enable");
const initialLeaders = await evaluate<LeaderSetup>(`({
  poolLabel: document.querySelector('.brand-lockup p')?.textContent ?? '',
  selectors: document.querySelectorAll('.leader-selector select').length,
  p1Options: document.querySelectorAll('select[data-player="p1"] option').length,
  p2Options: document.querySelectorAll('select[data-player="p2"] option').length,
  p1Leader: document.querySelector('select[data-player="p1"]')?.value ?? '',
  p2Leader: document.querySelector('select[data-player="p2"]')?.value ?? ''
})`);
if (
  !initialLeaders.poolLabel.includes("60 CARD POOL") ||
  initialLeaders.selectors !== 2 ||
  initialLeaders.p1Options !== 4 ||
  initialLeaders.p2Options !== 4
)
  throw new Error(
    `Leader setup smoke failed: ${JSON.stringify(initialLeaders)}`,
  );

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
  pageTitle: document.title
})`);
if (!resolved.latestEvent || !resolved.canvasStillMounted)
  throw new Error(`Action smoke failed: ${JSON.stringify(resolved)}`);

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

socket.close();
console.log(
  JSON.stringify(
    {
      enteredMatch,
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
    },
    null,
    2,
  ),
);

export {};
