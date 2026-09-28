import { Browser } from "./cdp.ts";

const web = (process.env.CARDFORGE_WEB_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const browser = await Browser.launch();
const studioPage = await browser.newPage(`${web}/studio`);
const send = <T>(method: string, params: object = {}): Promise<T> =>
  studioPage.send<T>(method, params);
const evaluate = <T>(expression: string): Promise<T> =>
  studioPage.evaluate<T>(expression);
await send("Runtime.enable");
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
  before.cards !== 181 ||
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

console.log(JSON.stringify({ before, after }, null, 2));

await browser.close();
