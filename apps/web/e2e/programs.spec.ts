import { expect, test } from '@playwright/test';

// A browser without the staff sign-in the project gives every context.
const NOBODY = { cookies: [], origins: [] };

test('a new program gets a working portal', async ({ page }) => {
  await page.goto('/programs/new');
  await page.getByLabel('Start from').selectOption('school_board');
  await page.getByLabel('Client name').fill('Lakeview Parks and Recreation');
  await page.getByLabel('Code').fill('LKV');
  await page.getByLabel('Province').selectOption('BC');
  await page.getByRole('button', { name: 'Create the program' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lakeview Parks and Recreation');

  await page.getByRole('link', { name: /Open the portal/ }).click();
  await expect(page).toHaveURL(/\/p\/LKV$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tell us about your event');
  await expect(page.locator('aside')).toContainText('Alcohol needs a person');

  // The same code cannot be used twice.
  await page.goto('/programs/new');
  await page.getByLabel('Client name').fill('Another');
  await page.getByLabel('Code').fill('LKV');
  await page.getByRole('button', { name: 'Create the program' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Client name')).toHaveValue('Another');
});

test('a letter becomes a draft, a preview and a published version', async ({ page }) => {
  await page.goto('/programs');
  await page.getByRole('link', { name: 'Riverton School Board', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Riverton School Board');
  const versions = page.getByRole('region', { name: 'Rule versions' });
  await expect(versions).toContainText('v1');

  await page.getByRole('button', { name: 'A hall, with an instruction slipped in' }).click();
  await page.getByRole('button', { name: 'Draft the rules' }).click();
  const draft = page.getByRole('region', { name: 'Step 2: the draft and its effect' });
  await expect(draft).toContainText('Largest crowd priced unseen');
  await expect(draft).toContainText('120 people');
  await expect(draft).toContainText('$5M');
  // The instruction slipped into the letter did not become a rule.
  await expect(draft).not.toContainText('Confidence needed');

  await page.getByRole('button', { name: /See what it would change/ }).click();
  await expect(page.getByTestId('preview')).toContainText('quotes');

  // Nothing is in force yet.
  await expect(versions).not.toContainText('v2');
  await page.getByRole('button', { name: 'Publish these rules' }).click();
  await expect(page.getByRole('status')).toContainText('Published as version 2');
  await expect(versions).toContainText('v2');
  await page.goto('/p/RVT');
  await expect(page.locator('aside')).toContainText('Up to 120 people');
});

test('a new client goes from a hidden draft to a public portal through its checklist', async ({
  page,
  browser,
}) => {
  await page.goto('/programs/new');
  await page.getByLabel('Client name').fill('Harbourside Halls');
  await page.getByLabel('Code').fill('HBH');
  await page.getByRole('button', { name: 'Create the program' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbourside Halls');
  const launch = page.getByRole('region', { name: 'Launch' });
  await expect(launch).toContainText('Draft: only staff can see the portal');

  // A stranger finds nothing at the address while it is a draft.
  const stranger = await (await browser.newContext({ storageState: NOBODY })).newPage();
  const portal = new URL('/p/HBH', page.url()).toString();
  await stranger.goto(portal);
  await expect(stranger.getByRole('heading', { level: 1 })).toHaveText(
    'There is nothing at this address',
  );

  await launch.getByRole('button', { name: 'Move to test' }).click();
  await expect(launch.getByRole('button', { name: 'Open to the public' })).toBeDisabled();

  const look = page.getByRole('region', { name: 'Appearance' });
  await look.getByLabel('Colour as #rrggbb').fill('#f5c518');
  await expect(look).toContainText('Too light');
  await expect(look.getByRole('button', { name: 'Save the appearance' })).toBeDisabled();
  await look.getByRole('button', { name: 'Use #0f5c4a' }).click();
  await look.getByLabel('Tagline').fill('Halls on the water');
  await expect(look.getByRole('figure', { name: 'Preview of the portal' })).toContainText(
    'Halls on the water',
  );
  await look.getByRole('button', { name: 'Save the appearance' }).click();
  await expect(look.getByRole('status')).toContainText('Saved');

  const contacts = page.getByRole('region', { name: 'Contacts' });
  await contacts.getByLabel('Support e-mail').fill('help@harbourside.example');
  await contacts.getByLabel('Telegram').fill('harbourside_help_bot');
  await contacts.getByRole('button', { name: 'Save the contacts' }).click();
  await expect(contacts.getByRole('status')).toContainText('Saved');

  await launch.getByRole('button', { name: 'Open to the public' }).click();
  await expect(launch).toContainText('Live: the portal is public');
  await expect(page.getByRole('region', { name: 'Change log' })).toContainText('In test → Live');

  await stranger.goto(portal);
  await expect(stranger.getByText('Halls on the water')).toBeVisible();
  await expect(
    stranger.getByRole('link', { name: '@harbourside_help_bot on Telegram' }),
  ).toBeVisible();
  const edge = await stranger
    .locator('header')
    .first()
    .evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(edge).toBe('rgb(15, 92, 74)');

  await launch.getByRole('button', { name: 'Pause new business' }).click();
  await expect(launch).toContainText('Paused');
  await stranger.reload();
  await expect(stranger.getByText('New quotes are closed for now')).toBeVisible();
  await stranger.context().close();
});

test('a portal counts a visitor once a day, and the hub shows it', async ({ page, browser }) => {
  await page.goto('/programs');
  const visitors = async () => {
    const row = page.getByRole('row').filter({ hasText: 'FHV' });
    return Number((await row.getByRole('cell').nth(3).textContent())?.replaceAll(',', ''));
  };
  const before = await visitors();

  // A browser no other test uses, so this visitor is new today.
  const stranger = await (
    await browser.newContext({
      storageState: NOBODY,
      userAgent: `Mozilla/5.0 visitor-${Date.now()}`,
    })
  ).newPage();
  const portal = new URL('/p/FHV', page.url()).toString();
  await stranger.goto(portal);
  await stranger.goto(portal);
  await stranger.context().close();

  await expect
    .poll(async () => {
      await page.reload();
      return visitors();
    })
    .toBe(before + 1);
});
