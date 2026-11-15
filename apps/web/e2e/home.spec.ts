import { expect, test } from '@playwright/test';

test('the home page names the areas and links to each', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'A sentence in, a policy out',
  );

  const areas = page.getByRole('navigation', { name: 'Areas' });
  for (const [name, href] of [
    ['Tour', '/'],
    ['Underwriting', '/underwriting'],
    ['Inbox', '/inbox'],
    ['Programs', '/programs'],
    ['Developer', '/developer'],
    ['Quality', '/quality'],
  ] as const) {
    await expect(areas.getByRole('link', { name })).toHaveAttribute('href', href);
  }
  await expect(areas.getByRole('link', { name: 'Tour' })).toHaveAttribute('aria-current', 'page');

  // Every seeded program has its own portal, and the tour starts at the first one.
  for (const code of ['FHV', 'RVT', 'SAB']) {
    await expect(page.locator(`a[href="/p/${code}"]`).first()).toBeVisible();
  }
  await expect(page.getByRole('link', { name: /Start as a renter/ })).toHaveAttribute(
    'href',
    '/p/FHV',
  );
});

test('an address that does not exist says so', async ({ page }) => {
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'There is nothing at this address',
  );
});
