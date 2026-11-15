import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

// The cover image for the README and the repository's social preview, composed from the screenshots in docs/media, and the
// Telegram bot's picture:
//   node --import tsx scripts/media/hero.ts
// Nothing here is drawn by hand except the layout: the windows are the running product.
const root = new URL('../../', import.meta.url).pathname;
const media = `${root}docs/media/`;
const font = (pkg: string, file: string) => `${root}node_modules/${pkg}/files/${file}`;
const image = (name: string) =>
  `data:image/png;base64,${readFileSync(`${media}${name}.png`).toString('base64')}`;

const mark = (size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#fff"/><path d="M8 23V15a8 8 0 0 1 16 0v8" fill="none" stroke="#131c2e" stroke-width="2.4" stroke-linecap="round"/><path d="M6.5 23.5h19" stroke="#131c2e" stroke-width="2.4" stroke-linecap="round"/><path d="m12.5 17.5 2.6 2.6 4.6-5" fill="none" stroke="#20408f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const window = (src: string, style: string, title: string) => `
  <div class="win" style="${style}">
    <div class="bar"><i></i><i></i><i></i><span>${title}</span></div>
    <img src="${src}" alt="">
  </div>`;

const html = (
  width: number,
  height: number,
  stats: boolean,
) => `<!doctype html><meta charset="utf-8">
<style>
  @font-face { font-family: Serif; src: url(file://${font('@fontsource-variable/source-serif-4', 'source-serif-4-latin-wght-normal.woff2')}); font-weight: 200 900; }
  @font-face { font-family: Sans; src: url(file://${font('@fontsource-variable/ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2')}); font-weight: 100 700; }
  * { box-sizing: border-box; }
  body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; position: relative; color: #fff; font-family: Sans, system-ui, sans-serif;
    background: radial-gradient(1100px 700px at 88% 0%, rgba(184,150,74,.20), transparent 62%), radial-gradient(900px 620px at 0% 100%, rgba(70,110,210,.22), transparent 60%), linear-gradient(135deg, #0e1524, #18253f); }
  .copy { position: absolute; left: 88px; top: 88px; width: 620px; }
  .brand { display: flex; align-items: center; gap: 14px; font: 600 26px Serif; }
  .kicker { margin-top: 70px; font: 600 15px Sans; letter-spacing: .15em; color: #b8964a; text-transform: uppercase; }
  h1 { margin: 16px 0 24px; font: 600 80px/1.02 Serif; letter-spacing: -.01em; }
  p { margin: 0; max-width: 560px; font: 400 21px/1.55 Sans; color: #c4cde0; }
  .chips { position: absolute; left: 88px; bottom: 76px; width: 640px; display: flex; flex-wrap: wrap; gap: 10px; }
  .chips span { padding: 9px 15px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; font: 500 15px Sans; color: #dbe2f0; background: rgba(255,255,255,.04); }
  .win { position: absolute; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 34px 90px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.10); }
  .win .bar { height: 32px; background: #e9edf4; display: flex; align-items: center; gap: 7px; padding: 0 14px; }
  .win .bar i { width: 11px; height: 11px; border-radius: 50%; background: #c3cad8; }
  .win .bar span { margin-left: 10px; font: 500 12px Sans; color: #6a7590; }
  .win img { display: block; width: 100%; height: auto; }
  .phone { position: absolute; border-radius: 38px; background: #0a0f1c; padding: 9px; box-shadow: 0 34px 90px rgba(0,0,0,.55), 0 0 0 1.5px rgba(255,255,255,.14); }
  .phone img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; border-radius: 30px; }
</style>
<body>
  <div class="copy">
    <div class="brand">${mark(44)}Venue Cover</div>
    <div class="kicker">Event liability, end to end</div>
    <h1>A sentence in,<br>a policy out.</h1>
    <p>A renter describes an event in plain words. The platform reads it, prices it from the client’s own rules, and either issues the policy or hands the case to an underwriter, with the reasons.</p>
  </div>
  ${stats ? '<div class="chips"><span>Node.js · TypeScript · PostgreSQL</span><span>REST · GraphQL · signed webhooks · MCP</span><span>Transactional outbox</span><span>Measured, with confidence intervals</span></div>' : ''}
  ${window(image('hub'), 'left: 812px; top: 64px; width: 720px;', 'Client programs')}
  ${window(image('read'), 'left: 690px; top: 330px; width: 640px;', 'How the description was read')}
  ${window(image('worksheet'), 'left: 960px; top: 520px; width: 590px;', 'Underwriting worksheet')}
  <div class="phone" style="left: 1360px; top: 300px; width: 196px; height: 400px;"><img src="${image('phone')}" alt=""></div>
</body>`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const work = mkdtempSync(join(tmpdir(), 'hero-'));
for (const [name, width, height, stats] of [
  ['hero', 1600, 900, true],
  ['social-preview', 1280, 640, false],
] as const) {
  const page = await browser.newPage({ viewport: { width, height } });
  const file = join(work, `${name}.html`);
  writeFileSync(file, html(width === 1280 ? 1600 : width, width === 1280 ? 900 : height, stats));
  await page.goto(`file://${file}`);
  await page.evaluate(() => document.fonts.ready);
  if (width === 1280) {
    // The same composition, scaled to the size GitHub asks for, from the top.
    await page.evaluate(() => {
      document.body.style.transform = 'scale(0.8)';
      document.body.style.transformOrigin = '0 0';
    });
  }
  await page.screenshot({ path: `${media}${name}.png`, clip: { x: 0, y: 0, width, height } });
  await page.close();
}
// The Telegram bot's picture: the mark on the cover's navy, with room around it, since Telegram shows it in a circle.
const avatar = await browser.newPage({ viewport: { width: 640, height: 640 } });
await avatar.setContent(
  `<body style="margin:0;width:640px;height:640px;display:grid;place-items:center;background:linear-gradient(135deg,#0e1524,#1c2b4a)">${mark(330)}</body>`,
);
await avatar.screenshot({ path: `${media}bot-avatar.jpg`, type: 'jpeg', quality: 95 });
await browser.close();
console.log('wrote hero.png, social-preview.png and bot-avatar.jpg in', media);
