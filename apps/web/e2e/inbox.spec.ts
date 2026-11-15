import { expect, test } from '@playwright/test';

// A browser without the staff sign-in the project gives every context.
const NOBODY = { cookies: [], origins: [] };

test('a renter asks on the portal; a claim reaches the inbox with its case, and a person answers', async ({
  page,
  browser,
}) => {
  await page.goto('/inbox');
  const renter = await (await browser.newContext({ storageState: NOBODY })).newPage();
  await renter.goto(new URL('/p/RVT', page.url()).toString());

  await renter.getByRole('button', { name: 'Questions? Ask us' }).click();
  const chat = renter.getByRole('region', { name: 'Chat with Riverton School Board' });
  await expect(chat).toContainText('assistant');
  await chat.getByRole('button', { name: 'What is covered?' }).click();
  await expect(chat).toContainText('The liability limits offered are');

  await chat
    .getByLabel('Your message')
    .fill('There was an accident in the gym and someone got hurt');
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat).toContainText('handles claims');
  await expect(chat).toContainText('Waiting for a person');

  await page.reload();
  await page
    .getByRole('region', { name: 'Conversations' })
    .getByRole('link')
    .filter({ hasText: 'Riverton School Board' })
    .first()
    .click();
  const thread = page.getByRole('region', { name: 'Conversation', exact: true });
  await expect(thread).toContainText('someone got hurt');
  await expect(page.getByRole('complementary', { name: 'The case' })).toContainText(
    'Claim reported',
  );
  await page.getByLabel('Your answer').fill('Sorry to hear it. I am calling the gym now.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(thread).toContainText('I am calling the gym now');

  // The renter's open chat picks the answer up on its next poll.
  await expect(chat).toContainText('I am calling the gym now', { timeout: 10_000 });
  await expect(chat).toContainText('is answering');
  await renter.context().close();
});
