interface Target {
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

interface Envelope<T = unknown> {
  readonly id?: number;
  readonly error?: { readonly message: string };
  readonly result?: T;
}

interface Evaluation<T> {
  readonly exceptionDetails?: { readonly text?: string };
  readonly result: { readonly value: T };
}

const endpoint =
  process.env.CARDFORGE_CDP_COLLECTION ?? "http://127.0.0.1:9226";
const targets = (await (await fetch(`${endpoint}/json`)).json()) as Target[];
const page = targets.find(
  (target) => target.type === "page" && target.url.includes("/collection"),
);
if (!page) throw new Error("Collection page is not open in Chromium");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
  socket.addEventListener("open", () => resolve(), { once: true });
  socket.addEventListener("error", () => reject(new Error("CDP failed")), {
    once: true,
  });
});
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();
socket.addEventListener("message", (message) => {
  const payload = JSON.parse(String(message.data)) as Envelope;
  if (!payload.id) return;
  const callback = pending.get(payload.id);
  if (!callback) return;
  pending.delete(payload.id);
  if (payload.error) callback.reject(new Error(payload.error.message));
  else callback.resolve(payload.result);
});
const send = <T>(method: string, params: object = {}): Promise<T> => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise<T>((resolve, reject) =>
    pending.set(id, { resolve: (value) => resolve(value as T), reject }),
  );
};
const evaluate = async <T>(expression: string): Promise<T> => {
  const response = await send<Evaluation<T>>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw new Error(response.exceptionDetails.text ?? "Evaluation failed");
  return response.result.value;
};

await send("Runtime.enable");
await new Promise((resolve) => setTimeout(resolve, 700));
const initial = await evaluate<{
  title: string;
  status: string;
  cards: number;
  summary: string;
  cosmetics: number;
}>(`({
  title: document.querySelector('.collection-header h1')?.textContent ?? '',
  status: document.querySelector('.collection-header p:last-child')?.textContent ?? '',
  cards: document.querySelectorAll('.collection-card').length,
  summary: document.querySelector('.collection-ledger article:nth-child(3) strong')?.textContent ?? '',
  cosmetics: document.querySelectorAll('.cosmetic-market article').length
})`);
if (
  initial.title !== "Collection Vault" ||
  !initial.status.includes("verified") ||
  initial.cards !== 168 ||
  !initial.summary.endsWith("/168") ||
  initial.cosmetics !== 6
)
  throw new Error(`Collection page failed: ${JSON.stringify(initial)}`);

await evaluate(`{
  const input = document.querySelector('[aria-label="Search cards"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'linebreaker');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}`);
await new Promise((resolve) => setTimeout(resolve, 120));
const filteredCards = await evaluate<number>(
  `document.querySelectorAll('.collection-card').length`,
);
if (filteredCards !== 1)
  throw new Error(`Search returned ${filteredCards} cards`);

socket.close();
console.log(JSON.stringify({ initial, filteredCards }, null, 2));
export {};
