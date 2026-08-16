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
interface Seat {
  readonly seat: string;
  readonly room: string;
  readonly command: string;
  readonly hand: number;
  readonly hash: string;
  readonly connection: string;
  readonly error: string;
}

async function connect(endpoint: string) {
  const targets = (await (await fetch(`${endpoint}/json`)).json()) as Target[];
  const page = targets.find(
    (target) => target.type === "page" && target.url.includes("/online"),
  );
  if (!page) throw new Error(`Online page missing at ${endpoint}`);
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
  return { socket, evaluate };
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
async function readSeat(browser: Awaited<ReturnType<typeof connect>>) {
  return browser.evaluate<Seat>(`({
    seat: document.querySelector('.online-shell')?.getAttribute('data-seat') ?? '',
    room: document.querySelector('.online-shell')?.getAttribute('data-room') ?? '',
    command: document.querySelector('.online-shell')?.getAttribute('data-command') ?? '',
    hand: document.querySelectorAll('.online-hand .hand-card').length,
    hash: document.querySelector('.online-scorebar code')?.textContent ?? '',
    connection: document.querySelector('.online-shell')?.getAttribute('data-connection') ?? ''
    ,error: document.querySelector('.online-error')?.textContent ?? ''
  })`);
}

const first = await connect(
  process.env.CARDFORGE_CDP_ONE ?? "http://127.0.0.1:9222",
);
const second = await connect(
  process.env.CARDFORGE_CDP_TWO ?? "http://127.0.0.1:9223",
);
await Promise.all(
  [first, second].map((browser) =>
    browser.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const button = document.querySelector('.online-connect');
        if (button && !button.disabled) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - started > 5000) {
          clearInterval(timer);
          reject(new Error('Saved deck provisioning timed out'));
        }
      }, 50);
    })`),
  ),
);
await first.evaluate(`document.querySelector('.online-connect')?.click()`);
await delay(250);
await second.evaluate(`document.querySelector('.online-connect')?.click()`);
await delay(700);
const before = [await readSeat(first), await readSeat(second)] as const;
if (
  before[0].seat !== "p1" ||
  before[1].seat !== "p2" ||
  !before[0].room ||
  before[0].room !== before[1].room ||
  before[0].hash !== before[1].hash ||
  before[0].hand !== 5 ||
  before[1].hand !== 5 ||
  before.some((item) => item.connection !== "connected")
)
  throw new Error(`Online seats failed: ${JSON.stringify(before)}`);

await first.evaluate(`{
  const action = [...document.querySelectorAll('.online-actions .action-button')]
    .find((button) => button.textContent?.includes('Lock opening hand (0 out)'));
  action?.click();
}`);
await delay(450);
const after = [await readSeat(first), await readSeat(second)] as const;
if (
  after.some((item) => item.command !== "1") ||
  after[0].hash !== after[1].hash ||
  after[0].hash === before[0].hash
)
  throw new Error(`Online synchronization failed: ${JSON.stringify(after)}`);

first.socket.close();
second.socket.close();
console.log(JSON.stringify({ before, after }, null, 2));
export {};
