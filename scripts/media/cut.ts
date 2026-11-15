import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { LINES, type Scene } from './lines.ts';

// Edits the film. The footage (apps/web/e2e/film.ts) is stills and short frame sequences of the real product; this decides
// what plays when, where the camera looks, where the pointer goes and clicks, the subtitles, the cards and where each
// sound falls. It writes the plan main.swift renders frame by frame (edl.json) and the cues score.py mixes (audio.json).
//   node --import tsx scripts/media/cut.ts <work dir>
const work = process.argv[2];
if (!work) throw new Error('usage: cut.ts <work dir>');
const root = new URL('../../', import.meta.url).pathname;

const FPS = 30;
const W = 1920;
const H = 1080;
const VIEW: Box = [0, 0, 1600, 900]; // the browser window the footage was shot in, in CSS pixels
type Box = [number, number, number, number];
type Clip = {
  frames: { file: string; t: number }[];
  size: [number, number];
  boxes: Record<string, Box>;
};
const footage: { scale: number; clips: Record<string, Clip> } = JSON.parse(
  readFileSync(join(work, 'shots.json'), 'utf8'),
);
const spoken: Record<Scene, number[]> = JSON.parse(readFileSync(join(work, 'voice.json'), 'utf8'));
const S = footage.scale;

const clamp = (x: number, low = 0, high = 1) => Math.min(high, Math.max(low, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (x: number) => {
  const t = clamp(x);
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
};
const out = (x: number) => 1 - (1 - clamp(x)) ** 4;

function clip(id: string): Clip {
  const found = footage.clips[id];
  if (!found) throw new Error(`no footage called ${id}`);
  return found;
}
function boxOf(id: string, name: string): Box {
  const box = clip(id).boxes[name];
  if (!box) throw new Error(`${id} has no box called ${name}`);
  return box;
}
const union = (...boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b[0]));
  const y = Math.min(...boxes.map((b) => b[1]));
  const right = Math.max(...boxes.map((b) => b[0] + b[2]));
  const bottom = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x, y, right - x, bottom - y];
};

// ——— The camera: a rectangle of the footage, in CSS pixels, with the shape of where it is shown. ———

const CLOSEST = 820; // the narrowest view, so the text keeps at least 1640 image pixels across 1920

function aim(target: Box, size: [number, number], aspect: number, pad = 0.07): Box {
  if (target === VIEW) return [...VIEW];
  let [x, y, w, h] = target;
  // Room under the target for the subtitles, so they never cover what the camera is showing.
  h *= 1.2;
  const p = Math.max(28, pad * Math.max(w, h));
  x -= p;
  y -= p;
  w += 2 * p;
  h += 2 * p;
  if (w / h > aspect) {
    y -= (w / aspect - h) / 2;
    h = w / aspect;
  } else {
    x -= (h * aspect - w) / 2;
    w = h * aspect;
  }
  const grow = Math.max(1, CLOSEST / w);
  const fit = Math.min(1, size[0] / (w * grow), size[1] / (h * grow));
  const k = grow * fit;
  x -= (w * k - w) / 2;
  y -= (h * k - h) / 2;
  w *= k;
  h *= k;
  return [clamp(x, 0, size[0] - w), clamp(y, 0, size[1] - h), w, h];
}

type Key = { at: number; on: Box | string; move?: number; pad?: number };

// Where the camera looks at a moment of a shot: it travels to each key, arriving at the key's time, and between keys it
// creeps in a little, so a still never looks frozen.
function camera(keys: Key[], id: string, u: number, aspect: number, steady = false): Box {
  const c = clip(id);
  const box = (key: Key) =>
    aim(typeof key.on === 'string' ? boxOf(id, key.on) : key.on, c.size, aspect, key.pad);
  let rect = box(keys[0] as Key);
  let since = u - (keys[0] as Key).at;
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i] as Key;
    const move = key.move ?? 0.9;
    if (u < key.at - move) break;
    const next = box(key);
    const p = ease((u - (key.at - move)) / move);
    const cx = mix(rect[0] + rect[2] / 2, next[0] + next[2] / 2, p);
    const cy = mix(rect[1] + rect[3] / 2, next[1] + next[3] / 2, p);
    const w = Math.exp(mix(Math.log(rect[2]), Math.log(next[2]), p));
    const h = w / aspect;
    rect = [cx - w / 2, cy - h / 2, w, h];
    since = u - key.at;
  }
  const creep = steady ? 1 : 1 - Math.min(0.035, 0.007 * Math.max(0, since));
  const [x, y, w, h] = rect;
  const nw = w * creep;
  const nh = h * creep;
  return [
    clamp(x + (w - nw) / 2, 0, c.size[0] - nw),
    clamp(y + (h - nh) / 2, 0, c.size[1] - nh),
    nw,
    nh,
  ];
}

// ——— Shots ———

// fade: the new shot appears over the old; cross: the old one also goes, to what is under both (a background).
type Enter = { kind: 'cut' | 'fade' | 'cross' | 'zoom' | 'push' | 'rise'; dur: number };
type Pointer = { at: number; to: string | [number, number] | Box; click?: boolean; move?: number };
type Spot = { from: number; to: number; on: string | Box };
type Shot = {
  play: { id: string; at: number; rate?: number }[]; // footage, each from its time in the shot
  start: number;
  dur: number;
  cam: Key[];
  steady?: boolean; // no creeping in: for a shot that cuts straight into the same picture
  dest?: { from: Box; to: Box; at: number; move: number }; // a window on the background instead of the full frame
  enter: Enter;
  pointer?: Pointer[];
  spots?: Spot[];
};
const shots: Shot[] = [];

// What is playing at a moment of a shot: the footage started last, at its frame for that moment.
function playing(shot: Shot, u: number): { id: string; file: string } {
  let current = shot.play[0] as Shot['play'][number];
  for (const part of shot.play) if (u >= part.at) current = part;
  const c = clip(current.id);
  const t = (u - current.at) * (current.rate ?? 1);
  let file = (c.frames[0] as Clip['frames'][number]).file;
  for (const frame of c.frames) if (frame.t <= t + 1e-6) file = frame.file;
  return { id: current.id, file };
}

const FULL: Box = [0, 0, W, H];
function destOf(shot: Shot, u: number): { rect: Box; round: number } {
  if (!shot.dest) return { rect: [...FULL], round: 0 };
  const { from, to, at, move } = shot.dest;
  const p = ease((u - (at - move)) / move);
  const rect = from.map((v, i) => mix(v, to[i] as number, p)) as Box;
  return { rect, round: mix(18, to === FULL ? 0 : 18, p) };
}

const scaled = (rect: Box, k: number, dx = 0, dy = 0): Box => [
  rect[0] + (rect[2] * (1 - k)) / 2 + dx,
  rect[1] + (rect[3] * (1 - k)) / 2 + dy,
  rect[2] * k,
  rect[3] * k,
];

type Layer = Record<string, unknown>;

// Maps a point of the footage (CSS pixels) to the frame, through the camera and the window.
const toFrame = (p: [number, number], crop: Box, rect: Box): [number, number] => [
  rect[0] + ((p[0] - crop[0]) * rect[2]) / crop[2],
  rect[1] + ((p[1] - crop[1]) * rect[3]) / crop[3],
];

const POINTER = { w: 28, h: 40, k: 1.15 };

function pointerAt(
  shot: Shot,
  id: string,
  u: number,
): { p: [number, number]; alpha: number; press: number } | null {
  const keys = shot.pointer;
  if (!keys?.length) return null;
  // A point as given, or a little left of the middle of a box, where a hand would aim.
  const where = (key: Pointer): [number, number] => {
    const to = typeof key.to === 'string' ? boxOf(id, key.to) : key.to;
    if (to.length === 2) return [to[0], to[1]];
    return [to[0] + (to[2] ?? 0) * 0.42, to[1] + (to[3] ?? 0) * 0.58];
  };
  const first = keys[0] as Pointer;
  if (u < first.at - 0.25) return null;
  let p = where(first);
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i] as Pointer;
    const move = key.move ?? 0.7;
    if (u < key.at - move) break;
    const q = where(key);
    const t = ease((u - (key.at - move)) / move);
    // A hand moves in an arc, not a ruler line.
    const bend = Math.sin(Math.PI * t) * 0.12;
    p = [mix(p[0], q[0], t) - (q[1] - p[1]) * bend, mix(p[1], q[1], t) + (q[0] - p[0]) * bend];
  }
  const press = Math.max(
    0,
    ...keys.filter((k) => k.click).map((k) => (u >= k.at && u < k.at + 0.14 ? 1 : 0)),
  );
  return { p, alpha: clamp((u - (first.at - 0.25)) / 0.25), press };
}

function shotLayers(shot: Shot, t: number, next: Shot | undefined): Layer[] {
  const u = t - shot.start;
  const { id, file } = playing(shot, u);
  let { rect, round } = destOf(shot, u);
  let alpha = 1;
  // Coming in.
  const e = shot.enter.kind === 'cut' ? 1 : ease(u / shot.enter.dur);
  if (e < 1) {
    if (shot.enter.kind === 'fade' || shot.enter.kind === 'cross') alpha = e;
    if (shot.enter.kind === 'zoom') {
      rect = scaled(rect, mix(0.955, 1, e));
      alpha = out(e);
    }
    if (shot.enter.kind === 'push') rect = scaled(rect, 1, W * (1 - e));
    if (shot.enter.kind === 'rise') {
      rect = scaled(rect, 1, 0, 140 * (1 - e));
      alpha = out(e);
    }
  }
  // Going out, under the next shot.
  if (next && next.enter.kind !== 'cut' && t >= next.start) {
    const x = ease((t - next.start) / next.enter.dur);
    if (next.enter.kind === 'zoom') rect = scaled(rect, mix(1, 1.06, x));
    if (next.enter.kind === 'cross') alpha *= 1 - x;
    if (next.enter.kind === 'push') rect = scaled(rect, 1, -W * x);
  }
  const aspect = rect[2] / rect[3];
  const crop = camera(shot.cam, id, u, aspect, shot.steady);
  const layers: Layer[] = [
    {
      img: file,
      crop: crop.map((v) => v * S),
      dest: rect,
      alpha,
      ...(round > 0.5 ? { radius: round, shadow: 46 } : {}),
    },
  ];
  for (const spot of shot.spots ?? []) {
    const fade = Math.min(clamp((u - spot.from) / 0.3), clamp((spot.to - u) / 0.3));
    if (fade <= 0) continue;
    const [x, y, w, h] = typeof spot.on === 'string' ? boxOf(id, spot.on) : spot.on;
    const a = toFrame([x - 10, y - 10], crop, rect);
    const b = toFrame([x + w + 10, y + h + 10], crop, rect);
    layers.push({ dim: [a[0], a[1], b[0] - a[0], b[1] - a[1]], radius: 14, alpha: fade * alpha });
  }
  const pointer = pointerAt(shot, id, u);
  if (pointer) {
    const [x, y] = toFrame(pointer.p, crop, rect);
    const k = POINTER.k * (1 - 0.12 * pointer.press);
    layers.push({
      img: cursorFile,
      dest: [x - 2 * k, y - 2 * k, POINTER.w * k, POINTER.h * k],
      alpha: pointer.alpha * alpha,
    });
    for (const key of shot.pointer ?? []) {
      const since = u - key.at;
      if (!key.click || since < 0 || since > 0.5) continue;
      const p = since / 0.5;
      layers.splice(layers.length - 1, 0, {
        ring: [x, y, mix(10, 38, out(p))],
        alpha: (1 - p) * alpha,
      });
    }
  }
  return layers;
}

// ——— Overlays: type drawn by the browser into transparent full-frame images, in the product's own faces. ———

// `under` puts an overlay beneath the footage (the background of a card or of two windows side by side).
type Overlay = {
  img: string;
  start: number;
  dur: number;
  fade?: number;
  rise?: number;
  under?: boolean;
};
const overlays: Overlay[] = [];

function overlayLayer(o: Overlay, t: number): Layer | null {
  const u = t - o.start;
  if (u < 0 || u > o.dur) return null;
  const fade = o.fade ?? 0.25;
  const inn = out(u / fade);
  const away = clamp((o.dur - u) / fade);
  const rise = (o.rise ?? 0) * (1 - inn);
  return { img: o.img, dest: [0, rise, W, H], alpha: Math.min(inn, away) };
}

const fonts = (pkg: string, file: string) => `file://${root}node_modules/${pkg}/files/${file}`;
const STYLE = `
  @font-face { font-family: Serif; src: url(${fonts('@fontsource-variable/source-serif-4', 'source-serif-4-latin-wght-normal.woff2')}); font-weight: 200 900; }
  @font-face { font-family: Sans; src: url(${fonts('@fontsource-variable/ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2')}); font-weight: 100 700; }
  * { box-sizing: border-box; margin: 0; }
  body { width: ${W}px; height: ${H}px; position: relative; overflow: hidden; color: #fff; font-family: Sans, sans-serif; }
  .navy { position: absolute; inset: 0; background: radial-gradient(1300px 820px at 88% 0%, rgba(184,150,74,.20), transparent 62%), radial-gradient(1100px 760px at 0% 100%, rgba(70,110,210,.24), transparent 60%), linear-gradient(135deg, #0e1524, #18253f); }
  .center { position: absolute; left: 0; right: 0; text-align: center; }
  .sub { position: absolute; left: 50%; bottom: 44px; transform: translateX(-50%); width: max-content; max-width: 1320px; padding: 12px 24px 14px; border-radius: 12px; background: rgba(10,15,27,.82); font: 500 30px/1.36 Sans; text-align: center; text-wrap: balance; }
  .chapter { position: absolute; right: 56px; top: 50px; display: flex; align-items: center; gap: 12px; padding: 11px 22px 12px 18px; border-radius: 999px; background: rgba(10,15,27,.84); font: 600 25px Sans; letter-spacing: .01em; }
  .chapter i, .label i { width: 11px; height: 11px; border-radius: 50%; background: #b8964a; }
  .label { position: absolute; top: 196px; display: flex; align-items: center; gap: 12px; font: 600 25px Sans; }
`;
const MARK =
  '<svg width="96" height="96" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#fff"/><path d="M8 23V15a8 8 0 0 1 16 0v8" fill="none" stroke="#131c2e" stroke-width="2.4" stroke-linecap="round"/><path d="M6.5 23.5h19" stroke="#131c2e" stroke-width="2.4" stroke-linecap="round"/><path d="m12.5 17.5 2.6 2.6 4.6-5" fill="none" stroke="#20408f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

mkdirSync(join(work, 'overlays'), { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: W, height: H } });
let painted = 0;
async function paint(body: string, transparent = true): Promise<string> {
  const name = `o${String(painted++).padStart(3, '0')}`;
  const html = join(work, 'overlays', `${name}.html`);
  const png = join(work, 'overlays', `${name}.png`);
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>${STYLE}</style><body>${body}</body>`,
  );
  await page.goto(`file://${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: png, omitBackground: transparent });
  return png;
}
const entities = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cursorPage = await browser.newPage({
  viewport: { width: 28, height: 40 },
  deviceScaleFactor: 2,
});
const cursorFile = join(work, 'overlays', 'cursor.png');
await cursorPage.setContent(
  '<body style="margin:0;background:transparent"><svg width="28" height="40" viewBox="0 0 28 40" style="filter:drop-shadow(0 1.5px 1.5px rgba(0,0,0,.35))"><path d="M3 2.5v27.2l6.9-6.6 4.6 10.9 4.6-2-4.6-10.6h9.7z" fill="#fff" stroke="#121212" stroke-width="1.8" stroke-linejoin="round"/></svg></body>',
);
await cursorPage.screenshot({ path: cursorFile, omitBackground: true });

const background = await paint('<div class="navy"></div>', false);
const logo = await paint(
  `<div class="center" style="top:300px;display:flex;justify-content:center;align-items:center;gap:26px;font:600 64px Serif">${MARK}Venue Cover</div>`,
);
const headline = await paint(
  '<div class="center" style="top:452px;font:600 104px/1.05 Serif;letter-spacing:-.01em">A sentence in, a policy out.</div>',
);
const tagline = await paint(
  '<div class="center" style="top:612px;font:400 34px Sans;color:#c4cde0">Event liability insurance, sold through the venues people rent</div>',
);
const stack = await paint(
  `<div class="center" style="top:556px;display:flex;justify-content:center;gap:12px">${[
    'TypeScript',
    'PostgreSQL',
    'REST · GraphQL',
    'Signed webhooks',
    'Outbox',
    'MCP',
  ]
    .map(
      (s) =>
        `<span style="padding:10px 20px;border:1px solid rgba(255,255,255,.22);border-radius:999px;font:500 26px Sans;color:#dbe2f0;background:rgba(255,255,255,.05)">${s}</span>`,
    )
    .join('')}</div>`,
);
const links = await paint(
  `<div class="center" style="top:668px;font:400 31px/1.7 Sans;color:#c4cde0">
     <div><b style="color:#fff;font-weight:600">Live demo</b>&nbsp;&nbsp;venue-cover.bogdangavrilyuk5.workers.dev</div>
     <div><b style="color:#fff;font-weight:600">Code</b>&nbsp;&nbsp;github.com/bogdan734/venue-cover</div>
     <div style="margin-top:26px;font:600 30px Sans;color:#b8964a">Bohdan Havryliuk</div>
   </div>`,
);

// ——— The edit ———

const voices: { file: string; at: number }[] = [];
const sfx: { kind: string; at: number; dur?: number }[] = [];
const GAP = 0.32; // between two sentences of one scene

// Places a scene's sentences from a moment, each with its subtitle; returns when the last one ends.
async function say(scene: Scene, at: number): Promise<number> {
  let t = at;
  for (const [n, sentence] of LINES[scene].entries()) {
    const length = spoken[scene][n] as number;
    voices.push({ file: join(work, 'voice', `${scene}-${n}.wav`), at: t });
    overlays.push({
      img: await paint(`<div class="sub">${entities(sentence)}</div>`),
      start: t - 0.08,
      dur: length + 0.3,
      fade: 0.16,
    });
    t += length + GAP;
  }
  return t - GAP;
}
async function chapter(title: string, at: number) {
  overlays.push({
    img: await paint(`<div class="chapter"><i></i>${entities(title)}</div>`),
    start: at,
    dur: 2.8,
    fade: 0.35,
    rise: -14,
  });
}
// Adds a shot that starts where the last one ends, or overlaps it by its transition.
function add(shot: Omit<Shot, 'start'> & { start?: number }): Shot {
  const last = shots.at(-1);
  const start =
    shot.start ??
    (last ? last.start + last.dur - (shot.enter.kind === 'cut' ? 0 : shot.enter.dur) : 0);
  const placed = { ...shot, start };
  shots.push(placed);
  if (shot.enter.kind === 'zoom' || shot.enter.kind === 'push')
    sfx.push({ kind: 'whoosh', at: start - 0.1 });
  for (const p of shot.pointer ?? []) if (p.click) sfx.push({ kind: 'click', at: start + p.at });
  return placed;
}
const end = (shot: Shot) => shot.start + shot.dur;
const zoom: Enter = { kind: 'zoom', dur: 0.5 };
const cut: Enter = { kind: 'cut', dur: 0 };
const push: Enter = { kind: 'push', dur: 0.6 };
const fade: Enter = { kind: 'fade', dur: 0.35 };

// 0. The title card.
overlays.push({ img: background, start: 0, dur: 6.2, fade: 0.01, under: true });
overlays.push({ img: logo, start: 0.25, dur: 3.1, fade: 0.55, rise: 26 });
overlays.push({ img: headline, start: 0.6, dur: 2.75, fade: 0.6, rise: 30 });
overlays.push({ img: tagline, start: 1.05, dur: 2.3, fade: 0.6, rise: 24 });
sfx.push({ kind: 'hit', at: 0.25 });

// 1. A renter, on a client's portal.
const portalVoice = await say('portal', 3.7);
const portal = add({
  start: 3.2,
  dur: Math.max(4.4, portalVoice - 3.2 + 0.55),
  play: [{ id: 'portal', at: 0.35 }],
  steady: true,
  enter: { kind: 'rise', dur: 0.8 },
  dest: { from: [190, 107, 1540, 866], to: FULL, at: 2.3, move: 1.3 },
  cam: [
    { at: 0, on: VIEW },
    { at: 3.6, on: 'intro', move: 1.1 },
  ],
});
await chapter('The renter', portal.start + 1.4);

const typingVoice = await say('typing', end(portal) + 0.15);
const typing = add({
  enter: cut,
  dur: Math.max(3.5, typingVoice - end(portal) + 0.2),
  steady: true,
  play: [
    { id: 'portal', at: -10 },
    { id: 'typing', at: 0.65, rate: 30 },
  ],
  cam: [{ at: 0, on: boxOf('portal', 'intro') }],
  pointer: [
    { at: 0.05, to: [1150, 640] },
    { at: 0.65, to: boxOf('portal', 'field'), click: true },
  ],
});
sfx.push({ kind: 'keys', at: typing.start + 0.7, dur: 78 / 30 });
const typed = add({
  enter: cut,
  dur: 1.5,
  steady: true,
  play: [{ id: 'typed', at: 0 }],
  cam: [
    { at: 0, on: boxOf('portal', 'intro') },
    { at: 1.0, on: union(boxOf('typed', 'field'), boxOf('typed', 'read')), move: 0.9 },
  ],
  pointer: [
    { at: 0, to: boxOf('portal', 'field') },
    { at: 0.95, to: 'read', click: true, move: 0.8 },
  ],
});

// 2. How it was read, and the price.
const readVoice = await say('read', end(typed) + 0.1);
add({
  enter: zoom,
  dur: Math.max(5.2, readVoice - end(typed) + 0.9),
  steady: true,
  play: [{ id: 'read', at: 0 }],
  cam: [
    { at: 0, on: VIEW },
    { at: 1.7, on: union(boxOf('read', 'written'), boxOf('read', 'facts')), move: 1.2 },
    { at: 3.4, on: 'catalogue', move: 1.0 },
  ],
  spots: [{ from: 3.5, to: 5.0, on: 'catalogue' }],
});
const toPrice = add({
  enter: fade,
  dur: 1.7,
  play: [{ id: 'read-full', at: 0 }],
  cam: [
    { at: 0, on: boxOf('read', 'catalogue') },
    { at: 1.1, on: 'price', move: 0.9, pad: 0.5 },
  ],
  pointer: [
    { at: 0.1, to: [1350, 700] },
    { at: 1.15, to: 'price', click: true, move: 0.8 },
  ],
});
const priceVoice = await say('price', end(toPrice) + 0.2);
add({
  enter: zoom,
  dur: Math.max(5, priceVoice - end(toPrice) + 0.7),
  steady: true,
  play: [{ id: 'price', at: 0 }],
  cam: [
    { at: 0, on: VIEW },
    { at: 1.9, on: 'split', move: 1.2 },
  ],
});
const pay = add({
  enter: fade,
  dur: 1.5,
  play: [{ id: 'pay', at: 0 }],
  cam: [
    { at: 0, on: boxOf('price', 'split') },
    { at: 0.8, on: 'pay', move: 0.7, pad: 0.9 },
  ],
  pointer: [
    { at: 0.1, to: [1200, 600] },
    { at: 0.95, to: 'pay', click: true, move: 0.75 },
  ],
});
const coveredVoice = await say('covered', end(pay) + 0.15);
const covered = add({
  enter: zoom,
  dur: Math.max(4.4, coveredVoice - end(pay) + 0.8),
  play: [{ id: 'covered', at: 0 }],
  cam: [
    { at: 0, on: 'title' },
    { at: 2.2, on: 'certificates', move: 1.2 },
  ],
});

// 3. The underwriter.
const referredVoice = await say('referred', end(covered) + 0.5);
const referred = add({
  enter: push,
  dur: Math.max(5, referredVoice - end(covered) + 0.7),
  play: [{ id: 'referred', at: 0.2 }],
  cam: [
    { at: 0, on: VIEW },
    { at: 2.0, on: union(boxOf('referred', 'title'), boxOf('referred', 'indicative')), move: 1.2 },
  ],
});
await chapter('The underwriter', referred.start + 0.7);
const worksheetVoice = await say('worksheet', end(referred) + 0.2);
add({
  enter: zoom,
  dur: Math.max(5.2, worksheetVoice - end(referred) - 1.0),
  steady: true,
  play: [{ id: 'worksheet', at: 0 }],
  cam: [
    { at: 0, on: 'title' },
    { at: 2.4, on: 'worksheet', move: 1.6 },
  ],
});
const approve = add({
  enter: fade,
  dur: 1.8,
  play: [{ id: 'approve', at: 0 }],
  cam: [
    { at: 0, on: boxOf('worksheet', 'worksheet') },
    { at: 1.0, on: union(boxOf('approve', 'note'), boxOf('approve', 'approve')), move: 0.8 },
  ],
  pointer: [
    { at: 0.1, to: [1000, 500] },
    { at: 1.2, to: 'approve', click: true, move: 0.8 },
  ],
});
// Side by side: the decision on the desk, and the renter's page changing by itself.
const approvedVoice = await say('approved', end(approve) + 0.35);
const sideDur = Math.max(4.2, approvedVoice - end(approve) + 1.2);
const LEFT: Box = [56, 252, 888, 500];
const RIGHT: Box = [976, 252, 888, 500];
overlays.push({
  img: background,
  start: end(approve) - 0.4,
  dur: sideDur + 0.8,
  fade: 0.3,
  under: true,
});
const cross: Enter = { kind: 'cross', dur: 0.5 };
overlays.push({
  img: await paint(
    `<div class="label" style="left:${LEFT[0]}px"><i></i>The underwriting desk</div><div class="label" style="left:${RIGHT[0]}px"><i></i>The renter’s page, untouched</div>`,
  ),
  start: end(approve) - 0.1,
  dur: sideDur - 0.3,
  fade: 0.35,
  rise: 12,
});
const desk = add({
  enter: cross,
  dur: sideDur,
  play: [{ id: 'decided', at: 0 }],
  dest: { from: LEFT, to: LEFT, at: 0, move: 0.01 },
  cam: [{ at: 0, on: 'decision' }],
});
add({
  start: desk.start,
  enter: cross,
  dur: sideDur,
  play: [
    { id: 'referred', at: -10 }, // its last frame: the page as the renter left it
    { id: 'renter-approved', at: 1.1 },
  ],
  dest: { from: RIGHT, to: RIGHT, at: 0, move: 0.01 },
  cam: [{ at: 0, on: [330, 150, 940, 529] }],
});

// 4. The platform.
const hubVoice = await say('hub', end(desk) + 0.45);
const hub = add({
  start: end(desk) - 0.6,
  enter: push,
  dur: Math.max(5.6, hubVoice - end(desk) + 1.2),
  play: [{ id: 'hub', at: 0.25 }],
  cam: [
    { at: 0, on: VIEW },
    { at: 2.6, on: 'table', move: 1.3 },
  ],
});
await chapter('The platform', hub.start + 0.7);
const programVoice = await say('program', end(hub) + 0.15);
const program = add({
  enter: zoom,
  dur: 3.2,
  steady: true,
  play: [{ id: 'program', at: 0 }],
  cam: [
    { at: 0, on: 'title' },
    { at: 1.4, on: 'appearance', move: 1.1 },
  ],
  pointer: [
    { at: 1.2, to: [700, 760] },
    { at: 2.7, to: 'swatch', click: true, move: 0.9 },
  ],
});
add({
  enter: cut,
  dur: 1.8,
  steady: true,
  play: [{ id: 'restyled', at: 0 }],
  cam: [{ at: 0, on: 'appearance' }],
  pointer: [{ at: 0, to: boxOf('program', 'swatch') }],
});
const client = add({
  enter: zoom,
  dur: Math.max(3.2, programVoice - (end(program) + 1.8) + 0.8),
  play: [{ id: 'client', at: 0 }],
  cam: [
    { at: 0, on: VIEW },
    { at: 2.2, on: 'month', move: 1.2 },
  ],
});

// 5. Conversations.
const chatVoice = await say('chat', end(client) + 0.4);
const chat = add({
  enter: push,
  dur: 2.2,
  steady: true,
  play: [{ id: 'chat', at: 0.1 }],
  cam: [{ at: 0, on: 'chat', pad: 0.12 }],
  pointer: [
    { at: 0.6, to: [1300, 520] },
    { at: 1.75, to: 'covered', click: true, move: 0.9 },
  ],
});
await chapter('Conversations', chat.start + 0.7);
add({
  enter: cut,
  dur: 2.0,
  steady: true,
  play: [{ id: 'chat-covered', at: 0 }],
  cam: [{ at: 0, on: 'chat', pad: 0.12 }],
});
add({
  enter: fade,
  dur: 1.8,
  steady: true,
  play: [{ id: 'chat-claim', at: 0 }],
  cam: [{ at: 0, on: 'chat', pad: 0.12 }],
});
const inbox = add({
  enter: zoom,
  dur: Math.max(3, chatVoice - (end(chat) + 3.6) + 1.0),
  play: [{ id: 'inbox', at: 0 }],
  cam: [
    { at: 0, on: VIEW },
    { at: 1.6, on: 'thread', move: 1.1 },
  ],
});

// 6. Integrations.
const developerVoice = await say('developer', end(inbox) + 0.4);
const developer = add({
  enter: push,
  dur: Math.max(8.4, developerVoice - end(inbox) + 0.9),
  play: [{ id: 'developer', at: 0 }],
  cam: [
    { at: 0, on: 'feed' },
    { at: 2.9, on: 'deliveries', move: 1.3 },
    { at: 6.0, on: 'graphql', move: 1.4 },
  ],
});
await chapter('For developers', developer.start + 0.7);

// 7. Guardrails.
const personalVoice = await say('personal', end(developer) + 0.4);
const personal = add({
  enter: push,
  dur: Math.max(4.2, personalVoice - end(developer) + 0.8),
  play: [{ id: 'personal', at: 0 }],
  cam: [
    { at: 0, on: 'written' },
    { at: 1.7, on: 'seen', move: 1.1 },
  ],
  spots: [{ from: 1.9, to: 4.0, on: 'seen' }],
});
await chapter('Guardrails', personal.start + 0.7);
const injectionVoice = await say('injection', end(personal) + 0.2);
const injection = add({
  enter: zoom,
  dur: Math.max(3.9, injectionVoice - end(personal) + 0.7),
  play: [{ id: 'injection', at: 0 }],
  cam: [
    { at: 0, on: 'written' },
    {
      at: 2.0,
      on: union(boxOf('injection', 'written'), boxOf('injection', 'activity')),
      move: 1.1,
    },
  ],
});

// 8. Measured.
const qualityVoice = await say('quality', end(injection) + 0.4);
const quality = add({
  enter: push,
  dur: Math.max(5.6, qualityVoice - end(injection) + 1.0),
  play: [{ id: 'quality', at: 0.2 }],
  cam: [
    { at: 0, on: VIEW },
    { at: 3.0, on: 'title', move: 1.4, pad: 1.4 },
  ],
});
await chapter('Measured', quality.start + 0.7);

// 9. The closing card.
const close = end(quality) - 0.3;
overlays.push({ img: background, start: close, dur: 7, fade: 0.5 });
overlays.push({ img: logo, start: close + 0.2, dur: 6.7, fade: 0.6, rise: 24 });
overlays.push({ img: stack, start: close + 0.8, dur: 6.1, fade: 0.6, rise: 20 });
overlays.push({ img: links, start: close + 1.2, dur: 5.7, fade: 0.6, rise: 20 });
sfx.push({ kind: 'hit', at: close + 0.2 });
const outroVoice = await say('outro', close + 0.9);
const total = Math.max(close + 6.4, outroVoice + 2.2);

await browser.close();

// ——— Render the plan, frame by frame ———

// The shot that follows one: the next to start later (two windows side by side start together and leave together).
const following = (shot: Shot) => shots.find((other) => other.start > shot.start);

const frames: Layer[][] = [];
for (let n = 0; n < Math.round(total * FPS); n++) {
  const t = n / FPS;
  const layers: Layer[] = [];
  const add = (list: Overlay[]) => {
    for (const o of list) {
      const layer = overlayLayer(o, t);
      if (layer) layers.push(layer);
    }
  };
  add(overlays.filter((o) => o.under));
  for (const shot of shots)
    if (t >= shot.start && t < end(shot)) layers.push(...shotLayers(shot, t, following(shot)));
  add(overlays.filter((o) => !o.under));
  // The film fades to black over its last second.
  const tail = clamp((total - t) / 0.9);
  if (tail < 1) layers.push({ fill: [0, 0, 0], alpha: 1 - tail });
  frames.push(layers);
}

writeFileSync(
  join(work, 'edl.json'),
  JSON.stringify({
    fps: FPS,
    size: [W, H],
    bitrate: 1_800_000,
    background: [0.055, 0.082, 0.141],
    frames,
  }),
);
writeFileSync(
  join(work, 'audio.json'),
  JSON.stringify({ duration: total, voices, sfx, music: { outro: close } }, null, 1),
);
console.log(
  `${frames.length} frames, ${total.toFixed(1)} s, ${voices.length} sentences, ${sfx.length} sounds`,
);
