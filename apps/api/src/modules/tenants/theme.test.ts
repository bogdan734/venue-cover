import { describe, expect, it } from 'vitest';
import { generate } from '../../../../../data/generate.js';
import { contrast } from '../../domain/contrast.js';
import { canMove, problemsOf } from './index.js';

describe('contrast', () => {
  it('measures as WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#20408f', '#ffffff')).toBeGreaterThan(8);
  });
});

describe('problemsOf', () => {
  const base = { brand: '#20408f', logo: null, tagline: 'Insurance for your event', welcome: null };

  it('accepts a readable brand colour', () => {
    expect(problemsOf(base)).toEqual([]);
  });

  // White text sits on the brand colour in buttons, and the colour is the link colour on the page.
  it('refuses a brand colour that white text or the page cannot be read against', () => {
    expect(problemsOf({ ...base, brand: '#f5c518' })[0]).toMatch(/contrast/);
    expect(problemsOf({ ...base, brand: '#7fa2e8' })[0]).toMatch(/contrast/);
  });

  it('passes the looks the demo programs are seeded with', () => {
    for (const program of generate(42).programs) expect(problemsOf(program.theme)).toEqual([]);
  });

  it('takes a logo only as an image held in the page itself', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(problemsOf({ ...base, logo: png })).toEqual([]);
    expect(problemsOf({ ...base, logo: 'https://example.org/logo.png' })[0]).toMatch(/logo/);
    expect(problemsOf({ ...base, logo: 'data:text/html;base64,PHNjcmlwdD4=' })[0]).toMatch(/logo/);
  });
});

describe('canMove', () => {
  it('follows draft, test, live and paused', () => {
    expect(canMove('draft', 'test')).toBe(true);
    expect(canMove('test', 'draft')).toBe(true);
    expect(canMove('test', 'live')).toBe(true);
    expect(canMove('live', 'paused')).toBe(true);
    expect(canMove('paused', 'live')).toBe(true);
    expect(canMove('draft', 'live')).toBe(false);
    expect(canMove('live', 'draft')).toBe(false);
    expect(canMove('live', 'live')).toBe(false);
  });
});
