import { expect, test } from '@playwright/test';
import { askForPrice, describeEvent, signUpToPay } from './steps';

async function buy(page: import('@playwright/test').Page) {
  await describeEvent(page, 'A simple one');
  await askForPrice(page);
  await signUpToPay(page);
  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('You are covered');
  return (
    (await page.getByRole('heading', { level: 1 }).textContent())?.match(/FHV-\d{6}/)?.[0] ?? ''
  );
}

test('a new policy appears in the feed', async ({ page, context }) => {
  await page.goto('/developer');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  const portal = await context.newPage();
  const policy = await buy(portal);
  const feed = page.getByRole('region', { name: 'Live events' });
  await expect(feed.getByRole('list', { name: 'Events' })).toContainText('policy.issued');
  await expect(feed).toContainText(policy);
});

test('a failed delivery can be replayed', async ({ page }) => {
  await page.goto('/developer?program=prg_1');
  const endpoints = page.getByRole('region', { name: /^Webhook endpoints/ });
  await endpoints.getByRole('button', { name: '…/flaky' }).click();
  await endpoints.getByRole('button', { name: 'Register endpoint' }).click();
  await expect(endpoints.getByRole('status')).toContainText('whsec_');
  await expect(endpoints).toContainText('/flaky');

  // The address that is not allowed is refused with the reason.
  await endpoints.getByLabel('Receiver URL').fill('http://hooks.example.test/plain');
  await endpoints.getByRole('button', { name: 'Register endpoint' }).click();
  await expect(endpoints.getByRole('alert')).toBeVisible();

  const portal = await page.context().newPage();
  await buy(portal);

  const deliveries = page.getByRole('region', { name: 'Deliveries' });
  const row = deliveries
    .getByRole('row')
    .filter({ hasText: 'policy.issued' })
    .filter({ hasText: 'flaky' })
    .first();
  // The relay and the delivery worker run in the background, so the page is read again until the refusal is there.
  await expect(async () => {
    await page.reload();
    await expect(row).toContainText('dead');
  }).toPass({ timeout: 20_000 });
  await expect(row).toContainText('410');

  await row.getByRole('button', { name: /Send delivery .* again/ }).click();
  await expect(async () => {
    await page.reload();
    await expect(deliveries.getByRole('row').filter({ hasText: 'flaky' }).first()).toContainText(
      'delivered',
    );
  }).toPass({ timeout: 20_000 });
});

test('the GraphQL box answers and the API reference lists the operations', async ({ page }) => {
  await page.goto('/developer');
  await page.getByRole('button', { name: 'Search the catalogue' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('answer')).toContainText('Fireworks display');

  const reference = page.getByRole('region', { name: 'API reference' });
  await expect(reference).toContainText('/v1/quotes');
  await expect(reference).toContainText('/v1/reports/policies');
  const spec = await page.request.get('/api/openapi');
  expect((await spec.json()).paths['/v1/quotes']).toBeTruthy();
});

test('a test event checks a receiver, and the call shows in the request log', async ({ page }) => {
  await page.goto('/developer?program=prg_3');
  const endpoints = page.getByRole('region', { name: /^Webhook endpoints/ });
  await endpoints.getByLabel('Receiver URL').fill('https://hooks.example.com/sab-test');
  await endpoints.getByRole('button', { name: 'Register endpoint' }).click();
  await expect(endpoints).toContainText('/sab-test');

  await endpoints
    .getByRole('button', { name: 'Send a test event to https://hooks.example.com/sab-test' })
    .click();
  const deliveries = page.getByRole('region', { name: 'Deliveries' });
  await expect
    .poll(
      async () => {
        await page.reload();
        return deliveries.getByRole('row').filter({ hasText: 'webhook.test' }).count();
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole('region', { name: 'Recent requests' })).toContainText(
    'POST /v1/webhook-endpoints/:id/test',
  );
});
