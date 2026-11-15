import { expect, test } from '@playwright/test';
import { describeEvent } from './steps';

test('the renter sees what they wrote; the model saw tags in place of every personal detail', async ({
  page,
}) => {
  await describeEvent(page, 'With personal details');
  await expect(page.getByText('Birthday party for my daughter Emma, 25 kids')).toBeVisible();

  const seen = page.getByRole('region', { name: 'What the model saw' });
  for (const value of ['Emma', 'Sarah', 'Thompson', '613-555-0182', 'sarah.t@example.org']) {
    await expect(seen).not.toContainText(value);
  }
  await expect(seen).toContainText(/name #[A-Z2-7]{6}/);
  await expect(seen).toContainText('4 personal details (name, phone, e-mail)');
  // What the model read still makes the event: the price is worked out from it.
  await expect(page.getByLabel('People')).toHaveValue('25');
});

test('the quality page shows how many planted details reached the model, and the live guard', async ({
  page,
}) => {
  await page.goto('/quality');
  const card = page.getByRole('region', { name: 'Personal details kept from the model' });
  await expect(card).toContainText('Reached the model');
  await expect(card).toContainText(/Golden cases changed\s*0 of \d+/);
  // The tests run with the cue rules, the same on every machine.
  await expect(card).toContainText('names by the cue rules');
  await expect(card).toContainText(
    /has checked \d+ calls? since it started and had to strip 0 details/,
  );
});
