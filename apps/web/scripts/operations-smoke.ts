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
  process.env.CARDFORGE_CDP_OPERATIONS ?? "http://127.0.0.1:9228";
const targets = (await (await fetch(`${endpoint}/json`)).json()) as Target[];
const page = targets.find(
  (target) => target.type === "page" && target.url.includes("/operations"),
);
if (!page) throw new Error("Operations page is not open in Chromium");
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
await new Promise((resolve) => setTimeout(resolve, 250));
await evaluate(
  `document.querySelector('.operations-header .button--primary')?.click()`,
);
await new Promise((resolve) => setTimeout(resolve, 600));
const result = await evaluate<{
  title: string;
  status: string;
  panels: number;
  flags: number;
  revisions: number;
  cases: number;
  audit: number;
}>(`({
  title: document.querySelector('.operations-header h1')?.textContent ?? '',
  status: document.querySelector('.operations-header p:last-child')?.textContent ?? '',
  panels: document.querySelectorAll('.operations-panel').length,
  flags: document.querySelectorAll('.flag-grid label').length,
  revisions: document.querySelectorAll('.revision-list span').length,
  cases: document.querySelectorAll('.support-list article').length,
  audit: document.querySelectorAll('.audit-list li').length
})`);
if (
  result.title !== "Control room." ||
  !result.status.includes("audited actions") ||
  result.panels !== 4 ||
  result.flags < 6 ||
  result.revisions < 3 ||
  result.cases < 1 ||
  result.audit < 3
)
  throw new Error(`Operations page failed: ${JSON.stringify(result)}`);
socket.close();
console.log(JSON.stringify(result, null, 2));
export {};
