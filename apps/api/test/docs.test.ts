import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELIVERABLE_EVENT_TYPES, EVENT_TYPES } from '../src/domain/types.js';

const doc = readFileSync(join(import.meta.dirname, '../../../docs/events.md'), 'utf8');
const headings = [...doc.matchAll(/^## `([a-z_.]+)`/gm)].map((m) => m[1]);

describe('docs/events.md', () => {
  it('has a section for every event type and for nothing else', () => {
    expect([...headings].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('says which events a webhook can carry', () => {
    for (const type of EVENT_TYPES) {
      const section = doc.split(`## \`${type}\``)[1]?.split(/^## /m)[0] ?? '';
      const webhook = DELIVERABLE_EVENT_TYPES.includes(type as never);
      expect(section, type).toContain(webhook ? 'Webhook: yes' : 'Webhook: no');
    }
  });
});
