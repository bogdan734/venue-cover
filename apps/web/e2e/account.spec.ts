import { expect, test } from '@playwright/test';
import {
  askForPrice,
  confirmFromInbox,
  describeEvent,
  PASSWORD,
  register,
  signUpToPay,
} from './steps';

test('a renter with an account is the insured, pays, and finds the policy and its certificate there', async ({
  page,
}) => {
  await page.goto('/p/FHV');
  const nav = page.getByRole('navigation', { name: 'Your account' });
  await nav.getByRole('link', { name: 'Create an account' }).click();
  const email = await register(page);
  await confirmFromInbox(page);
  await expect(page.getByRole('status').filter({ hasText: 'confirmed' })).toBeVisible();

  // The insured is the renter unless they say otherwise.
  await describeEvent(page, 'A simple one');
  await expect(page.getByLabel('Your name')).toHaveValue('Pat Example');
  await expect(page.getByLabel('E-mail')).toHaveValue(email);
  await page.getByRole('button', { name: 'Get my price' }).click();

  await page.getByRole('button', { name: /^Pay \$/ }).click();
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toContainText('You are covered');
  const policy = (await heading.textContent())?.match(/FHV-\d{6}/)?.[0] ?? '';
  expect(policy).not.toBe('');

  // The certificate is mailed to the insured.
  await nav.getByRole('link', { name: 'Inbox' }).click();
  await expect(
    page.getByRole('article', { name: `Certificate of insurance ${policy}` }),
  ).toBeVisible();

  await nav.getByRole('link', { name: 'Pat Example' }).click();
  const list = page.getByRole('region', { name: 'Your quotes and policies' });
  await expect(list).toContainText(`Policy ${policy}`);

  // Signed out, the account asks for the password again; a wrong one is refused, the right one opens it.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.goto('/p/FHV/account');
  await expect(heading).toHaveText('Sign in');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill('not the password at all');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not right' })).toBeVisible();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(heading).toHaveText('Hello, Pat Example');
  await expect(list).toContainText(`Policy ${policy}`);
});

test('a confirmation link signs in once and is refused after', async ({ page }) => {
  await page.goto('/p/FHV/account/register');
  await register(page);
  const link = await page
    .getByRole('article', { name: 'Confirm your e-mail' })
    .getByRole('link', { name: 'Confirm my e-mail' })
    .getAttribute('href');
  await confirmFromInbox(page);
  await expect(page.getByRole('status').filter({ hasText: 'confirmed' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto(link ?? '');
  await page.getByRole('button', { name: 'Confirm and sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'used already' })).toBeVisible();
});

test('another browser that types the same address sees none of its mail', async ({
  page,
  browser,
}) => {
  await page.goto('/p/FHV/account/register');
  const email = await register(page);
  await expect(page.getByRole('article', { name: 'Confirm your e-mail' })).toBeVisible();

  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(new URL('/p/FHV/account/register', page.url()).toString());
  await stranger.getByLabel('Your name').fill('Sam Stranger');
  await stranger.getByLabel('E-mail').fill(email);
  await stranger.getByLabel('Password').fill('another long password');
  await stranger.getByRole('button', { name: 'Create my account' }).click();
  await expect(stranger.getByText('This browser has no inbox yet')).toBeVisible();
  await expect(stranger.getByRole('link', { name: 'Confirm my e-mail' })).toHaveCount(0);
  await stranger.context().close();
});

test('the server refuses to take payment once the renter has signed out', async ({ page }) => {
  await describeEvent(page, 'A simple one');
  await askForPrice(page);
  // The price is there, the card is not: paying needs an account.
  await expect(page.getByRole('button', { name: /^Pay \$/ })).toHaveCount(0);
  await signUpToPay(page);
  await expect(page.getByRole('navigation', { name: 'Your account' })).toContainText('Pat Example');

  // The card is on screen; the session ends in another tab before it is used.
  const other = await page.context().newPage();
  await other.goto('/p/FHV/account');
  await other.getByRole('button', { name: 'Sign out' }).click();
  await other.close();

  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your price is $');
});
