import { test as setup } from '@playwright/test';
import { ADMIN_PASSWORD } from './playwright.config';

// Signs in once as staff and keeps the session for the tests that need the back office.
setup('sign in as staff', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Open the console' }).click();
  await page.waitForURL('/');
  await page
    .context()
    .storageState({ path: new URL('./.auth/staff.json', import.meta.url).pathname });
});
