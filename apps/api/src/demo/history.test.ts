import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, NOW, type TestApp } from '../../test/app.js';
import { createKeywordLlm } from '../modules/intake/index.js';
import { type HistoryReport, playHistory } from './history.js';

let t: TestApp;
let report: HistoryReport;
let operator: string;
const DAY = 86_400_000;

beforeAll(async () => {
  t = await createTestApp();
  const keyword = createKeywordLlm();
  t.llm.handler = (request) => keyword.completeJson(request);
  report = await playHistory(
    { app: t.app, db: t.db, setClock: (at) => (t.now.value = at ?? NOW) },
    { days: 8, seed: 7, until: NOW },
  );
  operator = await t.keyFor(null, ['reports:read', 'programs:manage', 'referrals:decide']);
}, 120_000);
afterAll(() => t.close());

const get = async (url: string) =>
  (
    await t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${operator}` } })
  ).json();

describe('a month of invented history', () => {
  it('happens in the past, on every portal', async () => {
    expect(report.quotes).toBeGreaterThan(10);
    expect(report.policies).toBeGreaterThan(3);
    const stamps = await t.db.selectFrom('quote').select(['created_at', 'program_id']).execute();
    const from = NOW.getTime() - 8 * DAY;
    for (const s of stamps) {
      expect(s.created_at.getTime()).toBeGreaterThanOrEqual(from);
      expect(s.created_at.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
    expect(new Set(stamps.map((s) => s.program_id))).toEqual(new Set(['prg_1', 'prg_2', 'prg_3']));
  });

  it('adds up: the hub and the policy list agree', async () => {
    const { clients } = await get('/v1/hub/clients');
    const policies = await t.db.selectFrom('policy').select(['program_id', 'issued_at']).execute();
    for (const client of clients) {
      const own = policies.filter((p) => p.program_id === client.program.id).length;
      expect(client.policies).toBe(own);
      expect(client.visits).toBeGreaterThan(0);
    }
    const months = [...new Set(policies.map((p) => p.issued_at.toISOString().slice(0, 7)))];
    let lines = 0;
    for (const month of months) {
      lines += (await get(`/v1/reports/policies?month=${month}`)).lines.length;
    }
    expect(lines).toBe(policies.length);
  });

  it('leaves people work that is recent, and decided what is old', async () => {
    const open = await t.db
      .selectFrom('referral')
      .select('created_at')
      .where('state', '!=', 'decided')
      .execute();
    for (const r of open) expect(NOW.getTime() - r.created_at.getTime()).toBeLessThan(3 * DAY);
    const decided = await t.db
      .selectFrom('referral')
      .select(['created_at', 'decided_at'])
      .where('state', '=', 'decided')
      .execute();
    for (const r of decided)
      expect(r.decided_at?.getTime()).toBeGreaterThan(r.created_at.getTime());
    expect(report.conversations).toBeGreaterThan(0);
  });
});
