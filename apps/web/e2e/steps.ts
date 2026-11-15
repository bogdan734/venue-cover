import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'a long enough password';

// Types nothing by hand: the description comes from one of the portal's examples, as a visitor would do it.
export async function describeEvent(page: Page, example: string, code = 'FHV') {
  await page.goto(`/p/${code}`);
  await page.getByRole('button', { name: example, exact: true }).click();
  await page.getByRole('button', { name: 'Read my description' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Here is how we read it');
}

export async function askForPrice(page: Page, over: { rental?: string } = {}) {
  await page.getByLabel('Your name').fill('Pat Example');
  await page.getByLabel('E-mail').fill('pat@example.org');
  if (over.rental) await page.getByLabel('Booking reference (optional)').fill(over.rental);
  await page.getByRole('button', { name: 'Get my price' }).click();
}

// Fills in the form to create an account with a new address and lands in the demo inbox.
export async function register(page: Page): Promise<string> {
  const email = `renter-${randomUUID().slice(0, 8)}@example.org`;
  await page.getByLabel('Your name').fill('Pat Example');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your mail');
  return email;
}

export async function confirmFromInbox(page: Page) {
  await page
    .getByRole('article', { name: 'Confirm your e-mail' })
    .getByRole('link', { name: 'Confirm my e-mail' })
    .click();
  await page.getByRole('button', { name: 'Confirm and sign in' }).click();
}

// Paying needs a confirmed account. From the payment card of a price: create one, confirm it from the demo inbox, and
// come back to the same price, signed in.
export async function signUpToPay(page: Page): Promise<string> {
  await page.getByRole('main').getByRole('link', { name: 'Create an account' }).click();
  const email = await register(page);
  await confirmFromInbox(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your price is $');
  return email;
}
