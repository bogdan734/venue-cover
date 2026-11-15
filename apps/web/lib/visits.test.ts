import { describe, expect, it } from 'vitest';
import { isBot, visitKey } from './visits';

describe('visitKey', () => {
  const key = visitKey('secret', '203.0.113.7 Firefox', 'prg_1', '2026-11-14');

  it('is the same for a visitor on one day and differs the next day or on another portal', () => {
    expect(visitKey('secret', '203.0.113.7 Firefox', 'prg_1', '2026-11-14')).toBe(key);
    expect(visitKey('secret', '203.0.113.7 Firefox', 'prg_1', '2026-11-15')).not.toBe(key);
    expect(visitKey('secret', '203.0.113.7 Firefox', 'prg_2', '2026-11-14')).not.toBe(key);
  });

  it('holds nothing of the address', () => {
    expect(key).toMatch(/^visit:2026-11-14:[0-9a-f]{32}$/);
    expect(key).not.toContain('203');
  });
});

describe('isBot', () => {
  it('tells crawlers and previews from browsers', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBot('Slackbot-LinkExpanding 1.0')).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe(
      false,
    );
  });
});
