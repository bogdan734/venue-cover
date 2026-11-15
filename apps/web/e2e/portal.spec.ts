import { expect, test } from '@playwright/test';
import { askForPrice, describeEvent, signUpToPay } from './steps';

const cents = (text: string | null) =>
  Math.round(Number((text ?? '').replace(/[^0-9.]/g, '')) * 100);

test('a renter buys a policy from a description', async ({ page }) => {
  await describeEvent(page, 'A simple one');
  await expect(page.getByText('Can be priced on the spot.')).toBeVisible();
  await expect(page.getByLabel('Matched')).toHaveCount(1);
  await expect(page.getByLabel('Activity')).toContainText('Yoga class');
  await expect(page.getByLabel('People')).toHaveValue('20');
  await expect(page.getByLabel('Hours')).toHaveValue('2');

  await askForPrice(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your price is $');

  // The parts of the premium are on the page and add up to the total.
  const split = page.getByRole('region', { name: 'Where the premium goes' }).locator('table');
  const parts = await split.locator('tbody td').allTextContents();
  expect(parts).toHaveLength(5);
  const total = cents(await split.locator('tfoot td').textContent());
  expect(parts.reduce((sum, part) => sum + cents(part), 0)).toBe(total);
  expect(total).toBeGreaterThan(1000);

  await signUpToPay(page);
  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /You are covered\. Policy FHV-\d{6}/,
  );

  // No booking reference was given, so only the insured has a certificate, and the page says why.
  const certificates = page
    .getByRole('region', { name: 'Certificates of insurance' })
    .getByRole('link');
  await expect(certificates).toHaveCount(1);
  await expect(page.getByText('No booking reference identified the booking')).toBeVisible();
  const href = await certificates.first().getAttribute('href');
  const pdf = await page.request.get(href ?? '');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('a booking reference gives the venue and its broker their certificates', async ({ page }) => {
  await describeEvent(page, 'A simple one');
  await askForPrice(page, { rental: 'R-1001' });
  await signUpToPay(page);
  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('You are covered');
  const certificates = page.getByRole('region', { name: 'Certificates of insurance' });
  await expect(certificates.getByRole('link')).toHaveCount(3);
  await expect(certificates).toContainText('Fairhaven Arena');
  await expect(certificates).toContainText('Northgate Brokerage');
});

test('a risky description goes to review and shows the reasons', async ({ page }) => {
  await describeEvent(page, 'A contact sport');
  await expect(page.getByText('A program rule asks for a person.')).toBeVisible();
  await askForPrice(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'A person is looking at your event',
  );
  await expect(page.getByText('A program rule asks for a person.')).toBeVisible();
  await expect(page.getByText('Indicative price')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pay/ })).toHaveCount(0);
});

test('a text that tries to instruct the model is still referred', async ({ page }) => {
  await describeEvent(page, 'Tries to talk the model round');
  // The model was told to call it a five-person class A event; the page shows a hockey game in class C.
  await expect(page.getByLabel('Activity')).toContainText('Ice hockey game (class C)');
  await expect(page.getByLabel('People')).toHaveValue('40');
  await expect(page.getByText('Can be priced on the spot.')).toHaveCount(0);
});

test('a declined card leaves the quote payable', async ({ page }) => {
  await describeEvent(page, 'A simple one');
  await askForPrice(page);
  await signUpToPay(page);
  await page.getByLabel('A card that is declined').check();
  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'declined' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your price is $');

  await page.getByLabel('A card that is approved').check();
  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('You are covered');
});

test('the program’s questions follow the details the renter confirms', async ({ page }) => {
  await describeEvent(page, 'A simple one');
  const question = page.getByLabel(
    'Will everyone who serves alcohol hold a recognised server certificate?',
  );
  await expect(question).toHaveCount(0);
  await page.getByLabel('Alcohol').selectOption('served');
  await expect(question).toBeVisible();
  await question.selectOption('no');
  await askForPrice(page);
  // The answer is one the program flags, so a person looks at it.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'A person is looking at your event',
  );
});

test('each program’s portal states its own rules, and an unknown program has none', async ({
  page,
}) => {
  await page.goto('/p/RVT');
  const rules = page.locator('aside');
  await expect(rules).toContainText('Alcohol needs a person');
  await expect(rules).toContainText('Up to 200 people');
  await expect(rules).toContainText('Limits offered: $2M');
  await expect(rules).not.toContainText('$5M');

  const missing = await page.goto('/p/NOPE');
  expect(missing?.status()).toBe(404);
});

test('a loss can be reported on a policy, and a date outside its period is refused', async ({
  page,
}) => {
  await describeEvent(page, 'A simple one');
  await askForPrice(page);
  await signUpToPay(page);
  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('You are covered');

  await page.getByLabel('What happened').fill('A guest slipped near the door and hurt a wrist.');
  await page.getByLabel('Day of the loss').fill('2020-01-01');
  await page.getByRole('button', { name: 'Report the loss' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'covers' })).toBeVisible();
  // What was typed is still there to correct.
  await expect(page.getByLabel('What happened')).toHaveValue(/slipped near the door/);

  const covered = (await page.getByLabel('Day of the loss').getAttribute('value')) ?? '';
  expect(covered).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByLabel('Day of the loss').fill(covered);
  await page.getByRole('button', { name: 'Report the loss' }).click();
  await expect(page.getByRole('status')).toContainText(/Your notice was recorded as clm_/);
});

test('inside Telegram the portal opens as a Mini App: ready, full height, in its own colours', async ({
  page,
}) => {
  // What Telegram's apps put in the page: a channel for the Mini App's events, here recording them.
  await page.addInitScript(() => {
    const seen: [string, unknown][] = [];
    Object.assign(window, {
      seen,
      TelegramWebviewProxy: {
        postEvent: (type: string, data: string) => seen.push([type, JSON.parse(data)]),
      },
    });
  });
  await page.goto('/p/FHV#tgWebAppData=query_id%3DAAH&tgWebAppVersion=8.0');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tell us about your event');
  // The first four: in development React runs an effect twice, and Telegram takes a repeat in its stride.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { seen: unknown[] }).seen.slice(0, 4)))
    .toEqual([
      ['web_app_ready', {}],
      ['web_app_expand', {}],
      ['web_app_set_header_color', { color: '#162033' }],
      ['web_app_set_background_color', { color: '#f5f7fa' }],
    ]);
});
