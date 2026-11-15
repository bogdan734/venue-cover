import 'server-only';

// The only place that talks to the platform API. It runs on the server: the browser never holds an API key.
//
// A call is made either as the operator (the people who run the business: underwriters, finance, program setup) or as
// one program (its customer portal). Which one is decided by the page that makes the call, never by the visitor. This
// app has no sign-in; a real deployment puts an identity provider in front of the operator pages.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The operator; a program's portal; or a program's client console, which reads reports and conversations but cannot quote.
export type Actor = 'operator' | { program: string } | { client: string };

export interface ApiInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Required by every state-changing POST: the same key gives the same result, however often it is sent. */
  idempotencyKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function env(name: 'VENUE_API_URL' | 'VENUE_OPERATOR_KEY'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set: the web app needs the API address and an operator key`);
  }
  return value;
}

// A portal key is issued by the operator key the first time a program is used, and kept for the life of the process.
// It may read personal details, so the renter sees their description as they wrote it; a model never does. A client
// console key reads the program's reports and conversations instead.
const SCOPES = {
  portal: ['quotes:read', 'quotes:write', 'webhooks:manage', 'personal:read'],
  client: ['quotes:read', 'reports:read', 'conversations:manage', 'personal:read'],
} as const;
const issued = new Map<string, Promise<string>>();

function keyFor(kind: keyof typeof SCOPES, programId: string): Promise<string> {
  const id = `${kind}:${programId}`;
  let key = issued.get(id);
  if (!key) {
    key = send(env('VENUE_OPERATOR_KEY'), '/v1/api-keys', {
      method: 'POST',
      body: {
        programId,
        name: kind === 'portal' ? 'web portal' : 'client console',
        scopes: SCOPES[kind],
      },
    })
      .then((response) => read<{ key: string }>(response))
      .then((made) => made.key);
    issued.set(id, key);
    key.catch(() => issued.delete(id));
  }
  return key;
}

function send(key: string, path: string, init: ApiInit): Promise<Response> {
  return fetch(`${env('VENUE_API_URL')}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${key}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
    signal: init.signal,
  });
}

async function read<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'error',
      body?.error?.message ?? `the API answered ${response.status}`,
    );
  }
  return body as T;
}

// The raw response, for what is not JSON: a certificate, a spreadsheet, the event stream.
export async function apiResponse(
  actor: Actor,
  path: string,
  init: ApiInit = {},
): Promise<Response> {
  if (actor === 'operator') return send(env('VENUE_OPERATOR_KEY'), path, init);
  const [kind, programId] =
    'program' in actor ? (['portal', actor.program] as const) : (['client', actor.client] as const);
  const response = await send(await keyFor(kind, programId), path, init);
  if (response.status !== 401) return response;
  // The key this process holds is no longer known to the API (its database was replaced): issue another, once.
  issued.delete(`${kind}:${programId}`);
  return send(await keyFor(kind, programId), path, init);
}

export async function api<T>(actor: Actor, path: string, init: ApiInit = {}): Promise<T> {
  return read<T>(await apiResponse(actor, path, init));
}

// One GraphQL query or mutation. A failure carries the REST error code in `extensions.reason`.
export async function gql<T>(
  actor: Actor,
  query: string,
  variables: Record<string, unknown> = {},
  idempotencyKey?: string,
): Promise<T> {
  const response = await apiResponse(actor, '/graphql', {
    method: 'POST',
    body: { query, variables },
    idempotencyKey,
  });
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    errors?: { message: string; extensions?: { reason?: string; code?: string } }[];
  } | null;
  const failure = body?.errors?.[0];
  if (failure || !body?.data) {
    throw new ApiError(
      response.ok ? 400 : response.status,
      failure?.extensions?.reason ?? failure?.extensions?.code ?? 'error',
      failure?.message ?? `the API answered ${response.status}`,
    );
  }
  return body.data;
}
