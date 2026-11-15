import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { HttpError } from '../../http/errors.js';
import type { Shield } from './shield.js';
import { tagOf } from './tags.js';
import { open, seal } from './vault.js';

// A whole value that is one tag: what an agent hands back for a person it only knows by tag.
const WHOLE_TAG = /^\[[A-Z]+#[A-Z2-7]{6}\]$/;

interface Issued {
  scope: string;
  tag: string;
  value: string;
}

const scopeOf = (programId: string | null) => programId ?? 'platform';

// Every contact in an answer becomes tags: an object with an e-mail, or the holder of a quote, loses its name and e-mail
// to `[NAME#…]` and `[EMAIL#…]`. A tag is keyed by the program its record belongs to (the nearest programId above it),
// else by the caller's.
function tagContacts(
  value: unknown,
  shield: Shield,
  programId: string | null,
  issued: Issued[],
  key?: string,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => tagContacts(item, shield, programId, issued));
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  const object = value as Record<string, unknown>;
  const scope = typeof object.programId === 'string' ? object.programId : programId;
  const contact = typeof object.email === 'string' || key === 'holder';
  const out: Record<string, unknown> = {};
  for (const [field, inner] of Object.entries(object)) {
    if (contact && (field === 'name' || field === 'email') && typeof inner === 'string') {
      const tag = tagOf(field === 'name' ? 'NAME' : 'EMAIL', inner, shield.keys(scope).tag);
      issued.push({ scope: scopeOf(scope), tag, value: inner });
      out[field] = tag;
    } else {
      out[field] = tagContacts(inner, shield, scope, issued, field);
    }
  }
  return out;
}

// One hook in front of every answer: a key without personal:read (the key an AI agent is given) reads people as tags,
// so a route cannot forget to. Each tag given out is remembered, sealed, so that it can be handed back.
export function registerPersonalGate(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; shield: Shield },
): void {
  app.addHook('preSerialization', async (request, _reply, payload) => {
    const principal = request.principal;
    if (!principal || principal.scopes.includes('personal:read')) return payload;
    const issued: Issued[] = [];
    const tagged = tagContacts(payload, deps.shield, principal.programId, issued);
    const unique = [...new Map(issued.map((i) => [`${i.scope}|${i.tag}`, i])).values()];
    if (unique.length > 0) {
      await deps.db
        .insertInto('pseudonym')
        .values(
          unique.map((i) => ({
            scope: i.scope,
            tag: i.tag,
            sealed: seal(
              { [i.tag]: i.value },
              deps.shield.keys(i.scope === 'platform' ? null : i.scope).seal,
              `${i.scope}:${i.tag}`,
            ),
          })),
        )
        .onConflict((oc) => oc.columns(['scope', 'tag']).doNothing())
        .execute();
    }
    return tagged;
  });
}

// Turns every tag in a request back into the value it stands for, in the caller's program: an agent can quote for a
// person it knows only by tag. A tag this program never gave out is refused.
export async function resolveTags(
  db: Kysely<Database>,
  shield: Shield,
  programId: string | null,
  value: unknown,
): Promise<unknown> {
  if (typeof value === 'string') {
    if (!WHOLE_TAG.test(value)) return value;
    const scope = scopeOf(programId);
    const row = await db
      .selectFrom('pseudonym')
      .select('sealed')
      .where('scope', '=', scope)
      .where('tag', '=', value)
      .executeTakeFirst();
    if (!row) {
      throw new HttpError(400, 'unknown_tag', `${value} stands for nothing this program gave out`);
    }
    return open(row.sealed, shield.keys(programId).seal, `${scope}:${value}`)[value];
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveTags(db, shield, programId, item)));
  }
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [field, inner] of Object.entries(value)) {
    out[field] = await resolveTags(db, shield, programId, inner);
  }
  return out;
}
