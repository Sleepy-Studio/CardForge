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

socket.close();
console.log(JSON.stringify({ enteredMatch, selected, resolved }, null, 2));

export {};
