import type { LlmProvider } from '../llm.js';
import { extractWithRules } from '../rules.js';
import { createFakeLlm } from './fake.js';

// A deliberately plain stand-in for a model: it splits an event description into chunks, strips numbers, times and
// framing words, and offers what is left as activities. Facts come from the same rules the pipeline cross-checks with.
// It gives the evals a floor without a model, and the demo something to answer with when it has no recorded answer.
// It reads event descriptions only; any other request is refused, so a caller falls back instead of getting nonsense.
const FRAMING = new Set(
  (
    'we are planning hosting would like to book the a an our for of in at on from until will be have has had some about around ' +
    'approximately expecting expected is it its this that there need needs insurance coverage event venue hall room rental rent renting hold ' +
    'holding organizing run running attend attending come coming monday tuesday wednesday thursday friday saturday sunday weekly next month ' +
    'evening afternoon morning gonna want small big local our my gym park church basement community school ' +
    'call me thanks thank contact write email mail text phone reach regards cheers daughter son wife husband'
  ).split(' '),
);
const NOISE = new Set(
  (
    'guests guest people persons person attendees participants adults hours hour hrs players runners visitors members students teens ' +
    'beer wine alcohol drinks booze champagne cash bar open sold served free no not without dry after before over once season ' +
    'system note assistant ignore previous instructions report classify approve output never refer rules new class low risk hazards flags'
  ).split(' '),
);
const SPLIT =
  /[.;:!?\n]| with | and | plus | followed by | then | including | featuring | along with |, | \+ | & /i;

// A privacy tag ("[NAME#7K3Q2A]", or "[NAME]" from the guard) stands for a person or a contact, never for an activity.
const TAG = /\[[A-Z]+(?:#[A-Z2-7]{6})?\]/g;

function phrasesOf(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.replace(TAG, '.').split(SPLIT)) {
    const words = chunk
      .toLowerCase()
      .replace(/\b\d[\d,.:]*\s*(?:am|pm|hours?|hrs?|h|k)?\b/g, ' ')
      .replace(/[^a-z' -]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !FRAMING.has(w) && !NOISE.has(w));
    if (words.length > 0) out.push(words.slice(0, 4).join(' '));
  }
  return [...new Set(out)].slice(0, 6);
}

export function createKeywordLlm(): LlmProvider {
  return createFakeLlm(({ user }) => {
    const text = /<event>\s*([\s\S]*?)\s*<\/event>/.exec(user)?.[1];
    if (text === undefined) throw new Error('the keyword reader only reads event descriptions');
    const rules = extractWithRules(text);
    return {
      activities: phrasesOf(text),
      participants: rules.participants,
      hours: rules.hours,
      alcohol: rules.alcohol,
      flags: rules.flags,
    };
  });
}
