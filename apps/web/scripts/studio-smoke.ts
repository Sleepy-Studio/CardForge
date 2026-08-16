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

const endpoint = process.env.CARDFORGE_STUDIO_CDP ?? "http://127.0.0.1:9224";
const targets = (await (await fetch(`${endpoint}/json`)).json()) as Target[];
const page = targets.find(
  (target) => target.type === "page" && target.url.includes("/studio"),
);
if (!page) throw new Error("Card Studio page is not open");
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
await send("Runtime.enable");
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
await new Promise((resolve) => setTimeout(resolve, 400));
const before = await evaluate<{
  cards: number;
  gameplay: string;
  presentation: string;
  theme: string;
  preview: boolean;
  draftLength: number;
}>(`({
  cards: document.querySelectorAll('.studio-card-list button').length,
  gameplay: document.querySelector('.studio-hashes span:nth-child(1)')?.textContent ?? '',
  presentation: document.querySelector('.studio-hashes span:nth-child(2)')?.textContent ?? '',
  theme: document.querySelector('.studio-shell')?.getAttribute('data-theme-id') ?? '',
  preview: Boolean(document.querySelector('.studio-preview img'))
  ,draftLength: document.querySelector('.studio-json-label textarea')?.value.length ?? 0
})`);
if (
  before.cards !== 121 ||
  before.theme !== "aetherfront" ||
  !before.gameplay ||
  !before.presentation ||
  !before.preview ||
  before.draftLength < 100
)
  throw new Error(`Studio foundation failed: ${JSON.stringify(before)}`);

await evaluate(`{
  const select = document.querySelector('.global-theme-switcher select');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, 'orbital-conflict');
  select.dispatchEvent(new Event('change', { bubbles: true }));
}`);
await new Promise((resolve) => setTimeout(resolve, 120));
await evaluate(`{
  const card = [...document.querySelectorAll('.studio-card-list button')]
    .find((button) => button.textContent?.includes('Recover the Fallen'));
  card?.click();
}`);
await new Promise((resolve) => setTimeout(resolve, 120));
await evaluate(`document.querySelector('.studio-validation button')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 120));
const after = await evaluate<{
  gameplay: string;
  presentation: string;
  theme: string;
  rules: string;
  validation: string;
}>(`({
  gameplay: document.querySelector('.studio-hashes span:nth-child(1)')?.textContent ?? '',
  presentation: document.querySelector('.studio-hashes span:nth-child(2)')?.textContent ?? '',
  theme: document.querySelector('.studio-shell')?.getAttribute('data-theme-id') ?? '',
  rules: document.querySelector('.studio-rules p')?.textContent ?? ''
  ,validation: document.querySelector('.studio-validation p')?.textContent ?? ''
})`);
if (
  after.theme !== "orbital-conflict" ||
  after.gameplay !== before.gameplay ||
  after.presentation === before.presentation ||
  !after.rules.includes("Scrapyard") ||
  after.rules.includes("discard") ||
  !after.validation.includes("Valid schema and engine graph")
)
  throw new Error(`Studio rebrand failed: ${JSON.stringify(after)}`);

socket.close();
console.log(JSON.stringify({ before, after }, null, 2));
export {};
