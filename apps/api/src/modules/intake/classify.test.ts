import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TEST_PRIVACY_SECRET, type TestApp } from '../../../test/app.js';
import { keysFor, open } from '../privacy/index.js';

let t: TestApp;
let prg1: string; // Ontario: automatic up to class B, 300 people, alcohol allowed
let prg3: string; // Quebec: automatic up to class C, 500 people
beforeAll(async () => {
  t = await createTestApp();
  prg1 = await t.keyFor('prg_1', ['quotes:read', 'quotes:write']);
  prg3 = await t.keyFor('prg_3', ['quotes:read', 'quotes:write']);
});
afterAll(() => t.close());

const classify = (text: string, key = prg1) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/intake/classify',
    headers: { authorization: `Bearer ${key}` },
    payload: { text },
  });

const yoga = { activities: ['yoga class'], participants: 20, hours: 2, alcohol: 'none', flags: [] };
const birthday = {
  activities: ['birthday party', 'bouncy castle party'],
  participants: 60,
  hours: 4,
  alcohol: 'served',
  flags: ['inflatables', 'minors'],
};

describe('POST /v1/intake/classify', () => {
  it('classifies a simple event and finds it automatic', async () => {
    t.llm.handler = () => yoga;
    const res = await classify('Yoga class for 20 people, 2 hours, no alcohol');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      programId: 'prg_1',
      riskClass: 'A',
      degraded: false,
      primary: { title: 'Yoga class', riskClass: 'A' },
      decision: { outcome: 'auto', reasons: [] },
    });
    expect(body.phrases[0]).toMatchObject({
      phrase: 'yoga class',
      accepted: { title: 'Yoga class' },
    });
    expect(body.phrases[0].candidates).toHaveLength(3);
    expect(body.confidence).toBeGreaterThan(0.8);
  });

  it('prices a mixed event at its highest class and refers it according to the program', async () => {
    t.llm.handler = () => birthday;
    const text =
      'Kids birthday party with a bouncy castle, 60 guests, 4 hours, parents will have some beer';
    const strict = (await classify(text, prg1)).json();
    expect(strict).toMatchObject({ riskClass: 'C', primary: { title: 'Bouncy castle party' } });
    expect(strict.decision).toEqual({
      outcome: 'refer',
      reasons: ['CLASS_CONFLICT', 'PROGRAM_RULE'],
    });

    const wide = (await classify(text, prg3)).json();
    expect(wide.decision).toEqual({ outcome: 'refer', reasons: ['CLASS_CONFLICT'] });
  });

  it('refers an activity that is not in the catalogue', async () => {
    t.llm.handler = () => ({
      activities: ['quarterly tax filing for chickens'],
      participants: 10,
      hours: 2,
      alcohol: 'none',
      flags: [],
    });
    const body = (await classify('A quarterly tax filing for chickens, 10 people, 2 hours')).json();
    expect(body.primary).toBeNull();
    expect(body.riskClass).toBeNull();
    expect(body.phrases[0].accepted).toBeNull();
    expect(body.decision.reasons).toEqual(['UNKNOWN_ACTIVITY']);
  });

  it('marks a failed model call as degraded and refers it', async () => {
    t.llm.handler = () => {
      throw new Error('model down');
    };
    const body = (await classify('Birthday party for 30 guests for 3 hours')).json();
    expect(body.degraded).toBe(true);
    expect(body.decision.outcome).toBe('refer');
    expect(body.decision.reasons).toContain('EXTRACTION_FAILED');
    expect(body.facts).toMatchObject({ participants: 30, hours: 3 });
  });

  it('refers an event with no activity at all', async () => {
    t.llm.handler = () => ({
      activities: [],
      participants: 10,
      hours: 2,
      alcohol: 'none',
      flags: [],
    });
    const body = (
      await classify('Something happening on Saturday for 10 people for 2 hours')
    ).json();
    expect(body.confidence).toBe(0);
    expect(body.decision.reasons).toEqual(['UNKNOWN_ACTIVITY']);
  });

  it('asks for what the description left out', async () => {
    t.llm.handler = () => ({
      activities: ['yoga class'],
      participants: null,
      hours: null,
      alcohol: null,
      flags: [],
    });
    const body = (await classify('A yoga class on Sunday')).json();
    expect(body.decision).toEqual({ outcome: 'refer', reasons: ['MISSING_FACTS'] });
  });

  it('stores the masked text, the facts and the decision inputs', async () => {
    t.llm.handler = () => yoga;
    const body = (
      await classify('Yoga class for 20 people, 2 hours. Call (416) 555-0199 or sam@example.org')
    ).json();
    const row = await t.db
      .selectFrom('classification')
      .selectAll()
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow();
    expect(row.masked_text).toMatch(/\[PHONE#[A-Z2-7]{6}\]/);
    expect(row.masked_text).toMatch(/\[EMAIL#[A-Z2-7]{6}\]/);
    expect(row.masked_text).not.toContain('555');
    expect(row).toMatchObject({ program_id: 'prg_1', risk_class: 'A', degraded: false });
  });

  it('rejects a missing key, a key without a program and a bad body', async () => {
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/v1/intake/classify',
          payload: { text: 'abc def' },
        })
      ).statusCode,
    ).toBe(401);
    const global = await t.keyFor(null, ['quotes:write']);
    expect((await classify('Yoga class for 20 people', global)).statusCode).toBe(403);
    expect((await classify('')).statusCode).toBe(400);
    expect((await classify('x'.repeat(2001))).statusCode).toBe(400);
  });
});

describe('GET /v1/activities', () => {
  it('searches the catalogue', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/activities?q=yoga',
      headers: { authorization: `Bearer ${prg1}` },
    });
    expect(res.statusCode).toBe(200);
    const { activities } = res.json();
    expect(activities).toHaveLength(10);
    expect(activities[0]).toMatchObject({ title: 'Yoga class', riskClass: 'A' });
  });

  it('needs a query', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/activities',
      headers: { authorization: `Bearer ${prg1}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/intake/questions', () => {
  const ask = (classificationId: string, answers: object = {}, key = prg1) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/intake/questions',
      headers: { authorization: `Bearer ${key}` },
      payload: { classificationId, answers },
    });
  const classified = async (facts: object) => {
    t.llm.handler = () => facts;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/intake/classify',
      headers: { authorization: `Bearer ${prg1}` },
      payload: { text: 'A description of the event for the questions test' },
    });
    return res.json().id as string;
  };

  it('asks only the questions that apply, and not again once answered', async () => {
    const id = await classified({
      activities: ['karaoke night'],
      participants: 60,
      hours: 4,
      alcohol: 'sold',
      flags: ['minors'],
    });
    const first = (await ask(id)).json();
    expect(first.open.map((q: { id: string }) => q.id)).toEqual([
      'server_training',
      'waivers_minors',
    ]);
    expect(first.reasons).toEqual([]);
    const second = (await ask(id, { server_training: true })).json();
    expect(second.open.map((q: { id: string }) => q.id)).toEqual(['waivers_minors']);
  });

  it('turns a flagged answer into a reason', async () => {
    const id = await classified({
      activities: ['karaoke night'],
      participants: 60,
      hours: 4,
      alcohol: 'sold',
      flags: [],
    });
    const body = (await ask(id, { server_training: false })).json();
    expect(body.reasons).toEqual(['PROGRAM_RULE']);
    expect(body.open).toEqual([]);
  });

  it('asks nothing for a plain description', async () => {
    const id = await classified({
      activities: ['yoga class'],
      participants: 20,
      hours: 2,
      alcohol: 'none',
      flags: [],
    });
    expect((await ask(id)).json().open).toEqual([]);
  });

  it('rejects answers that do not fit and a classification of another program', async () => {
    const id = await classified({
      activities: ['yoga class'],
      participants: 20,
      hours: 2,
      alcohol: 'none',
      flags: [],
    });
    const bad = await ask(id, { nope: true });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_answers');
    expect((await ask(id, {}, prg3)).statusCode).toBe(404);
  });
});

describe('the confirmed event', () => {
  const post = (url: string, payload: object, key = prg1) =>
    t.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${key}` }, payload });
  const read = (id: string, key = prg1) =>
    t.app.inject({
      method: 'GET',
      url: `/v1/intake/classifications/${id}`,
      headers: { authorization: `Bearer ${key}` },
    });

  it('reads a classification back, with the masked text and the decision under today’s rules', async () => {
    t.llm.handler = () => yoga;
    const made = (await classify('Yoga class for 20 people, 2 hours, call 416-555-0142')).json();
    const res = await read(made.id);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: made.id,
      programId: 'prg_1',
      riskClass: 'A',
      facts: made.facts,
      decision: made.decision,
      primary: { title: 'Yoga class' },
    });
    expect(body.maskedText).toMatch(/\[PHONE#[A-Z2-7]{6}\]/);
    expect(body.maskedText).not.toContain('416-555-0142');
    expect(body.phrases).toEqual(made.phrases);
  });

  it('keeps a classification to its own program', async () => {
    t.llm.handler = () => yoga;
    const made = (await classify('Yoga class for 20 people, 2 hours, no alcohol')).json();
    const other = await read(made.id, prg3);
    expect(other.statusCode).toBe(404);
    expect(other.json().error.code).toBe('classification_not_found');
    expect((await read('cls_nope')).statusCode).toBe(404);
  });

  it('asks the questions that fit what the customer confirmed, not only what the text said', async () => {
    t.llm.handler = () => yoga; // the text says: 20 people, no alcohol
    const made = (await classify('Yoga class for 20 people, 2 hours, no alcohol')).json();
    const ask = async (confirmed: object, answers: object = {}) =>
      (
        await post('/v1/intake/questions', { classificationId: made.id, answers, confirmed })
      ).json();

    expect((await ask({})).open).toEqual([]);
    const withWine = await ask({ alcohol: 'served' });
    expect(withWine.open.map((q: { id: string }) => q.id)).toEqual(['server_training']);
    const crowd = await ask({ alcohol: 'served', participants: 260 });
    expect(crowd.open.map((q: { id: string }) => q.id)).toEqual([
      'server_training',
      'security_plan',
    ]);
    const answered = await ask({ alcohol: 'served' }, { server_training: false });
    expect(answered.open).toEqual([]);
    expect(answered.reasons).toEqual(['PROGRAM_RULE']);
  });

  it('refuses a confirmed activity that does not exist, and facts out of range', async () => {
    t.llm.handler = () => yoga;
    const made = (await classify('Yoga class for 20 people, 2 hours, no alcohol')).json();
    const unknown = await post('/v1/intake/questions', {
      classificationId: made.id,
      confirmed: { activityId: 'act_nope' },
    });
    expect(unknown.statusCode).toBe(404);
    const bad = await post('/v1/intake/questions', {
      classificationId: made.id,
      confirmed: { participants: 0 },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('GET /v1/activity-titles', () => {
  it('names the activities that exist and leaves out the ones that do not', async () => {
    const hockey = await t.activityId('Ice hockey game');
    const yogaId = await t.activityId('Yoga class');
    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/activity-titles?ids=${hockey},${yogaId},act_nope`,
      headers: { authorization: `Bearer ${prg1}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      titles: { [hockey]: 'Ice hockey game', [yogaId]: 'Yoga class' },
    });
    const none = await t.app.inject({
      method: 'GET',
      url: '/v1/activity-titles',
      headers: { authorization: `Bearer ${prg1}` },
    });
    expect(none.json()).toEqual({ titles: {} });
  });
});

describe('personal details in a description', () => {
  const text =
    'Birthday party for my daughter Emma, 25 kids, 3 hours, no alcohol. Call me at 613-555-0182. Thanks, Sarah Thompson';
  const personal = /Emma|Sarah|Thompson|613|555/;

  it('never reach the model; what is stored is tags and a sealed vault', async () => {
    const seen: string[] = [];
    t.llm.handler = (request) => {
      seen.push(request.user);
      return {
        activities: ['birthday party'],
        participants: 25,
        hours: 3,
        alcohol: 'none',
        flags: [],
      };
    };
    const res = await classify(text);
    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toMatch(personal);
    expect(seen[0]).toContain('my daughter [NAME#');

    const row = await t.db
      .selectFrom('classification')
      .selectAll()
      .where('id', '=', res.json().id)
      .executeTakeFirstOrThrow();
    expect(row.masked_text).not.toMatch(personal);
    // The originals are only in the sealed vault, and only the program's key opens it.
    expect(row.vault).toMatch(/^v1\./);
    expect(row.vault).not.toContain('Sarah');
    const vault = open(row.vault as string, keysFor(TEST_PRIVACY_SECRET, 'prg_1').seal, row.id);
    expect(Object.values(vault).sort()).toEqual(['613-555-0182', 'Emma', 'Sarah Thompson']);
  });

  it('come back as written only to a key allowed to see personal details', async () => {
    t.llm.handler = () => ({
      activities: ['birthday party'],
      participants: 25,
      hours: 3,
      alcohol: 'none',
      flags: [],
    });
    const id = (await classify(text)).json().id as string;
    const read = async (scopes: Parameters<TestApp['keyFor']>[1]) =>
      (
        await t.app.inject({
          method: 'GET',
          url: `/v1/intake/classifications/${id}`,
          headers: { authorization: `Bearer ${await t.keyFor('prg_1', scopes)}` },
        })
      ).json();

    const allowed = await read(['quotes:read', 'personal:read']);
    expect(allowed.text).toBe(text);
    expect(allowed.maskedText).not.toMatch(personal);
    expect((await read(['quotes:read'])).text).toBeNull();
  });

  it('a description with nothing personal reads back the same for everyone', async () => {
    t.llm.handler = () => yoga;
    const id = (await classify('Yoga class for 20 people, 2 hours, no alcohol')).json()
      .id as string;
    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/intake/classifications/${id}`,
      headers: { authorization: `Bearer ${prg1}` },
    });
    expect(res.json().text).toBe('Yoga class for 20 people, 2 hours, no alcohol');
  });
});
