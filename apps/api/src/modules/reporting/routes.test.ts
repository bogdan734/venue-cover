import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/app.js';
import type { PolicyReport } from './policy-report.js';

let t: TestApp;
let finance: string; // reports, no program
let fhvReports: string; // reports, program 1 (direct bill)

const FHV = 'prg_1'; // direct bill
const RVT = 'prg_2'; // agency bill

beforeAll(async () => {
  t = await createTestApp();
  finance = await t.keyFor(null, ['reports:read']);
  fhvReports = await t.keyFor(FHV, ['reports:read']);
});
afterAll(() => t.close());

const get = (url: string, key = finance) =>
  t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${key}` } });

// Binds a policy for a program and says it was issued on `issuedOn`: the database stamps a policy with the real
// time, and these tests need a known month.
async function issued(
  programId: string,
  issuedOn: string,
): Promise<{ policyId: string; quoteId: string }> {
  const bound = await t.bindPolicy(programId);
  await t.db
    .updateTable('policy')
    .set({ issued_at: new Date(`${issuedOn}T15:00:00.000Z`) })
    .where('id', '=', bound.policyId)
    .execute();
  return bound;
}

describe('the policy report', () => {
  beforeAll(async () => {
    await issued(FHV, '2026-11-10');
    await issued(FHV, '2026-10-31');
    await issued(RVT, '2026-11-12');
  });

  const report = async (url: string, key?: string) => (await get(url, key)).json() as PolicyReport;

  it('lists the month of the key’s own program, and no other', async () => {
    const november = await report('/v1/reports/policies?month=2026-11', fhvReports);
    expect(november.program).toMatchObject({ id: FHV, code: 'FHV' });
    expect(november.lines).toHaveLength(1);
    expect(november.lines[0]).toMatchObject({
      program: 'Fairhaven Municipal Facilities',
      issuedOn: '2026-11-10',
      eventDate: '2026-12-20',
    });
    expect(november.summary.total.policies).toBe(1);

    const october = await report('/v1/reports/policies?month=2026-10', fhvReports);
    expect(october.lines).toHaveLength(1);
    expect(october.lines[0]?.issuedOn).toBe('2026-10-31');
  });

  it('lets a key without a program take every program, or name one', async () => {
    const all = await report('/v1/reports/policies?month=2026-11');
    expect(all.program).toBeNull();
    expect(all.lines.map((l) => l.program).sort()).toEqual([
      'Fairhaven Municipal Facilities',
      'Riverton School Board',
    ]);

    const one = await report(`/v1/reports/policies?month=2026-11&programId=${RVT}`);
    expect(one.program?.code).toBe('RVT');
    expect(one.lines).toHaveLength(1);
    expect(one.summary.total.totalCents).toBe(one.lines[0]?.totalCents);
  });

  it('keeps a program key out of other programs, and says so the way an unknown program is said', async () => {
    const other = await get(`/v1/reports/policies?month=2026-11&programId=${RVT}`, fhvReports);
    expect(other.statusCode).toBe(404);
    expect(other.json().error.code).toBe('program_not_found');
    const own = await get(`/v1/reports/policies?month=2026-11&programId=${FHV}`, fhvReports);
    expect(own.statusCode).toBe(200);
    const unknown = await get('/v1/reports/policies?month=2026-11&programId=prg_nope');
    expect(unknown.statusCode).toBe(404);
  });

  it('downloads the same lines as a spreadsheet', async () => {
    const response = await get(`/v1/reports/policies?month=2026-11&programId=${FHV}&format=csv`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="policies-2026-11-FHV.csv"',
    );
    const rows = response.body.split('\r\n').filter(Boolean);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('Birthday party');
    const json = await report(`/v1/reports/policies?month=2026-11&programId=${FHV}`);
    expect(rows[1]).toContain(((json.lines[0]?.totalCents ?? 0) / 100).toFixed(2));
  });

  it('refuses a missing or malformed month, and a key without the scope', async () => {
    for (const url of [
      '/v1/reports/policies',
      '/v1/reports/policies?month=2026-13',
      '/v1/reports/policies?month=nov',
    ]) {
      const response = await get(url);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation_error');
    }
    const quotesOnly = await t.keyFor(null, ['quotes:read']);
    expect((await get('/v1/reports/policies?month=2026-11', quotesOnly)).statusCode).toBe(403);
    const anonymous = await t.app.inject({
      method: 'GET',
      url: '/v1/reports/policies?month=2026-11',
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
