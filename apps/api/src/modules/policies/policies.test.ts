import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/app.js';
import { pdfText } from '../../../test/pdf.js';
import { createCertificateHandler } from './index.js';

let t: TestApp;
let creator: string;
let rental: { ref: string; venueName: string; venueEmail: string };
let counter = 0;

beforeAll(async () => {
  t = await createTestApp();
  creator = await t.keyFor('prg_1', ['quotes:read', 'quotes:write', 'personal:read']);
  const row = await t.db
    .selectFrom('rental')
    .innerJoin('venue', 'venue.id', 'rental.venue_id')
    .select(['rental.ref', 'venue.name', 'venue.contact_email'])
    .where('rental.program_id', '=', 'prg_1')
    .orderBy('rental.ref')
    .executeTakeFirstOrThrow();
  rental = { ref: row.ref, venueName: row.name, venueEmail: row.contact_email };
});
afterAll(() => t.close());

const call = (method: 'GET' | 'POST', url: string, key = creator, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'idempotency-key': `p-${++counter}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });

// Quotes and binds a birthday party, optionally with a booking reference; returns the ids.
async function boundPolicy(bookingRef?: string) {
  const activityId = await t.activityId('Birthday party');
  const quote = (
    await call('POST', '/v1/quotes', creator, {
      activityId,
      participants: 40,
      hours: 4,
      alcohol: 'none',
      eventDate: '2026-12-20',
      startTime: '18:00',
      limitCents: 200_000_000,
      holder: { name: 'Pat Example', email: 'pat@example.org' },
      ...(bookingRef ? { bookingRef } : {}),
    })
  ).json();
  const bound = (
    await call('POST', `/v1/quotes/${quote.id}/bind`, creator, { paymentToken: 'tok_ok' })
  ).json();
  return {
    quoteId: quote.id as string,
    policyId: bound.policyId as string,
    policyNumber: bound.policyNumber as string,
  };
}

const mailFor = (policyNumber: string) =>
  t.mail.sent.filter((m) => m.subject.includes(policyNumber));
const eventsOf = async (type: string, policyId: string) =>
  (await t.db.selectFrom('outbox_event').select('data').where('type', '=', type).execute()).filter(
    (e) => (e.data as { policyId?: string }).policyId === policyId,
  );

describe('issuing a policy', () => {
  it('freezes what the certificates need and returns it', async () => {
    const { policyId, policyNumber } = await boundPolicy(rental.ref);
    const res = await call('GET', `/v1/policies/${policyId}`);
    expect(res.statusCode).toBe(200);
    const policy = res.json();
    expect(policy).toMatchObject({ id: policyId, policyNumber, programId: 'prg_1' });
    expect(policy.snapshot).toMatchObject({
      holder: { name: 'Pat Example' },
      activityTitle: 'Birthday party',
      bookingRef: rental.ref,
      limitCents: 200_000_000,
      routed: true,
      venue: { name: rental.venueName },
    });
    expect(policy.snapshot.premium.totalCents).toBe(policy.totalCents);
  });

  it('hides a policy from another program', async () => {
    const { policyId } = await boundPolicy();
    const other = await t.keyFor('prg_2', ['quotes:read']);
    expect((await call('GET', `/v1/policies/${policyId}`, other)).statusCode).toBe(404);
  });
});

describe('certificates', () => {
  it('routes the venue and the broker when the booking reference is known', async () => {
    const { policyId, policyNumber, quoteId } = await boundPolicy(rental.ref);
    await t.drain();
    const sent = mailFor(policyNumber);
    expect(sent.map((m) => m.to).sort()).toEqual(
      ['pat@example.org', rental.venueEmail, 'placements@northgate-brokerage.example'].sort(),
    );
    expect(sent.every((m) => m.attachment?.filename.endsWith('.pdf'))).toBe(true);
    const ready = await eventsOf('certificate.ready', policyId);
    expect(ready).toHaveLength(1);
    expect(ready[0]?.data).toMatchObject({ holders: ['insured', 'venue', 'broker'] });
    expect(await eventsOf('certificate.unrouted', policyId)).toEqual([]);
    expect((await call('GET', `/v1/quotes/${quoteId}`)).json().state).toBe('issued');
  });

  it('names the right holder on each certificate', async () => {
    const { policyId, policyNumber } = await boundPolicy(rental.ref);
    const text = async (holder: string) => {
      const res = await call('GET', `/v1/policies/${policyId}/certificates/${holder}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
      return pdfText(res.rawPayload);
    };
    const insured = await text('insured');
    const venue = await text('venue');
    const broker = await text('broker');
    for (const body of [insured, venue, broker]) {
      expect(body).toContain(policyNumber);
      expect(body).toContain('Pat Example'); // the insured is named on every certificate
    }
    expect(insured).toMatch(/Certificate holder\s*\n?Pat Example/);
    expect(venue).toContain(rental.venueName);
    expect(venue).toContain('venue');
    expect(broker).toContain('Northgate Brokerage');
  });

  it('issues only the insured certificate and raises a flag for an unknown booking reference', async () => {
    const { policyId, policyNumber } = await boundPolicy('R-9999');
    await t.drain();
    expect(mailFor(policyNumber).map((m) => m.to)).toEqual(['pat@example.org']);
    expect(await eventsOf('certificate.unrouted', policyId)).toHaveLength(1);
    expect((await call('GET', `/v1/policies/${policyId}`)).json().snapshot.routed).toBe(false);
    expect((await call('GET', `/v1/policies/${policyId}/certificates/insured`)).statusCode).toBe(
      200,
    );
    for (const holder of ['venue', 'broker']) {
      const res = await call('GET', `/v1/policies/${policyId}/certificates/${holder}`);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('certificate_not_issued');
    }
  });

  it('treats a missing booking reference like an unknown one', async () => {
    const { policyId, policyNumber } = await boundPolicy();
    await t.drain();
    expect(mailFor(policyNumber)).toHaveLength(1);
    expect(await eventsOf('certificate.unrouted', policyId)).toHaveLength(1);
  });

  it('does not mail twice when the event is handled again', async () => {
    const { policyId, policyNumber } = await boundPolicy(rental.ref);
    const handler = createCertificateHandler({ mail: t.mail });
    const event = {
      id: 'e',
      type: 'policy.issued' as const,
      programId: 'prg_1',
      occurredAt: '',
      data: { policyId },
    };
    await t.db.transaction().execute((trx) => handler(event, trx));
    await t.db.transaction().execute((trx) => handler(event, trx));
    expect(mailFor(policyNumber)).toHaveLength(3);
  });

  it('rejects an unknown holder', async () => {
    const { policyId } = await boundPolicy();
    expect((await call('GET', `/v1/policies/${policyId}/certificates/landlord`)).statusCode).toBe(
      400,
    );
  });
});
