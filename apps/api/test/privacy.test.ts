import { describe, expect, it } from 'vitest';
import { EVENT_EXAMPLES, LETTER_EXAMPLES } from '../../../data/examples.js';
import { GOLDEN } from '../../../evals/golden.js';
import { createNameModel, createShield, isNameModelCached } from '../src/modules/privacy/index.js';

// The shield must not touch a text with nothing personal in it: every golden case and every example stays as written, so
// the recorded model answers still match and the measured accuracy is the accuracy with the shield on.
const PERSONAL = GOLDEN.filter((c) => c.tags.includes('personal')).map((c) => c.text);
const TEXTS = [
  ...GOLDEN.map((c) => c.text),
  ...EVENT_EXAMPLES.map((e) => e.text),
  ...LETTER_EXAMPLES.map((e) => e.text),
].filter((text) => !PERSONAL.includes(text));
const SECRET = 'a test secret that is long enough';

async function changed(names?: Parameters<typeof createShield>[0]['names']) {
  const shield = createShield({ secret: SECRET, names });
  const out: string[] = [];
  for (const text of TEXTS) {
    const { found } = await shield.protect(text, 'prg_1');
    if (Object.keys(found).length > 0) out.push(text);
  }
  return out;
}

describe('the shield on texts with nothing personal in them', () => {
  it('changes no golden case and no example, with rules alone', async () => {
    expect(await changed()).toEqual([]);
  });

  it.runIf(isNameModelCached())(
    'changes none with the names model either',
    async () => {
      expect(await changed(await createNameModel())).toEqual([]);
    },
    120_000,
  );
});

// The cases with personal details on purpose. The demo answers them from a recording keyed by the protected text, so the
// rules and the names model must protect them alike, or the demo with the model would miss its recorded answer.
describe('the shield on the cases with personal details', () => {
  const planted = [
    'Emma',
    '613-555-0182',
    'sarah.t@example.org',
    'Sarah Thompson',
    'Chloé',
    'Jean-François Gagnon',
    '514-555-0147',
  ];

  it('takes every detail out', async () => {
    const shield = createShield({ secret: SECRET });
    for (const text of PERSONAL) {
      const { text: out } = await shield.protect(text, 'prg_1');
      for (const value of planted) expect(out).not.toContain(value);
    }
  });

  it.runIf(isNameModelCached())(
    'protects them the same with the names model as with rules alone',
    async () => {
      const rules = createShield({ secret: SECRET });
      const model = createShield({ secret: SECRET, names: await createNameModel() });
      for (const text of PERSONAL) {
        expect((await model.protect(text, 'prg_1')).text).toBe(
          (await rules.protect(text, 'prg_1')).text,
        );
      }
    },
    120_000,
  );
});
