// How well the privacy shield keeps personal details from the model. Descriptions are generated with details planted
// in them (names with and without a cue, contacts, addresses, identity numbers, dates of birth, in English and French);
// each is protected the way a request is, and every planted value still in the protected text counts as one that would
// have reached the model. Also: whether the shield changes any golden case (it must not), and what it costs per text.
//
//   npm run eval:privacy            rules, and the names model when it is on disk
//
// Everything here is invented; the names are not taken from any list, so the shield cannot know them in advance.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createNameModel,
  createShield,
  isNameModelCached,
  type NameFinder,
  type PiiKind,
} from '../apps/api/src/modules/privacy/index.js';
import { createRng } from '../data/prng.js';
import { GOLDEN } from './golden.js';
import { percentile } from './metrics.js';

const FIRST = [
  'Emma',
  'Liam',
  'Priya',
  'Mateo',
  'Amara',
  'Wei',
  'Siobhan',
  'Olumide',
  'Chloé',
  'Noah',
  'Aisha',
  'Lucas',
  'Mei',
  'Gabriel',
  'Zara',
  'Ethan',
  'Léa',
  'Omar',
  'Hannah',
  'Rafael',
  'Ingrid',
  'Kofi',
  'Sofia',
  'Dmitri',
  'Nadia',
  'Theo',
  'Yuki',
  'Marguerite',
  'Arjun',
  'Freya',
];
const LAST = [
  'Thompson',
  'Tremblay',
  'Natarajan',
  'Okafor',
  'Gagnon',
  'Nguyen',
  'Kowalski',
  "O'Brien",
  'Haddad',
  'Lindqvist',
  'Mensah',
  'Delacroix',
  'Petrov',
  'Castillo',
  'Fujimoto',
  'Bouchard',
  'Achterberg',
  'Moreau',
  'Singh',
  'MacLeod',
];
const STREETS = [
  'Maple Ave',
  'Bay Street',
  'King St W',
  'Elgin Street',
  'Rideau Terrace',
  'Cedar Crescent',
  'Lakeshore Blvd',
];
const RUES = [
  'rue Sainte-Catherine Ouest',
  'boul. René-Lévesque',
  'avenue du Parc',
  'chemin de la Côte-des-Neiges',
];
const RELATIONS = ['daughter', 'son', 'wife', 'husband', 'friend'];
const PARENTES = ['fille', 'fils', 'femme', 'mari', 'amie'];
const MONTHS = ['January', 'March', 'May', 'July', 'September', 'November'];

interface Planted {
  text: string;
  values: { kind: PiiKind; value: string }[];
}

function generate(count: number, seed: number): Planted[] {
  const rng = createRng(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)] as T;
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rng() * 10)).join('');
  // Numbers that pass the checksum, as real cards and SINs do: the last digit makes the Luhn sum a multiple of ten.
  const luhn = (body: string) => {
    let sum = 0;
    for (let i = 0; i < body.length; i++) {
      let d = Number(body[body.length - 1 - i]);
      if (i % 2 === 0) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return `${body}${(10 - (sum % 10)) % 10}`;
  };
  const phone = () => `${pick(['613', '416', '514', '604'])}-555-01${digits(2)}`;
  const email = (first: string, last: string) =>
    `${first
      .normalize('NFD')
      .replace(/[^A-Za-z]/g, '')
      .toLowerCase()}.${last.replace(/[^A-Za-z]/g, '').toLowerCase()}@example.org`;
  const card = () => luhn(`4${digits(14)}`).replace(/(\d{4})(?=\d)/g, '$1 ');
  const sin = () =>
    luhn(`${1 + Math.floor(rng() * 8)}${digits(7)}`).replace(/(\d{3})(?=\d)/g, '$1 ');
  const postal = () => `K${digits(1)}P ${digits(1)}J${digits(1)}`;
  const n = () => 10 + Math.floor(rng() * 190);
  const h = () => 1 + Math.floor(rng() * 6);

  const templates: (() => Planted)[] = [
    () => {
      const [a, b, l, p] = [pick(FIRST), pick(FIRST), pick(LAST), phone()];
      return {
        text: `Birthday party for my ${pick(RELATIONS)} ${a}, ${n()} kids, ${h()} hours, no alcohol. Call me at ${p}. Thanks, ${b} ${l}`,
        values: [
          { kind: 'NAME', value: a },
          { kind: 'PHONE', value: p },
          { kind: 'NAME', value: `${b} ${l}` },
        ],
      };
    },
    () => {
      const [a, b] = [pick(FIRST), pick(FIRST)];
      return {
        text: `${a} and ${b}'s joint birthday at the hall, ${n()} guests, ${h()} hours, no alcohol`,
        values: [
          { kind: 'NAME', value: a },
          { kind: 'NAME', value: b },
        ],
      };
    },
    () => {
      const [a, la, b, lb] = [pick(FIRST), pick(LAST), pick(FIRST), pick(LAST)];
      const e = email(a, la);
      return {
        text: `Wedding of ${a} ${la} and ${b} ${lb}, ${n()} guests, wine served, ${h()} hours. Write to ${e}`,
        values: [
          { kind: 'NAME', value: `${a} ${la}` },
          { kind: 'NAME', value: `${b} ${lb}` },
          { kind: 'EMAIL', value: e },
        ],
      };
    },
    () => {
      const [a, l, p] = [pick(FIRST), pick(LAST), phone()];
      const address = `${10 + Math.floor(rng() * 980)} ${pick(STREETS)}`;
      return {
        text: `Yoga class for ${n()} people at ${address}, ${h()} hours. Organized by ${a} ${l}, ${p}`,
        values: [
          { kind: 'ADDRESS', value: address },
          { kind: 'NAME', value: `${a} ${l}` },
          { kind: 'PHONE', value: p },
        ],
      };
    },
    () => {
      const [s, c] = [sin(), card()];
      return {
        text: `Book club for ${n()} people, ${h()} hours. My SIN is ${s} and the deposit goes on card ${c}.`,
        values: [
          { kind: 'SIN', value: s },
          { kind: 'CARD', value: c },
        ],
      };
    },
    () => {
      const [a, l] = [pick(FIRST), pick(LAST)];
      const dob = `${pick(MONTHS)} ${1 + Math.floor(rng() * 28)}, ${1950 + Math.floor(rng() * 40)}`;
      return {
        text: `Retirement party for ${a} ${l} (born ${dob}), ${n()} guests, ${h()} hours`,
        values: [
          { kind: 'NAME', value: `${a} ${l}` },
          { kind: 'DOB', value: dob },
        ],
      };
    },
    () => {
      const [a, b, l, p] = [pick(FIRST), pick(FIRST), pick(LAST), phone()];
      return {
        text: `Fête pour ma ${pick(PARENTES)} ${a}, ${n()} invités, ${h()} heures, sans alcool. Contact : ${b} ${l}, ${p}`,
        values: [
          { kind: 'NAME', value: a },
          { kind: 'NAME', value: `${b} ${l}` },
          { kind: 'PHONE', value: p },
        ],
      };
    },
    () => {
      const [a, la, b, lb] = [pick(FIRST), pick(LAST), pick(FIRST), pick(LAST)];
      const address = `${100 + Math.floor(rng() * 8900)} ${pick(RUES)}`;
      return {
        text: `Mariage de ${a} ${la} et ${b} ${lb}, ${n()} invités, au ${address}`,
        values: [
          { kind: 'NAME', value: `${a} ${la}` },
          { kind: 'NAME', value: `${b} ${lb}` },
          { kind: 'ADDRESS', value: address },
        ],
      };
    },
    () => {
      const [a, l, code] = [pick(FIRST), pick(LAST), postal()];
      const e = email(a, l);
      return {
        text: `Send the invoice to ${e}, postal code ${code}, attn ${a} ${l}`,
        values: [
          { kind: 'EMAIL', value: e },
          { kind: 'POSTAL', value: code },
          { kind: 'NAME', value: `${a} ${l}` },
        ],
      };
    },
    () => {
      const [a, l, p] = [pick(FIRST), pick(LAST), phone()];
      return {
        text: `Hi, I'm ${a} ${l}. Hosting a charity walk for ${n()} people, ${h()} hours, no alcohol. Reach me on ${p}.`,
        values: [
          { kind: 'NAME', value: `${a} ${l}` },
          { kind: 'PHONE', value: p },
        ],
      };
    },
  ];
  return Array.from({ length: count }, (_, i) =>
    (templates[i % templates.length] as () => Planted)(),
  );
}

const SECRET = 'privacy evaluation: tags need only be stable';

async function measure(id: 'rules' | 'model', texts: Planted[], names?: NameFinder) {
  const shield = createShield({ secret: SECRET, names });
  const planted: Partial<Record<PiiKind, number>> = {};
  const leaked: Partial<Record<PiiKind, number>> = {};
  const examples: string[] = [];
  const times: number[] = [];
  for (const { text, values } of texts) {
    const started = performance.now();
    const out = (await shield.protect(text, 'prg_1')).text;
    times.push(performance.now() - started);
    for (const { kind, value } of values) {
      planted[kind] = (planted[kind] ?? 0) + 1;
      if (out.includes(value)) {
        leaked[kind] = (leaked[kind] ?? 0) + 1;
        if (examples.length < 5 && !examples.includes(out)) examples.push(out);
      }
    }
  }
  let goldenChanged = 0;
  for (const golden of GOLDEN.filter((g) => !g.tags.includes('personal'))) {
    if (Object.keys((await shield.protect(golden.text, 'prg_1')).found).length > 0)
      goldenChanged += 1;
  }
  const sum = (r: Partial<Record<PiiKind, number>>) =>
    Object.values(r).reduce((a, b) => a + (b ?? 0), 0);
  return {
    id,
    planted,
    leaked,
    plantedTotal: sum(planted),
    leakedTotal: sum(leaked),
    goldenChanged,
    p50Ms: Number(percentile(times, 0.5).toFixed(2)),
    p95Ms: Number(percentile(times, 0.95).toFixed(2)),
    examples,
  };
}

// The rules were tuned on generate(200, 7); what is reported is a sample they never saw.
const texts = generate(400, 11);
const detectors = [await measure('rules', texts)];
if (isNameModelCached()) detectors.push(await measure('model', texts, await createNameModel()));

const result = {
  measuredOn: new Date().toISOString().slice(0, 10),
  texts: texts.length,
  goldenCases: GOLDEN.filter((g) => !g.tags.includes('personal')).length,
  detectors,
};
const file = join(import.meta.dirname, 'privacy.json');
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
for (const d of detectors) {
  console.log(
    `${d.id}: ${d.leakedTotal} of ${d.plantedTotal} planted values reached the model ${JSON.stringify(d.leaked)}; golden cases changed: ${d.goldenChanged}; p50 ${d.p50Ms} ms, p95 ${d.p95Ms} ms`,
  );
}
console.log(`written to ${file}`);
