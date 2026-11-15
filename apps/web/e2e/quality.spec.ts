import { expect, test } from '@playwright/test';
import { askForPrice, describeEvent } from './steps';

test('the evaluation tables show intervals and the unsafe count', async ({ page }) => {
  await page.goto('/quality');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'How often the automation is right',
  );
  const evaluations = page.getByRole('region', { name: 'Evaluations' });
  await expect(evaluations.getByRole('row')).toHaveCount(4); // header and three setups
  await expect(evaluations).toContainText('Local model, multilingual embeddings');
  await expect(evaluations.getByRole('row').nth(3)).toContainText('%');
  await expect(page.getByRole('region', { name: 'Headline' })).toContainText('0 unsafe');
  await expect(page.getByRole('img', { name: /routed right/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'By kind of case' })).toContainText('french');
});

test('a decided referral is counted by the shadow replay', async ({ page }) => {
  await describeEvent(page, 'A contact sport');
  await askForPrice(page);
  await page.getByRole('link', { name: 'Open it on the underwriting desk' }).click();
  await page.getByRole('button', { name: 'Take this referral' }).click();
  await page.getByLabel('Decline').check();
  await page.getByLabel('Note for the file').fill('Declined to feed the replay.');
  await page.getByRole('button', { name: 'Decline the event' }).click();
  await expect(page.getByRole('region', { name: 'Decision', exact: true })).toContainText(
    'Declined',
  );

  await page.goto('/quality');
  const shadow = page.getByRole('region', { name: 'Shadow replay' });
  await expect(shadow).toContainText('Replayed');
  await expect(shadow).toContainText('Agreement');
  await expect(shadow).not.toContainText('No decided referrals');
});
