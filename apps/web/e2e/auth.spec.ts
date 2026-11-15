import { expect, test } from '@playwright/test';
import { ADMIN_PASSWORD } from './playwright.config';

// Everything here is a visitor with no session.
test.use({ storageState: { cookies: [], origins: [] } });

test('the back office asks for the password, and a renter does not need one', async ({
  page,
  request,
}) => {
  for (const path of ['/', '/underwriting', '/inbox', '/programs', '/developer', '/quality']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Back office');
  }
  // What the admin pages call is closed to a stranger as well.
  for (const path of ['/api/openapi', '/api/stream']) {
    expect((await request.get(path)).status(), path).toBe(401);
  }

  // The customer side is open.
  for (const path of ['/portals', '/p/FHV', '/p/RVT']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
  }
  await page.goto('/p/FHV');
  await expect(page.getByRole('link', { name: 'Other portals' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the console' })).toHaveCount(0);
});

test('a wrong password is refused, the right one signs in and goes where it was going, and signing out closes it again', async ({
  page,
}) => {
  await page.goto('/quality');
  await expect(page).toHaveURL(/\/login\?next=%2Fquality/);

  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Open the console' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not right' })).toBeVisible();

  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Open the console' }).click();
  await expect(page).toHaveURL(/\/quality$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'How often the automation is right',
  );

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/underwriting');
  await expect(page).toHaveURL(/\/login/);
});

test('a redirect target outside the site is ignored', async ({ page }) => {
  await page.goto('/login?next=https%3A%2F%2Fevil.example');
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Open the console' }).click();
  await expect(page).toHaveURL('/');
});

test('an anonymous visitor sees no way to play the underwriter on a referred quote', async ({
  page,
}) => {
  await page.goto('/p/FHV');
  await page.getByRole('button', { name: 'A contact sport', exact: true }).click();
  await page.getByRole('button', { name: 'Read my description' }).click();
  await page.getByLabel('Your name').fill('Pat Example');
  await page.getByLabel('E-mail').fill('pat@example.org');
  await page.getByRole('button', { name: 'Get my price' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'A person is looking at your event',
  );
  await expect(page.getByRole('link', { name: 'Open it on the underwriting desk' })).toHaveCount(0);
});

test('the answers carry the security headers, and only the page’s own scripts run', async ({
  page,
}) => {
  const refused: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) refused.push(message.text());
  });
  const response = await page.goto('/portals');
  const headers = (await response?.allHeaders()) ?? {};
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-powered-by']).toBeUndefined();
  const policy = headers['content-security-policy'] ?? '';
  // The portals open inside Telegram, so the policy names the one site that may frame them; nothing else can be framed.
  expect(policy).toContain("frame-ancestors 'self' https://web.telegram.org");
  const login = (await page.request.get('/login')).headers();
  expect(login['x-frame-options']).toBe('DENY');
  expect(login['content-security-policy']).toContain("frame-ancestors 'none'");
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  expect(nonce).toBeTruthy();

  // Every script the server wrote into the page carries this response's nonce; what those load is allowed through them.
  const tags = (await response?.text())?.match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) expect(tag).toContain(`nonce="${nonce}"`);
  // And once everything has loaded, the browser has refused nothing.
  await page.waitForLoadState('networkidle');
  expect(refused).toEqual([]);
});
