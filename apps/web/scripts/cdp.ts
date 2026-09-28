/**
 * Minimal Chrome DevTools Protocol driver for browser smokes. It launches a
 * headless Chromium (or attaches to CARDFORGE_CDP_URL) and exposes just what
 * the smokes need, keeping the repository free of a browser-automation
 * dependency.
 *
 * Chromium is found via CARDFORGE_CHROME_PATH, then common install paths.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CdpEnvelope {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string;
  readonly error?: { readonly message: string };
  readonly result?: unknown;
}

const candidates = [
  process.env.CARDFORGE_CHROME_PATH,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((path): path is string => Boolean(path));

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Browser {
  #socket!: WebSocket;
  #nextId = 1;
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  readonly #listeners: ((message: CdpEnvelope) => void)[] = [];
  #process: ChildProcess | null = null;
  #profile: string | null = null;

  static async launch(): Promise<Browser> {
    const browser = new Browser();
    let endpoint = process.env.CARDFORGE_CDP_URL;
    if (!endpoint) {
      const executable = candidates.find((path) => existsSync(path));
      if (!executable)
        throw new Error("Chromium not found. Set CARDFORGE_CHROME_PATH.");
      browser.#profile = mkdtempSync(join(tmpdir(), "cardforge-smoke-"));
      const port = 9300 + Math.floor(Math.random() * 500);
      browser.#process = spawn(
        executable,
        [
          "--headless=new",
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${browser.#profile}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-gpu",
          "--use-gl=swiftshader",
          "--enable-unsafe-swiftshader",
          ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
          "about:blank",
        ],
        { stdio: "ignore" },
      );
      endpoint = `http://127.0.0.1:${port}`;
    }
    let version: { webSocketDebuggerUrl: string } | null = null;
    for (let attempt = 0; attempt < 60 && !version; attempt += 1) {
      try {
        version = (await (await fetch(`${endpoint}/json/version`)).json()) as {
          webSocketDebuggerUrl: string;
        };
      } catch {
        await delay(250);
      }
    }
    if (!version) throw new Error(`Chromium did not expose CDP at ${endpoint}`);
    browser.#socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      browser.#socket.addEventListener("open", () => resolve(), { once: true });
      browser.#socket.addEventListener(
        "error",
        () => reject(new Error("CDP socket failed")),
        { once: true },
      );
    });
    browser.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpEnvelope;
      if (message.id) {
        const callback = browser.#pending.get(message.id);
        browser.#pending.delete(message.id);
        if (message.error) callback?.reject(new Error(message.error.message));
        else callback?.resolve(message.result);
        return;
      }
      for (const listener of browser.#listeners) listener(message);
    });
    return browser;
  }

  send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = this.#nextId++;
    this.#socket.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    );
    return new Promise<T>((resolve, reject) =>
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      }),
    );
  }

  onEvent(listener: (message: CdpEnvelope) => void): void {
    this.#listeners.push(listener);
  }

  /** Opens a page in a fresh browser context (separate cookies). */
  async newPage(
    url: string,
    viewport = { width: 1440, height: 900 },
  ): Promise<Page> {
    const { browserContextId } = await this.send<{ browserContextId: string }>(
      "Target.createBrowserContext",
    );
    const { targetId } = await this.send<{ targetId: string }>(
      "Target.createTarget",
      {
        url: "about:blank",
        browserContextId,
      },
    );
    const { sessionId } = await this.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true },
    );
    const page = new Page(this, sessionId);
    await page.send("Runtime.enable");
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    this.onEvent((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.exceptionThrown")
        page.errors.push(JSON.stringify(message.params).slice(0, 300));
    });
    await page.goto(url);
    return page;
  }

  async close(): Promise<void> {
    this.#socket.close();
    this.#process?.kill();
    if (this.#profile) {
      await delay(300);
      rmSync(this.#profile, { recursive: true, force: true });
    }
  }
}

export class Page {
  readonly errors: string[] = [];
  readonly browser: Browser;
  readonly sessionId: string;

  constructor(browser: Browser, sessionId: string) {
    this.browser = browser;
    this.sessionId = sessionId;
  }

  send<T>(method: string, params: object = {}): Promise<T> {
    return this.browser.send<T>(method, params, this.sessionId);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send<{
      exceptionDetails?: {
        text?: string;
        exception?: { description?: string };
      };
      result: { value: T };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails)
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          "evaluation failed",
      );
    return response.result.value;
  }

  async goto(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'");
  }

  /** Polls a boolean expression until true. */
  async waitFor(
    expression: string,
    timeoutMs = 20_000,
    label = expression,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate<boolean>(`Boolean(${expression})`)) return;
      } catch {
        // The page may be mid-navigation.
      }
      await delay(120);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  waitForSelector(selector: string, timeoutMs?: number): Promise<void> {
    return this.waitFor(
      `document.querySelector(${JSON.stringify(selector)})`,
      timeoutMs,
      selector,
    );
  }

  async click(selector: string): Promise<void> {
    await this.waitForSelector(selector);
    await this.evaluate(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );
  }

  /** Clicks the first element matching selector whose text includes text. */
  async clickText(selector: string, text: string): Promise<void> {
    const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.textContent.includes(${JSON.stringify(text)}))`;
    await this.waitFor(expression, 20_000, `${selector} containing "${text}"`);
    await this.evaluate(`${expression}.click()`);
  }

  /** Sets an input's value the way React observes user typing. */
  async fill(selector: string, value: string): Promise<void> {
    await this.waitForSelector(selector);
    await this.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
  }

  text(selector: string): Promise<string> {
    return this.evaluate<string>(
      `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`,
    );
  }

  attribute(selector: string, name: string): Promise<string | null> {
    return this.evaluate<string | null>(
      `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`,
    );
  }

  url(): Promise<string> {
    return this.evaluate<string>("location.href");
  }
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Browser smoke failed: ${message}`);
}
