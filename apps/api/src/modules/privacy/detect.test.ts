import { describe, expect, it } from 'vitest';
import { detectRules, type PiiKind, resolve } from './detect.js';

// What the rules find in a text, as [kind, the text it covers].
const found = (text: string): [PiiKind, string][] =>
  detectRules(text).map((span) => [span.kind, text.slice(span.start, span.end)]);

describe('detectRules', () => {
  it.each<[string, [PiiKind, string][]]>([
    ['Write to sarah.t@example.org today', [['EMAIL', 'sarah.t@example.org']]],
    ['mail me at a.b+c@example.co.uk now', [['EMAIL', 'a.b+c@example.co.uk']]],
    ['call 4165550199 today', [['PHONE', '4165550199']]],
    ['Call 613-555-0182 after six', [['PHONE', '613-555-0182']]],
    ['or (613) 555 0182', [['PHONE', '(613) 555 0182']]],
    ['Mobile +1 613.555.0182.', [['PHONE', '+1 613.555.0182']]],
    ['Abroad: +44 20 7946 0958', [['PHONE', '+44 20 7946 0958']]],
    ['Card 4111 1111 1111 1111 for the deposit', [['CARD', '4111 1111 1111 1111']]],
    ['My SIN is 046 454 286', [['SIN', '046 454 286']]],
    ['Postal code K1P 5J2, Ottawa', [['POSTAL', 'K1P 5J2']]],
    ['at h3b2y5', [['POSTAL', 'h3b2y5']]],
    ['The hall at 45 Maple Ave, Ottawa', [['ADDRESS', '45 Maple Ave']]],
    ['Unit 4, 1200 Bay Street North', [['ADDRESS', '1200 Bay Street North']]],
    ['Au 1234 rue Sainte-Catherine Ouest', [['ADDRESS', '1234 rue Sainte-Catherine Ouest']]],
    ['salle au 350 boul. René-Lévesque', [['ADDRESS', '350 boul. René-Lévesque']]],
    ['The bride was born 1994-03-12 in Quebec', [['DOB', '1994-03-12']]],
    ['Date of birth: March 12, 2014', [['DOB', 'March 12, 2014']]],
    ['Chloé, née le 12 mars 2014', [['DOB', '12 mars 2014']]],
  ])('finds the identifier in %j', (text, expected) => {
    expect(found(text)).toEqual(expected);
  });

  it.each<[string, string[]]>([
    ['Party for my daughter Emma, 25 kids', ['Emma']],
    ['Contact: Sarah Thompson, any time', ['Sarah Thompson']],
    ['My name is Pat Lee and I run the club', ['Pat Lee']],
    ['Ask for Mr. Gagnon at the door', ['Gagnon']],
    ['Fête pour ma fille Chloé, 30 invités', ['Chloé']],
    ["Je m'appelle Jean-François Gagnon", ['Jean-François Gagnon']],
    ['Ice cream social, 40 people. Thanks, Sarah', ['Sarah']],
    // A later mention of part of a name is the same person.
    [
      'Organized by Sarah Thompson. Ms. Thompson will open the hall.',
      ['Sarah Thompson', 'Thompson'],
    ],
    // A capitalised word joined by "and" to a name is a name too.
    ['Party for my daughter Emma and Liam, 30 kids', ['Emma', 'Liam']],
    ['Fête pour ma fille Léa et Chloé, 20 invités', ['Léa', 'Chloé']],
  ])('finds the names a cue points at in %j', (text, names) => {
    expect(
      found(text)
        .filter(([kind]) => kind === 'NAME')
        .map(([, value]) => value),
    ).toEqual(names);
  });

  // A checksum decides what a long number is called; a long number is never left in the text either way.
  it('tells a card and a SIN from numbers that only look like them', () => {
    expect(found('Card 4111 1111 1111 1112 please')).toEqual([['ID', '4111 1111 1111 1112']]);
    expect(found('SIN 123 456 789')).toEqual([['ID', '123 456 789']]);
    expect(found('Account 00123456789')).toEqual([['ID', '00123456789']]);
  });

  it.each([
    'Ice hockey game for 40 players, 2 hours, no alcohol',
    'Canada Day picnic for 200 people on July 1, 6pm to 11pm',
    'A $2,000,000 limit, booking R-1001, risk class B',
    'Wedding reception, 150 guests, bar with SmartServe staff, 3 hours drive from Ottawa',
    'Yoga class for 20 people at Room 4, St. Paul Hall',
    'Tournoi de soccer, 2 heures, 60 joueurs, Club Saint-Laurent',
    'Fundraiser gala on 2026-12-14 for 300 guests',
    '60 guests for 4 hours at 6pm',
  ])('leaves an event without personal details alone: %j', (text) => {
    expect(found(text)).toEqual([]);
  });

  it('ignores the tags of a text that was already protected', () => {
    expect(found('Party for [NAME#K3Q2A7] at [ADDRESS#7K3Q2A], call [PHONE#Q2A7K3]')).toEqual([]);
  });
});

describe('resolve', () => {
  it('keeps the longest of overlapping spans, and the more specific kind on a tie', () => {
    const spans = resolve([
      { start: 0, end: 5, kind: 'NAME' },
      { start: 3, end: 12, kind: 'ADDRESS' },
      { start: 20, end: 30, kind: 'ID' },
      { start: 20, end: 30, kind: 'PHONE' },
    ]);
    expect(spans).toEqual([
      { start: 3, end: 12, kind: 'ADDRESS' },
      { start: 20, end: 30, kind: 'PHONE' },
    ]);
  });
});
