import { expect, type Page, test } from '@playwright/test';
import { askForPrice, describeEvent } from './steps';

const cents = (text: string | null) =>
  Math.round(Number((text ?? '').replace(/[^0-9.]/g, '')) * 100);
// The first amount of money in a piece of the page, found by what it says and not by how it is styled.
const firstAmount = (text: string | null) => cents(/\$[\d,]+\.\d{2}/.exec(text ?? '')?.[0] ?? null);

// A hockey game is class C, which this program does not price unseen: the renter ends up waiting for a person.
// Returns the address of the renter's page and the indicative price shown on it.
async function referredEvent(page: Page) {
  await describeEvent(page, 'A contact sport');
  await askForPrice(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'A person is looking at your event',
  );
  const indicative = firstAmount(
    await page.getByRole('region', { name: 'Indicative price' }).textContent(),
  );
  expect(indicative).toBeGreaterThan(0);
  return { renterUrl: page.url(), indicative };
}

async function takeIt(page: Page) {
  await page.getByRole('link', { name: 'Open it on the underwriting desk' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ice hockey game');
  await page.getByRole('button', { name: 'Take this referral' }).click();
  await expect(page.getByLabel('Note for the file')).toBeVisible();
}

test('an underwriter approves with an override and the renter sees the new price', async ({
  page,
}) => {
  const { renterUrl, indicative } = await referredEvent(page);
  await takeIt(page);

  // The worksheet starts from the rate card and shows what the customer would pay.
  const worksheet = page.getByRole('region', { name: 'Pricing worksheet' });
  await expect(worksheet).toContainText('Rate card premium');
  await expect(worksheet).toContainText('What the customer would pay');

  await page.getByLabel('Approve in another risk class').check();
  await page.getByLabel('Price it as').selectOption('B');
  await page
    .getByLabel('Note for the file')
    .fill('A friendly game, no checking: class B is right.');
  await page.getByRole('button', { name: 'Approve' }).click();

  const decision = page.getByRole('region', { name: 'Decision', exact: true });
  await expect(decision).toContainText('Approved, class changed');
  await expect(decision).toContainText('A friendly game');

  await page.goto(renterUrl);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your price is $');
  const price = cents(await page.getByRole('heading', { level: 1 }).textContent());
  expect(price).toBeLessThan(indicative);
  // Payable now: the payment card asks a renter who is not signed in for an account first.
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Create an account' }),
  ).toBeVisible();
});

test('a declined referral shows as declined to the renter', async ({ page }) => {
  const { renterUrl } = await referredEvent(page);
  await takeIt(page);
  await page.getByLabel('Decline').check();
  await page.getByLabel('Note for the file').fill('The ice is not maintained to standard.');
  await page.getByRole('button', { name: 'Decline the event' }).click();
  await expect(page.getByRole('region', { name: 'Decision', exact: true })).toContainText(
    'Declined',
  );

  await page.goto(renterUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'We cannot offer cover for this event',
  );
  await expect(page.getByRole('button', { name: /^Pay/ })).toHaveCount(0);
});

test('a worksheet line is changed with a reason, and the customer’s price follows', async ({
  page,
}) => {
  const { indicative } = await referredEvent(page);
  await takeIt(page);

  // An amount without a reason is refused, and what was typed stays in the form.
  await page.getByLabel('New amount for Vendors, in dollars').fill('25');
  await page.getByLabel('Note for the file').fill('Two food vendors will be on site.');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Say why' })).toBeVisible();
  await expect(page.getByLabel('New amount for Vendors, in dollars')).toHaveValue('25');

  await page.getByLabel(/^Vendors \(now/).fill('Two food vendors');
  await page.getByRole('button', { name: 'Approve' }).click();
  const decision = page.getByRole('region', { name: 'Decision', exact: true });
  await expect(decision).toContainText('Approved');
  const price = firstAmount(
    await decision.locator('p', { hasText: 'The customer’s price' }).textContent(),
  );
  expect(price).toBeGreaterThan(indicative);

  // The worksheet keeps both amounts and the reason.
  const worksheet = page.getByRole('region', { name: 'Pricing worksheet' });
  await expect(worksheet).toContainText('Changed: Two food vendors');
  await expect(worksheet).toContainText('$25.00');
});

test('the queue shows a referral with its reasons, then lists it as decided', async ({ page }) => {
  await referredEvent(page);
  await page.goto('/underwriting');
  const waiting = page.getByRole('row').filter({ hasText: 'Ice hockey game' }).first();
  await expect(waiting).toContainText('A program rule asks for a person');
  await expect(waiting).toContainText('Open');
  await expect(waiting).toContainText('FHV');

  await waiting.getByRole('link', { name: 'Ice hockey game' }).click();
  await page.getByRole('button', { name: 'Take this referral' }).click();
  await page.getByLabel('Decline').check();
  await page.getByLabel('Note for the file').fill('Declined for the queue test.');
  await page.getByRole('button', { name: 'Decline the event' }).click();
  await expect(page.getByRole('region', { name: 'Decision', exact: true })).toContainText(
    'Declined',
  );

  await page.goto('/underwriting?view=decided');
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'Ice hockey game' })
      .filter({ hasText: 'Declined' })
      .first(),
  ).toBeVisible();
});

test('the renter’s page changes by itself when the underwriter decides', async ({
  page,
  context,
}) => {
  const { renterUrl } = await referredEvent(page);
  const referral = await page
    .getByRole('link', { name: 'Open it on the underwriting desk' })
    .getAttribute('href');

  // The underwriter works in another tab; the renter's tab is left alone.
  const desk = await context.newPage();
  await desk.goto(referral ?? '');
  await desk.getByRole('button', { name: 'Take this referral' }).click();
  await desk.getByLabel('Approve in another risk class').check();
  await desk.getByLabel('Price it as').selectOption('B');
  await desk.getByLabel('Note for the file').fill('Fine in class B.');
  await desk.getByRole('button', { name: 'Approve' }).click();
  await expect(desk.getByRole('region', { name: 'Decision', exact: true })).toContainText(
    'Approved',
  );

  expect(page.url()).toBe(renterUrl);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your price is $');
});
