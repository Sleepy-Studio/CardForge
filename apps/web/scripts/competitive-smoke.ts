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
  process.env.CARDFORGE_CDP_COMPETITIVE ?? "http://127.0.0.1:9225";
const targets = (await (await fetch(`${endpoint}/json`)).json()) as Target[];
const page = targets.find(
  (target) => target.type === "page" && target.url.includes("/competitive"),
);
if (!page) throw new Error("Competitive page is not open in Chromium");
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
await new Promise((resolve) => setTimeout(resolve, 500));
const before = await evaluate<{
  title: string;
  status: string;
  metrics: number;
  leaders: number;
  patch: string;
}>(`({
  title: document.querySelector('.competitive-header h1')?.textContent ?? '',
  status: document.querySelector('.competitive-header p:last-child')?.textContent ?? '',
  metrics: document.querySelectorAll('.competitive-metrics article').length,
  leaders: document.querySelectorAll('.leader-table [role="row"]').length - 1,
  patch: document.querySelector('.competitive-season dl > div:nth-child(2) dd')?.textContent ?? ''
})`);
if (
  before.title !== "The First Frontier" ||
  !before.status.includes("recorded matches") ||
  before.metrics !== 6 ||
  before.leaders < 2 ||
  !before.patch.includes("tempofront-competitive-1")
)
  throw new Error(`Competitive dashboard failed: ${JSON.stringify(before)}`);

await evaluate(
  `document.querySelector('.competitive-profile .button--primary')?.click()`,
);
await new Promise((resolve) => setTimeout(resolve, 350));
const profile = await evaluate<{
  rating: string;
  record: string;
  unlocks: string;
}>(`({
  rating: document.querySelector('.profile-readout > div:nth-child(1) strong')?.textContent ?? '',
  record: document.querySelector('.profile-readout > div:nth-child(2) strong')?.textContent ?? '',
  unlocks: document.querySelector('.profile-readout p')?.textContent ?? ''
})`);
if (
  profile.rating !== "1000" ||
  profile.record !== "0–0" ||
  !profile.unlocks.includes("6/12 Leaders")
)
  throw new Error(`Competitive profile failed: ${JSON.stringify(profile)}`);

await evaluate(`{
  const select = document.querySelector('.global-theme-switcher select');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, 'orbital-conflict');
  select.dispatchEvent(new Event('change', { bubbles: true }));
}`);
await new Promise((resolve) => setTimeout(resolve, 120));
const themedRoute = await evaluate<string>(
  `document.querySelector('.competitive-metrics article:last-child strong')?.textContent ?? ''`,
);
if (!themedRoute.includes("Hull") || !themedRoute.includes("Sector Control"))
  throw new Error(`Competitive theme terms failed: ${themedRoute}`);

socket.close();
console.log(JSON.stringify({ before, profile, themedRoute }, null, 2));
export {};
