import { expect, test } from '@playwright/test';

// A browser without the staff sign-in the project gives every context.
const NOBODY = { cookies: [], origins: [] };

test('a client console link shows its own program and stops when turned off', async ({
  page,
  browser,
}) => {
  await page.goto('/programs/prg_2');
  const card = page.getByRole('region', { name: 'Client console' });
  await card.getByLabel('Who it is for').fill('Facilities office');
  await card.getByRole('button', { name: 'Make a link' }).click();
  const field = card.getByLabel('Client console link');
  await expect(field).toHaveValue(/\/c\/RVT\/open\?key=ca_/);
  const link = await field.inputValue();

  const client = await (await browser.newContext({ storageState: NOBODY })).newPage();
  await client.goto(link);
  await expect(client).toHaveURL(/\/c\/RVT$/); // the secret left the address bar
  await expect(client.getByRole('heading', { level: 1 })).toHaveText('Riverton School Board');
  await expect(client.getByText('opened with the link “Facilities office”')).toBeVisible();
  for (const name of ['Last 30 days', 'Policies', 'Conversations']) {
    await expect(client.getByRole('region', { name })).toBeVisible();
  }
  // Another program's console is not opened by this link.
  await client.goto(new URL('/c/FHV', link).toString());
  await expect(client.getByRole('heading', { level: 1 })).toHaveText(
    'This link does not open a console',
  );

  await page.reload();
  await card
    .getByRole('listitem')
    .filter({ hasText: 'Facilities office' })
    .getByRole('button', { name: 'Turn off' })
    .click();
  await expect(card.getByText('Turned off')).toBeVisible();
  await client.goto(new URL('/c/RVT', link).toString());
  await expect(client.getByRole('heading', { level: 1 })).toHaveText(
    'This link does not open a console',
  );
  await client.context().close();
});

test('one line on a venue’s website adds a button that opens the portal', async ({
  browser,
  baseURL,
}) => {
  const stranger = await (await browser.newContext({ storageState: NOBODY })).newPage();
  await stranger.goto(`${baseURL}/embed/demo/FHV`);
  const button = stranger.getByRole('link', { name: 'Insure your event' });
  await expect(button).toHaveAttribute('href', /\/p\/FHV$/);
  await expect(button).toHaveAttribute('target', '_blank');

  const script = await stranger.request.get(`${baseURL}/embed/FHV.js`);
  expect(script.headers()['content-type']).toContain('javascript');
  expect(script.headers()['cross-origin-resource-policy']).toBe('cross-origin');
  expect((await stranger.request.get(`${baseURL}/embed/ZZZ.js`)).status()).toBe(404);
  await stranger.context().close();
});
