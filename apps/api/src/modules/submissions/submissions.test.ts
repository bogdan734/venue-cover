import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  blankForm,
  filledForm,
  flatPdf,
  sampleValues,
} from '../../../../../data/submission-form.js';
import { createTestApp, type TestApp } from '../../../test/app.js';
import { multipart } from '../../../test/multipart.js';
import {
  ATTACHMENT_KINDS,
  checkCompleteness,
  draftReply,
  NoFormFieldsError,
  parseSubmission,
} from './index.js';

describe('parseSubmission', () => {
  it('reads every field of a filled form', async () => {
    const { facts, unreadable } = await parseSubmission(await filledForm(sampleValues()));
    expect(unreadable).toEqual([]);
    expect(facts).toMatchObject({
      organizerName: 'Riverside Music Society',
      contactEmail: 'alex@riverside-music.example',
      eventDate: '2027-06-19',
      startTime: '12:00',
      endTime: '23:00',
      eventDays: 2,
      dailyMin: 800,
      dailyMax: 2500,
      totalAttendance: 4200,
      shareUnder18: 0.2,
      lastYearDailyMax: 2300,
      temporarySeats: 300,
      vendors: {
        food: 12,
        liquor: 2,
        performer: 6,
        retail: 10,
        animal: 0,
        carnival: 0,
        dunk_tank: 0,
        inflatable: 0,
        security: 2,
      },
      alcoholServedBy: 'vendors',
      serverTraining: true,
      pyrotechnics: false,
      overnight: false,
      priorClaims: false,
      refusedBefore: false,
      truthful: true,
      limitDollars: 2_000_000,
      signedBy: 'Alex Morgan',
    });
  });

  it('reads a blank form as blank, not as zero or no', async () => {
    const { facts } = await parseSubmission(await blankForm());
    expect(facts.dailyMax).toBeNull();
    expect(facts.priorClaims).toBeNull();
    expect(facts.vendors).toBeUndefined();
    expect(facts.alcoholServedBy).toBeNull();
  });

  it('reports a box that holds the wrong kind of answer', async () => {
    const { facts, unreadable } = await parseSubmission(
      await filledForm(sampleValues({ dailyMax: 'about two thousand', temporarySeats: '3o0' })),
    );
    expect(unreadable.sort()).toEqual(['dailyMax', 'temporarySeats']);
    expect(facts.dailyMax).toBeNull();
  });

  it('refuses a PDF without form fields instead of guessing', async () => {
    await expect(parseSubmission(await flatPdf())).rejects.toThrow(NoFormFieldsError);
  });
});

describe('checkCompleteness', () => {
  const parse = async (over = {}) =>
    (await parseSubmission(await filledForm(sampleValues(over)))).facts;

  it('is ready for a complete application', async () => {
    expect(checkCompleteness(await parse(), [])).toEqual({
      missing: [],
      requiredAttachments: [],
      ready: true,
    });
  });

  it('reports a blank answer as missing, never as a default', async () => {
    const result = checkCompleteness(await parse({ priorClaims: '', refusedBefore: '' }), []);
    // an empty string selects nothing, so these stay unanswered
    expect(result.missing.map((m) => m.field).sort()).toEqual(['priorClaims', 'refusedBefore']);
    expect(result.ready).toBe(false);
  });

  it('asks about server training only when alcohol is served', async () => {
    const none = checkCompleteness(
      (
        await parseSubmission(
          await filledForm(
            sampleValues({
              alcoholServedBy: 'none',
              serverTraining: undefined,
              vendor_liquor: '0',
            }),
          ),
        )
      ).facts,
      [],
    );
    expect(none.missing.map((m) => m.field)).not.toContain('serverTraining');
    const served = checkCompleteness(
      (await parseSubmission(await filledForm(sampleValues({ serverTraining: undefined })))).facts,
      [],
    );
    expect(served.missing.map((m) => m.field)).toContain('serverTraining');
  });

  it('needs the confirmation and a valid e-mail address and time range', async () => {
    const result = checkCompleteness(
      await parse({ truthful: 'no', contactEmail: 'not-an-address', endTime: '12:00' }),
      [],
    );
    expect(result.missing.map((m) => m.field).sort()).toEqual([
      'contactEmail',
      'endTime',
      'truthful',
    ]);
  });

  it('requires four documents above 3,000 a day, five with a security firm, and drops those that came', async () => {
    const big = await parse({ dailyMax: '3500', vendor_security: '0' });
    expect(checkCompleteness(big, []).requiredAttachments).toEqual([
      'risk_plan',
      'security_protocol',
      'site_map',
      'venue_contract',
    ]);
    const withSecurity = await parse({ dailyMax: '3500', vendor_security: '2' });
    expect(checkCompleteness(withSecurity, []).requiredAttachments).toHaveLength(5);
    expect(checkCompleteness(withSecurity, ['risk_plan', 'site_map']).requiredAttachments).toEqual([
      'security_protocol',
      'venue_contract',
      'security_contract',
    ]);
    expect(checkCompleteness(big, ATTACHMENT_KINDS as never).ready).toBe(true);
    expect(checkCompleteness(await parse({ dailyMax: '3000' }), []).requiredAttachments).toEqual(
      [],
    );
  });
});

describe('draftReply', () => {
  it('lists what is missing in plain words and says nothing about the assessment', async () => {
    const facts = (
      await parseSubmission(await filledForm(sampleValues({ dailyMax: '3500', priorClaims: '' })))
    ).facts;
    const text = draftReply(checkCompleteness(facts, []), 'Riverside Music Society');
    expect(text).toContain('Dear Riverside Music Society,');
    expect(text).toContain('whether there was a claim in the last five years');
    expect(text).toContain('a risk management plan');
    expect(text).toContain('a map of the event');
    expect(text).not.toMatch(/referral|underwriter|score|risk class/i);
  });

  it('thanks the applicant when nothing is missing', async () => {
    const facts = (await parseSubmission(await filledForm(sampleValues()))).facts;
    expect(draftReply(checkCompleteness(facts, []), null)).toMatch(
      /^Dear applicant,[\s\S]*everything we need/,
    );
  });
});

describe('POST /v1/submissions', () => {
  let t: TestApp;
  let key: string;
  let uw: string;
  let counter = 0;
  beforeAll(async () => {
    t = await createTestApp();
    key = await t.keyFor('prg_1', ['quotes:read', 'quotes:write', 'personal:read']);
    uw = await t.keyFor(null, ['referrals:decide', 'personal:read']);
    t.llm.handler = () => ({
      activities: ['music festival vendors'],
      participants: 2500,
      hours: 22,
      alcohol: 'sold',
      flags: [],
    });
  });
  afterAll(() => t.close());

  const upload = async (
    values = sampleValues(),
    attachments: { kind: string; data?: string }[] = [],
    over: { key?: string; idem?: string; form?: Uint8Array } = {},
  ) => {
    const body = multipart([
      {
        name: 'form',
        filename: 'application.pdf',
        contentType: 'application/pdf',
        data: over.form ?? (await filledForm(values)),
      },
      ...attachments.map((a) => ({
        name: a.kind,
        filename: `${a.kind}.pdf`,
        contentType: 'application/pdf',
        data: a.data ?? '%PDF-1.4 stub',
      })),
    ]);
    return t.app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: {
        authorization: `Bearer ${over.key ?? key}`,
        'idempotency-key': over.idem ?? `sub-${++counter}`,
        ...body.headers,
      },
      payload: body.payload,
    });
  };

  it('turns a complete application into a referred quote with the details for the worksheet', async () => {
    const res = await upload();
    expect(res.statusCode).toBe(201);
    const view = res.json();
    expect(view).toMatchObject({ state: 'ready', missing: [], requiredAttachments: [] });
    expect(view.quoteId).toMatch(/^qte_/);

    const quote = (
      await t.app.inject({
        method: 'GET',
        url: `/v1/quotes/${view.quoteId}`,
        headers: { authorization: `Bearer ${key}` },
      })
    ).json();
    expect(quote).toMatchObject({ state: 'referred', holder: { name: 'Riverside Music Society' } });
    expect(quote.referralReasons).toContain('OVER_CAPACITY');
    expect(quote.input).toMatchObject({
      participants: 2500,
      hours: 22,
      alcohol: 'sold',
      limitCents: 200_000_000,
    });
    expect(quote.premium.totalCents).toBeGreaterThan(0); // priced at the largest band, to start from

    const referral = await t.db
      .selectFrom('referral')
      .select('id')
      .where('quote_id', '=', view.quoteId)
      .executeTakeFirstOrThrow();
    const worksheet = (
      await t.app.inject({
        method: 'GET',
        url: `/v1/referrals/${referral.id}/worksheet`,
        headers: { authorization: `Bearer ${uw}` },
      })
    ).json();
    const byId = Object.fromEntries(
      worksheet.lines.map((l: { id: string; amountCents: number }) => [l.id, l.amountCents]),
    );
    expect(byId['vendor:liquor']).toBe(12_000);
    expect(byId['vendor:security']).toBe(-8000);
    expect(byId.seats).toBeGreaterThan(0);
    expect(byId.claims).toBe(0);
    expect(worksheet.lines.find((l: { id: string }) => l.id === 'claims').basis).not.toMatch(
      /not provided/,
    );
    expect(worksheet.lines.find((l: { id: string }) => l.id === 'vendors')).toBeUndefined();
  });

  it('does not open a quote for an incomplete application and drafts the reply', async () => {
    const res = await upload(sampleValues({ priorClaims: '', description: '' }));
    expect(res.statusCode).toBe(201);
    const view = res.json();
    expect(view.state).toBe('incomplete');
    expect(view.quoteId).toBeNull();
    expect(view.missing.map((m: { field: string }) => m.field).sort()).toEqual([
      'description',
      'priorClaims',
    ]);
    expect(view.draftReply).toContain('whether there was a claim in the last five years');
  });

  it('asks for the documents of a big event and goes ahead once they are attached', async () => {
    const values = sampleValues({ dailyMax: '3500', vendor_security: '0' });
    const first = (await upload(values)).json();
    expect(first).toMatchObject({
      state: 'incomplete',
      requiredAttachments: ['risk_plan', 'security_protocol', 'site_map', 'venue_contract'],
    });
    const kinds = ['risk_plan', 'security_protocol', 'site_map', 'venue_contract'].map((kind) => ({
      kind,
    }));
    const second = (await upload(values, kinds)).json();
    expect(second).toMatchObject({ state: 'ready', requiredAttachments: [] });
    expect(second.attachments.map((a: { kind: string }) => a.kind)).toEqual([
      'risk_plan',
      'security_protocol',
      'site_map',
      'venue_contract',
    ]);
    expect(second.quoteId).toMatch(/^qte_/);
  });

  it('leaves the kind of event to a person when the description matches nothing', async () => {
    t.llm.handler = () => ({
      activities: ['underwater basket negotiation'],
      participants: 100,
      hours: 8,
      alcohol: 'none',
      flags: [],
    });
    try {
      const view = (
        await upload(
          sampleValues({ description: 'A gathering of underwater basket negotiators by the lake' }),
        )
      ).json();
      expect(view.state).toBe('needs_review');
      expect(view.quoteId).toBeNull();
      expect(view.missing.map((m: { field: string }) => m.field)).toContain('activity');
    } finally {
      t.llm.handler = () => ({
        activities: ['music festival vendors'],
        participants: 2500,
        hours: 22,
        alcohol: 'sold',
        flags: [],
      });
    }
  });

  it('adds the hazards the form admits to as flags', async () => {
    const view = (
      await upload(
        sampleValues({
          pyrotechnics: 'yes',
          overnight: 'yes',
          vendor_animal: '2',
          vendor_inflatable: '1',
          shareUnder18: '60',
        }),
      )
    ).json();
    const referral = await t.db
      .selectFrom('referral')
      .select('id')
      .where('quote_id', '=', view.quoteId)
      .executeTakeFirstOrThrow();
    const ids = (
      await t.app.inject({
        method: 'GET',
        url: `/v1/referrals/${referral.id}/worksheet`,
        headers: { authorization: `Bearer ${uw}` },
      })
    )
      .json()
      .lines.map((l: { id: string }) => l.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'flag:fireworks',
        'flag:overnight',
        'flag:animals',
        'flag:inflatables',
        'flag:minors',
        'vendor:animal',
        'vendor:inflatable',
      ]),
    );
  });

  it('refuses a form without fields, a file that is not a PDF and an unknown attachment', async () => {
    const flat = await upload(sampleValues(), [], { form: await flatPdf() });
    expect(flat.statusCode).toBe(422);
    expect(flat.json().error.code).toBe('no_form_fields');
    const notPdf = await upload(sampleValues(), [], { form: new TextEncoder().encode('hello') });
    expect(notPdf.statusCode).toBe(400);
    const odd = await upload(sampleValues(), [{ kind: 'selfie' }]);
    expect(odd.statusCode).toBe(400);
    expect(odd.json().error.code).toBe('unexpected_part');
  });

  it('replays the same answer for the same Idempotency-Key and needs the header', async () => {
    const first = await upload(sampleValues(), [], { idem: 'same-upload' });
    const second = await upload(sampleValues(), [], { idem: 'same-upload' });
    expect(second.json()).toEqual(first.json());
    const body = multipart([
      {
        name: 'form',
        filename: 'a.pdf',
        contentType: 'application/pdf',
        data: await filledForm(sampleValues()),
      },
    ]);
    const bare = await t.app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${key}`, ...body.headers },
      payload: body.payload,
    });
    expect(bare.statusCode).toBe(400);
  });

  it('shows a submission to its own program only, and needs a program key', async () => {
    const id = (await upload()).json().id;
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/v1/submissions/${id}`,
          headers: { authorization: `Bearer ${key}` },
        })
      ).statusCode,
    ).toBe(200);
    const other = await t.keyFor('prg_2', ['quotes:read']);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/v1/submissions/${id}`,
          headers: { authorization: `Bearer ${other}` },
        })
      ).statusCode,
    ).toBe(404);
    const global = await t.keyFor(null, ['quotes:write']);
    expect((await upload(sampleValues(), [], { key: global })).statusCode).toBe(403);
  });
});

describe('the generated application form', () => {
  // The same upload is recognised by the hash of its bytes, so a form built twice must not differ by the clock.
  it('is the same bytes whenever it is built', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // pdf-lib waits on timers while saving, so only the clock is faked
    try {
      vi.setSystemTime(new Date('2026-11-13T12:00:00.000Z'));
      const first = await filledForm(sampleValues());
      vi.setSystemTime(new Date('2026-11-13T12:00:07.000Z'));
      const second = await filledForm(sampleValues());
      expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
