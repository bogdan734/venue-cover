import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { askForPrice, describeEvent, signUpToPay } from './steps';

// Shoots the raw footage for the film in docs/media from a running demo. Nothing is recorded in real time: every screen
// is a still at twice the pixels, an entrance animation is stepped through frame by frame, and typing is shot a few
// keys at a time, so the film is as sharp as a screenshot. scripts/media/cut.ts edits what this leaves in FILM_WORK.
//   FILM_WORK=<dir> ADMIN_PASSWORD=… node --import tsx e2e/film.ts
const base = process.env.TOUR_URL ?? 'http://127.0.0.1:3100';
const work = process.env.FILM_WORK;
const password = process.env.ADMIN_PASSWORD;
if (!work || !password) throw new Error('FILM_WORK and ADMIN_PASSWORD are required');

type Box = [number, number, number, number];
type Clip = {
  frames: { file: string; t: number }[];
  size: [number, number];
  boxes: Record<string, Box>;
};
const clips: Record<string, Clip> = {};
const STEP = 1000 / 25; // entrance animations are sampled at 25 frames a second
const LONGEST = 1600; // and cut at this many milliseconds: anything longer is a spinner, not an entrance

type Snap = {
  full?: boolean; // the whole page, for the camera to travel over (the default), or only the window
  build?: boolean; // step through the entrance animations instead of waiting for their end
  hover?: Locator;
  boxes?: Record<string, Locator | Locator[]>; // what the camera and the pointer may aim at; a list is their union
};

async function shoot(page: Page, clip: Clip, dir: string, t: number, full: boolean) {
  const file = join(dir, `${String(clip.frames.length).padStart(3, '0')}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 92, fullPage: full });
  clip.frames.push({ file, t });
}

async function snap(
  page: Page,
  id: string,
  { full = true, build = false, hover, boxes = {} }: Snap = {},
) {
  const dir = join(work as string, 'clips', id);
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  // The back office's rail is as tall as the window; in a picture of the whole page it runs the whole height.
  if (full) await page.addStyleTag({ content: 'aside.bg-rail { height: auto !important; }' });
  if (hover) await hover.hover();
  const size = await page.evaluate(
    (whole) =>
      (whole
        ? [document.documentElement.scrollWidth, document.documentElement.scrollHeight]
        : [innerWidth, innerHeight]) as [number, number],
    full,
  );
  const clip: Clip = { frames: [], size, boxes: {} };
  if (build) {
    const end = await page.evaluate((longest) => {
      const all = document.getAnimations();
      for (const animation of all) animation.pause();
      const ends = all.map((a) => Number(a.effect?.getComputedTiming().endTime));
      return Math.min(longest, Math.max(0, ...ends.filter(Number.isFinite)));
    }, LONGEST);
    for (let t = 0; t <= end + STEP; t += STEP) {
      await page.evaluate((at) => {
        for (const animation of document.getAnimations()) animation.currentTime = at;
      }, t);
      await shoot(page, clip, dir, t / 1000, full);
    }
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.play();
    });
  } else {
    await page.evaluate(() => {
      for (const animation of document.getAnimations())
        if (Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
          animation.finish();
    });
    await shoot(page, clip, dir, 0, full);
  }
  const scrolled = full ? await page.evaluate(() => [scrollX, scrollY]) : [0, 0];
  for (const [name, target] of Object.entries(boxes)) {
    const found = await Promise.all(
      (Array.isArray(target) ? target : [target]).map((l) => l.boundingBox()),
    );
    if (found.some((b) => !b)) throw new Error(`${id}: nothing to aim at for "${name}"`);
    const x = Math.min(...found.map((b) => b?.x ?? 0));
    const y = Math.min(...found.map((b) => b?.y ?? 0));
    const right = Math.max(...found.map((b) => (b?.x ?? 0) + (b?.width ?? 0)));
    const bottom = Math.max(...found.map((b) => (b?.y ?? 0) + (b?.height ?? 0)));
    clip.boxes[name] = [x + (scrolled[0] ?? 0), y + (scrolled[1] ?? 0), right - x, bottom - y];
  }
  clips[id] = clip;
}

// Types into a field a few keys at a time, a frame after each; the edit decides how fast it plays.
async function typing(page: Page, id: string, field: Locator, text: string, keys = 2) {
  const dir = join(work as string, 'clips', id);
  mkdirSync(dir, { recursive: true });
  const clip: Clip = { frames: [], size: [1600, 900], boxes: {} };
  await field.click();
  await shoot(page, clip, dir, 0, false);
  for (let at = 0; at < text.length; at += keys) {
    await field.pressSequentially(text.slice(at, at + keys));
    await shoot(page, clip, dir, Math.min(at + keys, text.length), false); // t counts characters here
  }
  clips[id] = clip;
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const context = () =>
  browser.newContext({
    baseURL: base,
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });
const renter = await (await context()).newPage();
const staffContext = await context();
const staff = await staffContext.newPage();
await staff.goto('/login');
await staff.getByLabel('Password').fill(password);
await staff.getByRole('button', { name: 'Open the console' }).click();
await staff.waitForURL('/');

// The developer page stays open in its own tab from the start, so its live feed catches everything the renter does,
// with a webhook endpoint registered for the policies (and removed again at the end).
const developer = await staffContext.newPage();
await developer.goto('/developer?program=prg_1');
const endpoints = developer.getByRole('region', { name: /^Webhook endpoints/ });
await endpoints.getByRole('button', { name: '…/ok' }).click();
await endpoints.getByRole('button', { name: 'Register endpoint' }).click();
await expect(endpoints.getByRole('status')).toContainText('whsec_');

// 1. A renter describes an event in their own words.
await renter.goto('/p/FHV');
await expect(heading(renter)).toHaveText('Tell us about your event');
const field = renter.locator('textarea').first();
const read = renter.getByRole('button', { name: 'Read my description' });
await snap(renter, 'portal', {
  build: true,
  boxes: {
    brand: renter.getByRole('banner'),
    intro: [heading(renter), field],
    field,
    read,
    rules: [renter.getByText('Priced on the spot here'), renter.getByText(/^Anything else goes/)],
  },
});
await typing(
  renter,
  'typing',
  field,
  "Having my daughter's bday bash at the hall, about 25 kids, 3 hours, no booze",
);
await snap(renter, 'typed', { hover: read, boxes: { read, field } });
await read.click();
await expect(heading(renter)).toHaveText('Here is how we read it');
const reading = renter.locator('section[aria-labelledby="understood"]');
const step = (title: string) => reading.locator('li').filter({ hasText: title }).first();
const confirm = renter.locator('form').filter({ has: renter.getByLabel('People') });
await snap(renter, 'read', {
  build: true,
  boxes: {
    reading,
    written: step('What was written'),
    facts: step('The facts read from it'),
    catalogue: step('Where it was found in the catalogue'),
    confirm,
  },
});
// A party with children: the program asks about a waiver, and the renter says yes.
for (const select of await renter
  .getByRole('group', { name: 'This program also asks' })
  .locator('select')
  .all())
  await select.selectOption({ label: 'Yes' });
await renter.getByLabel('Your name').fill('Pat Example');
await renter.getByLabel('E-mail').fill('pat@example.org');
const getPrice = renter.getByRole('button', { name: 'Get my price' });
await snap(renter, 'read-full', {
  hover: getPrice,
  boxes: {
    reading,
    rules: step('What the program’s rules say'),
    confirm,
    price: getPrice,
  },
});

// 2. The client's own rules price it; a test card pays; the policy and certificates are ready.
await getPrice.click();
await renter.waitForURL(/\/quote\//);
await expect(heading(renter)).toContainText('Your price is $');
await snap(renter, 'price', {
  build: true,
  boxes: {
    title: heading(renter),
    price: renter.locator('section[aria-labelledby="price"]'),
    split: renter.getByRole('region', { name: 'Where the premium goes' }),
  },
});
await signUpToPay(renter);
const pay = renter.getByRole('button', { name: /^Pay \$/ });
await snap(renter, 'pay', { hover: pay, boxes: { pay, title: heading(renter) } });
await pay.click();
await expect(heading(renter)).toContainText('You are covered');
await snap(renter, 'covered', {
  build: true,
  boxes: {
    title: heading(renter),
    certificates: renter.getByRole('region', { name: 'Certificates of insurance' }),
  },
});

// 3. Something unusual goes to an underwriter; the renter's page changes by itself when it is decided.
await describeEvent(renter, 'A contact sport', 'FHV');
await askForPrice(renter);
await expect(heading(renter)).toHaveText('A person is looking at your event');
await snap(renter, 'referred', {
  build: true,
  boxes: {
    title: heading(renter),
    indicative: renter.getByRole('region', { name: 'Indicative price' }),
  },
});
const renterUrl = renter.url();

await staff.goto('/underwriting');
await expect(heading(staff)).toBeVisible();
await snap(staff, 'queue', {
  build: true,
  boxes: { title: heading(staff), rows: staff.getByRole('table') },
});
await staff.goto(renterUrl);
await staff.getByRole('link', { name: 'Open it on the underwriting desk' }).click();
await expect(heading(staff)).toHaveText('Ice hockey game');
await staff.getByRole('button', { name: 'Take this referral' }).click();
await expect(staff.getByLabel('Note for the file')).toBeVisible();
const worksheet = staff.getByRole('region', { name: 'Pricing worksheet' });
await snap(staff, 'worksheet', { boxes: { title: heading(staff), worksheet } });
await staff.getByLabel('Approve in another risk class').check();
await staff.getByLabel('Price it as').selectOption('B');
await staff.getByLabel('Note for the file').fill('A friendly game, no checking: class B is right.');
const approve = staff.getByRole('button', { name: 'Approve' });
await snap(staff, 'approve', {
  hover: approve,
  boxes: { approve, note: staff.getByLabel('Note for the file'), worksheet },
});
await approve.click();
const decision = staff.getByRole('region', { name: 'Decision', exact: true });
await expect(decision).toContainText('Approved, class changed');
await snap(staff, 'decided', { boxes: { decision } });
await expect(heading(renter)).toContainText('Your price is $', { timeout: 30_000 });
await snap(renter, 'renter-approved', { build: true, boxes: { title: heading(renter) } });

// 4. The platform: the hub, one client's page, and its own console.
await staff.goto('/programs');
await expect(heading(staff)).toHaveText('Client programs');
await snap(staff, 'hub', {
  build: true,
  boxes: { title: heading(staff), table: staff.getByRole('table') },
});
await staff.goto('/programs/prg_1');
await expect(heading(staff)).toHaveText('Fairhaven Municipal Facilities');
const appearance = staff.getByRole('region', { name: 'Appearance' });
const consoleCard = staff.getByRole('region', { name: 'Client console' });
await snap(staff, 'program', {
  boxes: {
    title: heading(staff),
    appearance,
    contacts: staff.getByRole('region', { name: 'Contacts' }),
    console: consoleCard,
    swatch: appearance.getByRole('button', { name: 'Use #6b2d86' }),
  },
});
await appearance.getByRole('button', { name: 'Use #6b2d86' }).click();
await snap(staff, 'restyled', { boxes: { appearance } });
await consoleCard.getByLabel('Who it is for').fill('Facilities office');
await consoleCard.getByRole('button', { name: 'Make a link' }).click();
const link = await consoleCard.getByLabel('Client console link').inputValue();
const client = await (await context()).newPage();
await client.goto(link);
await expect(heading(client)).toHaveText('Fairhaven Municipal Facilities');
await snap(client, 'client', {
  build: true,
  boxes: { title: heading(client), month: client.getByRole('region', { name: 'Last 30 days' }) },
});

// 5. A question on the portal, answered from the rules; a claim handed to a person, in the staff inbox.
await renter.goto('/p/FHV');
await renter.getByRole('button', { name: 'Questions? Ask us' }).click();
const chat = renter.getByRole('region', { name: 'Chat with Fairhaven Municipal Facilities' });
await expect(chat).toBeVisible();
await snap(renter, 'chat', {
  build: true,
  boxes: { chat, covered: chat.getByRole('button', { name: 'What is covered?' }) },
});
const answers = chat.getByText('Assistant', { exact: true });
await chat.getByRole('button', { name: 'What is covered?' }).click();
await expect(answers).toHaveCount(2, { timeout: 15_000 });
await snap(renter, 'chat-covered', { boxes: { chat } });
await chat.getByLabel('Your message').fill('Someone slipped at our party and hurt their wrist');
await chat.getByRole('button', { name: 'Send' }).click();
await expect(answers).toHaveCount(3, { timeout: 15_000 });
await snap(renter, 'chat-claim', { boxes: { chat } });
await staff.goto('/inbox');
await staff
  .getByRole('region', { name: 'Conversations' })
  .getByRole('link')
  .filter({ hasText: 'Fairhaven' })
  .first()
  .click();
const thread = staff.getByRole('region', { name: 'Conversation', exact: true });
await expect(thread).toContainText('hurt their wrist');
await snap(staff, 'inbox', {
  build: true,
  boxes: { thread, case: staff.getByRole('complementary', { name: 'The case' }) },
});

// 6. Integration: the live feed and the signed deliveries of everything above, and a GraphQL query.
const deliveries = developer.getByRole('region', { name: 'Deliveries' });
await developer.bringToFront(); // a tab in the background cannot be photographed
// Read again from the server without reloading the page, so the live feed keeps every event it has caught.
const refresh = () =>
  developer.evaluate(() =>
    (window as unknown as { next: { router: { refresh(): void } } }).next.router.refresh(),
  );
await expect(async () => {
  await refresh();
  await expect(
    deliveries.getByRole('row').filter({ hasText: 'policy.issued' }).first(),
  ).toContainText('delivered');
}).toPass({ timeout: 30_000 });
await developer.getByRole('button', { name: 'Search the catalogue' }).click();
await developer.getByRole('button', { name: 'Run' }).click();
await expect(developer.getByTestId('answer')).toContainText('Fireworks display');
await snap(developer, 'developer', {
  boxes: {
    feed: developer.getByRole('region', { name: 'Live events' }),
    endpoints,
    deliveries,
    graphql: developer.getByRole('region', { name: 'GraphQL' }),
  },
});

// 7. Personal details never reach the model, and a description cannot talk it round.
await describeEvent(renter, 'With personal details', 'FHV');
await snap(renter, 'personal', {
  build: true,
  boxes: {
    written: renter.getByText('What was written'),
    seen: renter.getByRole('region', { name: 'What the model saw' }),
  },
});
await describeEvent(renter, 'Tries to talk the model round', 'FHV');
await snap(renter, 'injection', {
  build: true,
  boxes: { written: step('What was written'), activity: renter.getByLabel('Activity') },
});

// 8. And it is measured.
await staff.bringToFront();
await staff.goto('/quality');
await expect(heading(staff)).toBeVisible();
await snap(staff, 'quality', { build: true, boxes: { title: heading(staff) } });

// Tidy the demo: the endpoints and the client links were only for the film.
await developer.goto('/developer?program=prg_1');
const remove = endpoints.getByRole('button', { name: 'Remove https://hooks.example.test/ok' });
while ((await remove.count()) > 0) {
  const left = await remove.count();
  await remove.first().click();
  await expect(remove).toHaveCount(left - 1);
}
await staff.goto('/programs/prg_1');
const turnOff = consoleCard
  .getByRole('listitem')
  .filter({ hasText: 'Facilities office' })
  .getByRole('button', { name: 'Turn off' });
while ((await turnOff.count()) > 0) {
  const left = await turnOff.count();
  await turnOff.first().click();
  await expect(turnOff).toHaveCount(left - 1);
}

writeFileSync(join(work, 'shots.json'), JSON.stringify({ scale: 2, clips }, null, 1));
await browser.close();
console.log(`${Object.keys(clips).length} clips in ${work}`);
