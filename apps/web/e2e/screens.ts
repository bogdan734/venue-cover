import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { askForPrice, describeEvent, signUpToPay } from './steps';

// Takes the screenshots in docs/media from a running demo: `TOUR_URL=http://127.0.0.1:3100 ADMIN_PASSWORD=… node --import
// tsx e2e/screens.ts`. It drives the same pages a visitor does, so every picture is of the real thing. The film is shot by
// e2e/film.ts and made by scripts/media.
const base = process.env.TOUR_URL ?? 'http://127.0.0.1:3100';
const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error('ADMIN_PASSWORD is required to sign in to the back office');
const out = new URL('../../../docs/media/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 760 } });
const page = await context.newPage();
// A screenshot once the page's entrance animations have finished.
const shot = async (name: string) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}${name}.png` });
};

await page.goto('/portals');
await shot('portals');

// A renter describes an event and pays.
await describeEvent(page, 'A simple one', 'FHV');
await shot('read');
await askForPrice(page);
await page.waitForURL(/\/quote\//);
const priceUrl = page.url();
await signUpToPay(page);
await page.getByRole('button', { name: /^Pay \$/ }).click();
await page.getByRole('heading', { level: 1 }).filter({ hasText: 'You are covered' }).waitFor();
await shot('policy');

// The same price on a phone, for someone who is not signed in.
const phone = await browser.newContext({
  baseURL: base,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const phonePage = await phone.newPage();
await phonePage.goto(priceUrl);
await phonePage.getByRole('heading', { level: 1 }).waitFor();
await phonePage.waitForTimeout(1200);
await phonePage.screenshot({ path: `${out}phone.png` });
await phone.close();

// Something unusual goes to a person, who decides it from the worksheet.
await describeEvent(page, 'A contact sport', 'FHV');
await askForPrice(page);
await page.getByRole('heading', { level: 1 }).filter({ hasText: 'A person is looking' }).waitFor();
const renterUrl = page.url();
await shot('referred');
await page.goto('/login');
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Open the console' }).click();
await page.waitForURL('/');
await page.goto(renterUrl);
await page.getByRole('link', { name: 'Open it on the underwriting desk' }).click();
await page.getByRole('button', { name: 'Take this referral' }).click();
await page.mouse.wheel(0, 520);
await shot('worksheet');

// The back office.
for (const [path, name] of [
  ['/programs', 'hub'],
  ['/programs/prg_3', 'client'],
  ['/inbox', 'inbox'],
  ['/quality', 'quality'],
] as const) {
  await page.goto(path);
  if (name === 'client') await page.mouse.wheel(0, 380);
  await shot(name);
}

await browser.close();
console.log('screenshots written to', out);
