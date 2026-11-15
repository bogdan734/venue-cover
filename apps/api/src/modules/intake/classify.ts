import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { newId } from '../../domain/ids.js';
import type { ActivityMatch, Classification, PhraseMatch } from '../../domain/types.js';
import { type Embedder, MATCH_FLOOR, matchActivities } from '../catalogue/index.js';
import { type Shield, seal } from '../privacy/index.js';
import { CLASS_RANK } from './classification.js';
import { extractFacts } from './extract.js';
import type { LlmProvider } from './llm.js';

export interface ClassifyDeps {
  db: Kysely<Database>;
  llm: LlmProvider;
  embedder: Embedder;
  shield: Shield;
}

const CANDIDATES = 3;

// Reads a description into facts and finds each activity in the catalogue. Writes nothing. The text must already be
// protected (a stored one is): the model is shown it as it is.
export async function interpretEvent(
  deps: Pick<ClassifyDeps, 'db' | 'llm' | 'embedder'>,
  input: { text: string; programId: string },
): Promise<Classification> {
  const { facts, degraded } = await extractFacts(input.text, deps.llm);
  const phrases = [...new Set(facts.activities.map((p) => p.trim()).filter(Boolean))];
  const candidates = await matchActivities(deps.db, phrases, deps.embedder, CANDIDATES);

  const matched: PhraseMatch[] = phrases.map((phrase, i) => {
    const list = candidates[i] ?? [];
    const top = list[0];
    return { phrase, candidates: list, accepted: top && top.score >= MATCH_FLOOR ? top : null };
  });

  const accepted = matched.flatMap((m) => (m.accepted ? [m.accepted] : []));
  const primary = accepted.reduce<ActivityMatch | null>(
    (best, a) =>
      !best ||
      CLASS_RANK[a.riskClass] > CLASS_RANK[best.riskClass] ||
      (a.riskClass === best.riskClass && a.score > best.score)
        ? a
        : best,
    null,
  );
  const confidence =
    matched.length === 0 ? 0 : Math.min(...matched.map((m) => m.candidates[0]?.score ?? 0));

  return {
    id: newId('cls'),
    programId: input.programId,
    facts,
    phrases: matched,
    riskClass: primary?.riskClass ?? null,
    primary,
    confidence,
    degraded,
  };
}

// Protects a description, interprets it and stores the outcome: the text with its tags, and what the tags stand for
// sealed with the program's key. The original is kept nowhere else.
export async function classifyEvent(
  deps: ClassifyDeps,
  input: { text: string; programId: string },
): Promise<Classification> {
  const shielded = await deps.shield.protect(input.text, input.programId);
  const classification = await interpretEvent(deps, {
    text: shielded.text,
    programId: input.programId,
  });
  const hidden = Object.keys(shielded.vault).length > 0;
  await deps.db
    .insertInto('classification')
    .values({
      id: classification.id,
      program_id: input.programId,
      masked_text: shielded.text,
      vault: hidden
        ? seal(shielded.vault, deps.shield.keys(input.programId).seal, classification.id)
        : null,
      facts: JSON.stringify(classification.facts),
      matches: JSON.stringify(classification.phrases),
      risk_class: classification.riskClass,
      confidence: classification.confidence,
      degraded: classification.degraded,
    })
    .execute();
  return classification;
}
