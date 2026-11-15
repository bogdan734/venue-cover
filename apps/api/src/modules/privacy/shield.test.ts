import { describe, expect, it } from 'vitest';
import { createShield, guardLlm, keysFor, open, reveal, seal, tagOf } from './index.js';

const SECRET = 'a test secret that is long enough';
const TEXT =
  'Birthday for my daughter Emma at 45 Maple Ave. Call me at 613-555-0182 or sarah.t@example.org. Thanks, Sarah Thompson';

describe('keysFor', () => {
  it('gives each program its own keys, and different keys for tags and for sealing', () => {
    const first = keysFor(SECRET, 'prg_1');
    expect(first.tag.equals(keysFor(SECRET, 'prg_1').tag)).toBe(true);
    expect(first.tag.equals(keysFor(SECRET, 'prg_2').tag)).toBe(false);
    expect(first.tag.equals(keysFor(SECRET, null).tag)).toBe(false);
    expect(first.tag.equals(first.seal)).toBe(false);
    expect(first.seal).toHaveLength(32);
  });

  it('refuses a secret too short to be one', () => {
    expect(() => keysFor('short', 'prg_1')).toThrow(/at least 16/);
  });
});

describe('tagOf', () => {
  it('gives one value one tag in a program, and another in the next', () => {
    const [here, there] = [keysFor(SECRET, 'prg_1').tag, keysFor(SECRET, 'prg_2').tag];
    const tag = tagOf('PHONE', '613-555-0182', here);
    expect(tag).toMatch(/^\[PHONE#[A-Z2-7]{6}\]$/);
    expect(tagOf('PHONE', '+1 (613) 555 0182', here)).toBe(tag);
    expect(tagOf('PHONE', '613-555-0182', there)).not.toBe(tag);
    expect(tagOf('NAME', 'Sarah  Thompson', here)).toBe(tagOf('NAME', 'sarah thompson', here));
  });
});

describe('seal and open', () => {
  const key = keysFor(SECRET, 'prg_1').seal;
  const vault = { '[NAME#AAAAAA]': 'Sarah Thompson' };

  it('opens only with its program’s key and for its own record', () => {
    const sealed = seal(vault, key, 'cls_1');
    expect(sealed).not.toContain('Sarah');
    expect(open(sealed, key, 'cls_1')).toEqual(vault);
    expect(() => open(sealed, keysFor(SECRET, 'prg_2').seal, 'cls_1')).toThrow();
    expect(() => open(sealed, key, 'cls_2')).toThrow();
    // One character in the middle carries six bits of the ciphertext; changing it must be noticed.
    const at = Math.floor(sealed.length / 2);
    const other = sealed[at] === 'A' ? 'B' : 'A';
    expect(() =>
      open(`${sealed.slice(0, at)}${other}${sealed.slice(at + 1)}`, key, 'cls_1'),
    ).toThrow();
  });

  it('seals the same vault differently each time', () => {
    expect(seal(vault, key, 'cls_1')).not.toBe(seal(vault, key, 'cls_1'));
  });
});

describe('the shield', () => {
  const shield = createShield({ secret: SECRET });

  it('replaces every personal detail with a tag, and revealing gives the text back', async () => {
    const shielded = await shield.protect(TEXT, 'prg_1');
    for (const value of ['Emma', 'Maple', '555-0182', 'sarah.t@', 'Sarah', 'Thompson']) {
      expect(shielded.text).not.toContain(value);
    }
    expect(shielded.text).toMatch(/^Birthday for my daughter \[NAME#[A-Z2-7]{6}\] at \[ADDRESS#/);
    expect(shielded.found).toEqual({ NAME: 2, ADDRESS: 1, PHONE: 1, EMAIL: 1 });
    expect(reveal(shielded.text, shielded.vault)).toBe(TEXT);
  });

  it('uses the names model as well, and tags its later mentions too', async () => {
    const withModel = createShield({
      secret: SECRET,
      names: async (text) => {
        const at = text.indexOf('Liam Chen');
        return at < 0 ? [] : [{ start: at, end: at + 9, kind: 'NAME' }];
      },
    });
    const shielded = await withModel.protect('Party for Liam Chen. Liam turns ten.', 'prg_1');
    expect(shielded.text).toMatch(
      /^Party for \[NAME#[A-Z2-7]{6}\]\. \[NAME#[A-Z2-7]{6}\] turns ten\.$/,
    );
  });

  it('takes a word joined by "and" to a name the model found for a name too', async () => {
    const withModel = createShield({
      secret: SECRET,
      names: async (text) => {
        const at = text.indexOf('Liam');
        return at < 0 ? [] : [{ start: at, end: at + 4, kind: 'NAME' }];
      },
    });
    const shielded = await withModel.protect("Zara and Liam's party, 40 guests", 'prg_1');
    expect(shielded.text).toMatch(
      /^\[NAME#[A-Z2-7]{6}\] and \[NAME#[A-Z2-7]{6}\]'s party, 40 guests$/,
    );
  });

  it('leaves a text without personal details, and a text it already protected, as they are', async () => {
    const plain = 'Yoga class for 20 people, 2 hours, no alcohol';
    expect(await shield.protect(plain, 'prg_1')).toEqual({ text: plain, vault: {}, found: {} });
    const once = await shield.protect(TEXT, 'prg_1');
    expect((await shield.protect(once.text, 'prg_1')).text).toBe(once.text);
  });

  it('reveals only the tags it has values for', () => {
    expect(reveal('Hi [NAME#AAAAAA] and [NAME#BBBBBB]', { '[NAME#AAAAAA]': 'Pat' })).toBe(
      'Hi Pat and [NAME#BBBBBB]',
    );
  });
});

describe('guardLlm', () => {
  it('strips what still looks personal from the untrusted part of a prompt before the model gets it', async () => {
    const seen: string[] = [];
    const guarded = guardLlm(
      {
        async completeJson(request) {
          seen.push(request.user);
          return {};
        },
      },
      createShield({ secret: SECRET }).detect,
    );
    await guarded.llm.completeJson({
      system: 'You read events.',
      user: 'Party, call 613-555-0182',
      schema: {},
    });
    await guarded.llm.completeJson({ system: 'You read events.', user: 'Party', schema: {} });
    expect(seen).toEqual(['Party, call [PHONE]', 'Party']);
    expect(guarded.stats()).toEqual({ calls: 2, stripped: 1 });
  });
});
