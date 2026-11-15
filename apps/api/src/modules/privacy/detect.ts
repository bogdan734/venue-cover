// Finds personal details in free text with rules: identifiers with a fixed shape (validated by checksum where one exists),
// street addresses, dates of birth, and names that a cue points at ("my daughter Emma", "Contact: Sarah Thompson").
// A names model finds more names; see names.ts. Nothing here calls out of the process.

export type PiiKind =
  | 'NAME'
  | 'EMAIL'
  | 'PHONE'
  | 'CARD'
  | 'SIN'
  | 'ID'
  | 'POSTAL'
  | 'ADDRESS'
  | 'DOB';

export interface Span {
  start: number;
  end: number;
  kind: PiiKind;
}

// On a tie in length, the more specific reading of the same characters wins.
const PRIORITY: readonly PiiKind[] = [
  'EMAIL',
  'CARD',
  'SIN',
  'PHONE',
  'POSTAL',
  'DOB',
  'ADDRESS',
  'NAME',
  'ID',
];

// A tag this module wrote earlier: `[KIND#ABC234]`. Nothing inside one is a personal detail.
export const TAG = /\[([A-Z]+)#([A-Z2-7]{6})\]/g;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// North American numbers (area code and exchange cannot start with 0 or 1), and anything written with a leading +.
const PHONE =
  /(?<![\d-])(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[ .-]?[2-9]\d{2}[ .-]?\d{4}(?![\d-])|\+\d{1,3}(?:[ .-]?\d{1,4}){2,5}(?![\d-])/g;
// Any run of nine or more digits, with single spaces or hyphens between groups. A checksum decides whether it is a card
// or a social insurance number; either way it is not left in the text.
const LONG_NUMBER = /(?<![\w-])\d(?:[ -]?\d){8,}(?![\w-])/g;
const SIN_CUE = /\b(?:SIN|social insurance|NAS|assurance sociale)\b[^\d]{0,20}$/i;
const POSTAL = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi;

const STREET =
  'Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Way|Place|Pl|Terrace|Trail|Parkway|Pkwy|Highway|Hwy|Circle|Square|Sq|Grove|Heights|Row|Close|Mews|Line';
const WORD = "\\p{Lu}[\\p{L}'’.-]*";
const ADDRESS_EN = new RegExp(
  `\\b\\d{1,6}[A-Za-z]?\\s+(?:${WORD}\\s+){1,4}(?:${STREET})\\b\\.?(?:\\s+(?:North|South|East|West|NE|NW|SE|SW|N|S|E|W)\\b)?`,
  'gu',
);
const ADDRESS_FR = new RegExp(
  `\\b\\d{1,6}(?:-\\d{1,4})?,?\\s+(?:rue|avenue|av\\.|boulevard|boul\\.|bd|chemin|ch\\.|place|route|rang|côte|montée|allée|impasse|promenade|croissant|terrasse)\\s+(?:(?:de la|du|des|de|d['’])\\s*)?${WORD}(?:[\\s-]+${WORD}){0,3}`,
  'giu',
);

const MONTHS =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';
const DATE = `\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|(?:${MONTHS})\\.? \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}|\\d{1,2} (?:${MONTHS})\\.? \\d{4}`;
// A date is a date of birth only when the text says so just before it; an event date is not personal.
const DOB = new RegExp(
  `(?:\\bborn|\\bdate of birth|\\bbirth ?date|\\bD\\.?O\\.?B\\.?|\\bnée? le|\\bdate de naissance)\\b[^\\d\\n]{0,12}?(${DATE})`,
  'giu',
);

// A name: one to three capitalised words, each with a lower-case letter (so "DJ" or "BBQ" is not one).
const NAME_WORD = "\\p{Lu}[\\p{L}'’]*(?:-\\p{Lu}[\\p{L}'’]*)*";
const NAME = `${NAME_WORD}(?: ${NAME_WORD}){0,2}`;
const RELATION =
  'son|daughter|wife|husband|partner|kid|child|boy|girl|friend|mom|mum|mother|dad|father|brother|sister|niece|nephew|grandson|granddaughter|grandma|grandpa|cousin|colleague|boss|fianc[ée]e?|aunt|uncle';
const PARENTE =
  'fille|fils|femme|mari|conjointe?|amie?|mère|père|frère|s(?:œ|oe)ur|nièce|neveu|petite-fille|petit-fils|cousine?|collègue|patronne?|fiancée?';
const CUE = [
  `\\bmy (?:${RELATION})(?:['’]s)?,?`,
  '\\bmy name is',
  "\\bI['’]m",
  '\\bI am',
  '\\bname\\s*:',
  '\\bcontact(?: person)?\\s*:?',
  '\\borgani[sz]ed by',
  '\\borgani[sz]er\\s*:?',
  '\\bhost(?:ed)? by',
  '\\bask for',
  '\\bcall',
  '\\be-?mail',
  '\\battn\\.?:?',
  '\\bc/o',
  '\\b(?:thanks|thank you|regards|cheers|sincerely),?',
  `\\b(?:ma|mon) (?:${PARENTE})`,
  "\\bje m['’]appelle",
  '\\bmon nom est',
  '\\borganisée? par',
  '\\bmerci,?',
  '\\bcordialement,?',
  '\\bde la part de',
].join('|');
// The cue is matched without regard to case, the name after it with it: "my name is Pat Lee and" stops before "and".
const CUE_BEFORE_NAME = new RegExp(`(?:${CUE})\\s+`, 'giu');
const NAME_HERE = new RegExp(NAME, 'uy');
const TITLE = /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Mme|Mlle|M)\.?\s+/u;
const TITLED_NAME = new RegExp(`${TITLE.source}(${NAME})`, 'gu');
// Capitalised words that a cue can be followed by without naming anyone.
const NOT_A_NAME = new Set([
  'Mr',
  'Mrs',
  'Ms',
  'Miss',
  'Mx',
  'Dr',
  'Prof',
  'Mme',
  'Mlle',
  'The',
  'A',
  'An',
  'Our',
  'My',
  'Your',
  'This',
  'That',
  'We',
  'You',
  'Hall',
  'Room',
  'Unit',
  'Saint',
  'St',
]);

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function* matches(pattern: RegExp, text: string, group = 0): Generator<[number, number]> {
  for (const m of text.matchAll(pattern)) {
    const value = m[group];
    if (value === undefined || m.index === undefined) continue;
    const start = m.index + (group === 0 ? 0 : m[0].indexOf(value));
    yield [start, start + value.length];
  }
}

// A cue may be followed by a title ("ask for Mr. Gagnon"), by words that are not names, or by a name that runs into the
// next sentence; trims to the name itself.
function nameIn(text: string, start: number, end: number): Span | null {
  const words = text.slice(start, end).split(' ');
  let first = 0;
  while (first < words.length && NOT_A_NAME.has((words[first] as string).replace(/\.$/, ''))) {
    first += 1;
  }
  const kept = words.slice(first);
  if (kept.length === 0 || kept.some((w) => w === w.toUpperCase())) return null;
  const offset = words.slice(0, first).join(' ').length + (first > 0 ? 1 : 0);
  return { start: start + offset, end, kind: 'NAME' };
}

function names(text: string): Span[] {
  const spans: Span[] = [];
  const keep = (start: number, end: number) => {
    const span = nameIn(text, start, end);
    if (span) spans.push(span);
  };
  for (const cue of text.matchAll(CUE_BEFORE_NAME)) {
    NAME_HERE.lastIndex = (cue.index ?? 0) + cue[0].length;
    const name = NAME_HERE.exec(text);
    if (name) keep(name.index, name.index + name[0].length);
  }
  for (const [start, end] of matches(TITLED_NAME, text, 1)) keep(start, end);
  return spans;
}

// Once a name is known, another mention of it, or of one of its words, is the same person ("Ms. Thompson").
export function mentionsOf(text: string, found: Span[]): Span[] {
  const words = new Set<string>();
  for (const span of found) {
    const name = text.slice(span.start, span.end);
    words.add(name);
    for (const word of name.split(/[\s]+/)) if (word.length >= 3) words.add(word);
  }
  const spans: Span[] = [];
  for (const word of words) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const [start, end] of matches(
      new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, 'gu'),
      text,
    )) {
      spans.push({ start, end, kind: 'NAME' });
    }
  }
  return spans;
}

// A capitalised word joined to a name by "and" ("Zara and Liam", "Léa et Chloé") is a name too, even where the model
// took it for a brand or a city.
export function coordinated(text: string, names: Span[]): Span[] {
  const word = "\\p{Lu}[\\p{L}'’-]*";
  const before = new RegExp(`(${word})\\s+(?:and|et|&)\\s+$`, 'u');
  const after = new RegExp(`^(?:['’]s)?\\s+(?:and|et|&)\\s+(${word})`, 'u');
  const found: Span[] = [];
  for (const name of names) {
    const left = before.exec(text.slice(0, name.start));
    if (left?.[1]) {
      const start = name.start - left[0].length;
      const span = nameIn(text, start, start + left[1].length);
      if (span) found.push(span);
    }
    const right = after.exec(text.slice(name.end));
    if (right?.[1]) {
      const start = name.end + right[0].length - right[1].length;
      const span = nameIn(text, start, start + right[1].length);
      if (span) found.push(span);
    }
  }
  return found;
}

// Of spans that overlap, the longest stays (on a tie, the more specific kind). The result is in text order.
export function resolve(spans: Span[]): Span[] {
  const ordered = [...spans].sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) || PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind),
  );
  const kept: Span[] = [];
  for (const span of ordered) {
    if (!kept.some((k) => span.start < k.end && k.start < span.end)) kept.push(span);
  }
  return kept.sort((a, b) => a.start - b.start);
}

// Where the text already carries tags, nothing inside them is looked at again.
export function tagRanges(text: string): [number, number][] {
  return [...matches(TAG, text)];
}

export function withoutTags(text: string, spans: Span[]): Span[] {
  const tags = tagRanges(text);
  return spans.filter((s) => !tags.some(([start, end]) => s.start < end && start < s.end));
}

export function detectRules(text: string): Span[] {
  const spans: Span[] = [];
  const add = (kind: PiiKind, pattern: RegExp, group = 0) => {
    for (const [start, end] of matches(pattern, text, group)) spans.push({ start, end, kind });
  };
  add('EMAIL', EMAIL);
  add('PHONE', PHONE);
  add('POSTAL', POSTAL);
  add('ADDRESS', ADDRESS_EN);
  add('ADDRESS', ADDRESS_FR);
  add('DOB', DOB, 1);
  for (const [start, end] of matches(LONG_NUMBER, text)) {
    const digits = text.slice(start, end).replace(/\D/g, '');
    const cued = SIN_CUE.test(text.slice(Math.max(0, start - 30), start));
    const kind: PiiKind =
      digits.length >= 13 && digits.length <= 19 && luhn(digits)
        ? 'CARD'
        : digits.length === 9 && luhn(digits) && (cued || /[ -]/.test(text.slice(start, end)))
          ? 'SIN'
          : 'ID';
    spans.push({ start, end, kind });
  }
  const cued = resolve(withoutTags(text, names(text)));
  const named = resolve([...cued, ...coordinated(text, cued)]);
  spans.push(...named, ...mentionsOf(text, named));
  return resolve(withoutTags(text, spans));
}
