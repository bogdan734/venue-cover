import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENT_EXAMPLES, LETTER_EXAMPLES } from '../../../data/examples.js';
import { generate } from '../../../data/generate.js';
import { GOLDEN } from '../../../evals/golden.js';
import { EVAL_SHIELD, REFERENCE_RULES } from '../../../evals/runner.js';
import { seedDatabase } from '../src/db/seed.js';
import { createLexicalEmbedder, embedCatalogue } from '../src/modules/catalogue/index.js';
import {
  createRecordedLlm,
  interpretEvent,
  type LlmProvider,
  type Recording,
} from '../src/modules/intake/index.js';
import { draftRules } from '../src/modules/setup/index.js';
import { createTestDb, type TestDb } from './db.js';

// The demo answers its one-click examples from a recording. An example without a recorded answer would quietly fall
// back to the keyword reader, so this fails as soon as an example or a prompt changes without a new recording.
describe('the demo examples', () => {
  let t: TestDb;
  const embedder = createLexicalEmbedder();
  const recording = JSON.parse(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'evals', 'recordings', 'ollama.json'),
      'utf8',
    ),
  ) as Recording;
  const missed: string[] = [];
  const llm: LlmProvider = createRecordedLlm(recording, {
    async completeJson(request) {
      missed.push(request.user);
      throw new Error('not recorded');
    },
  });

  beforeAll(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, generate(42));
    await embedCatalogue(t.db, embedder);
  });
  afterAll(() => t.drop());

  it('have a recorded answer for every event description, and each is a case of the golden set', async () => {
    for (const example of EVENT_EXAMPLES) {
      const { text } = await EVAL_SHIELD.protect(example.text, 'prg_1');
      await interpretEvent({ db: t.db, llm, embedder }, { text, programId: 'prg_1' });
      expect(
        GOLDEN.some((g) => g.text === example.text),
        example.label,
      ).toBe(true);
    }
    expect(missed).toEqual([]);
  });

  it('have a recorded answer for every letter, and the slipped-in instruction changes nothing', async () => {
    const drafts = [];
    for (const letter of LETTER_EXAMPLES) {
      drafts.push(
        await draftRules(letter.text, REFERENCE_RULES, {
          db: t.db,
          llm,
          embedder,
          shield: EVAL_SHIELD,
        }),
      );
    }
    expect(missed).toEqual([]);
    expect(drafts[0]?.changes).toMatchObject({ alcoholAuto: false, maxParticipantsAuto: 150 });
    const tricked = drafts[2]?.changes ?? {};
    expect(Object.keys(tricked).sort()).toEqual([
      'excludedActivityIds',
      'limitsCents',
      'maxParticipantsAuto',
    ]);
  });
});
