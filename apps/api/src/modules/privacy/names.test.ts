import { describe, expect, it } from 'vitest';
import { createNameModel, type Entity, isNameModelCached, spansFromEntities } from './names.js';

// The model's own answers for these texts (captured from it), so that putting the pieces back together is tested
// without the model.
const entities = (rows: [string, number, number, string][]): Entity[] =>
  rows.map(([entity, score, index, word]) => ({ entity, score, index, word }));

const names = (text: string, found: Entity[]) =>
  spansFromEntities(text, found).map((span) => text.slice(span.start, span.end));

describe('spansFromEntities', () => {
  it('joins word pieces into names and skips places', () => {
    const text =
      'Birthday party for my daughter Emma at 45 Maple Ave, 25 kids. Call me at 613-555-0182, Sarah Thompson';
    const found = entities([
      ['B-PER', 0.9996, 6, 'Emma'],
      ['B-LOC', 0.999, 9, 'Maple'],
      ['I-LOC', 0.991, 10, 'Ave'],
      ['B-PER', 0.9999, 25, 'Sarah'],
      ['I-PER', 0.9996, 26, 'Thompson'],
    ]);
    expect(names(text, found)).toEqual(['Emma', 'Sarah Thompson']);
  });

  it('keeps a name whole when the model calls part of it a place, and joins hyphens and apostrophes', () => {
    const french =
      "Fête d'anniversaire pour Chloé Tremblay, 30 invités, organisée par Jean-François Gagnon";
    const frenchFound = entities([
      ['B-PER', 0.658, 7, 'Ch'],
      ['I-PER', 0.77, 8, '##lo'],
      ['I-LOC', 0.713, 9, '##é'],
      ['I-LOC', 0.919, 10, 'Tre'],
      ['I-LOC', 0.679, 11, '##mb'],
      ['I-LOC', 0.825, 12, '##lay'],
      ['B-PER', 1, 20, 'Jean'],
      ['I-PER', 0.999, 21, '-'],
      ['I-PER', 1, 22, 'François'],
      ['I-PER', 1, 23, 'Ga'],
      ['I-PER', 1, 24, '##gnon'],
    ]);
    expect(names(french, frenchFound)).toEqual(['Chloé Tremblay', 'Jean-François Gagnon']);

    const english = "Wedding of Priya Natarajan and Owen O'Brien, 120 guests";
    const englishFound = entities([
      ['B-PER', 0.999, 3, 'Pri'],
      ['I-PER', 0.998, 4, '##ya'],
      ['I-PER', 0.997, 5, 'Nat'],
      ['I-PER', 0.992, 6, '##ara'],
      ['I-PER', 0.998, 7, '##jan'],
      ['B-PER', 1, 9, 'Owen'],
      ['I-PER', 0.999, 10, 'O'],
      ['I-PER', 0.999, 11, "'"],
      ['I-PER', 0.999, 12, 'Brien'],
    ]);
    expect(names(english, englishFound)).toEqual(['Priya Natarajan', "Owen O'Brien"]);
  });

  it('ignores a person the model is unsure of', () => {
    expect(names('Party with Grace', entities([['B-PER', 0.3, 3, 'Grace']]))).toEqual([]);
  });

  // A capital letter at the start of a sentence says nothing, so a lone word there needs a surer model: a misspelt
  // "Brdal shower" is not a person, "Emma and Liam" is.
  it('asks for more certainty about a single word that starts a sentence', () => {
    expect(
      names(
        'Brdal shower for 35 guests',
        entities([
          ['B-PER', 0.802, 1, 'Br'],
          ['I-PER', 0.7, 2, '##dal'],
        ]),
      ),
    ).toEqual([]);
    expect(
      names(
        "Emma and Liam's party. Grace helps.",
        entities([
          ['B-PER', 0.9988, 1, 'Emma'],
          ['B-PER', 0.999, 3, 'Liam'],
          ['B-PER', 0.85, 9, 'Grace'],
        ]),
      ),
    ).toEqual(['Emma', 'Liam']);
  });
});

// Runs where the model has been downloaded (`npm run demo` does it on first use when asked to).
describe.runIf(isNameModelCached())('the names model', () => {
  it('finds names with no cue, in English and in French', async () => {
    const find = await createNameModel();
    const text =
      "Emma and Liam's joint birthday, 30 guests. Fête organisée par Jean-François Gagnon.";
    const spans = await find(text);
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual([
      'Emma',
      'Liam',
      'Jean-François Gagnon',
    ]);
  }, 60_000);
});
