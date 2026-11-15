import type { Kysely, Selectable } from 'kysely';
import type { Database } from '../../db/types.js';
import { appendEvent, getEvent } from '../events/index.js';
import { MAX_DELIVERY_ATTEMPTS, nextAttemptAt } from './backoff.js';
import type { HttpClient } from './net.js';
import { sign } from './sign.js';

type DeliveryRow = Selectable<Database['webhook_delivery']>;

const REQUEST_TIMEOUT_MS = 5000;
// A claimed delivery is hidden for this long. If the worker dies mid-request the delivery simply becomes due again.
const LEASE_MS = 60_000;

type Outcome =
  | { kind: 'delivered'; status: number }
  | { kind: 'retry'; status: number | null; error: string }
  | { kind: 'dead'; status: number | null; error: string };

// 2xx is delivery. Timeouts, network errors, 408, 429 and 5xx are worth another try. Anything else (other 4xx,
// redirects) says the receiver will not accept this request, so retrying would only repeat the refusal.
function classify(status: number | null, error: string | null): Outcome {
  if (status !== null && status >= 200 && status < 300) return { kind: 'delivered', status };
  if (status === null) return { kind: 'retry', status, error: error ?? 'no response' };
  if (status === 408 || status === 429 || status >= 500)
    return { kind: 'retry', status, error: `the endpoint answered ${status}` };
  return { kind: 'dead', status, error: `the endpoint answered ${status}` };
}

async function settle(
  db: Kysely<Database>,
  delivery: DeliveryRow,
  programId: string,
  attempt: number,
  outcome: Outcome | { kind: 'dead'; status: null; error: string },
  now: Date,
  rand: () => number,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const update = (
      values: Partial<
        Pick<DeliveryRow, 'state' | 'next_attempt_at' | 'last_status' | 'last_error'>
      >,
    ) =>
      trx
        .updateTable('webhook_delivery')
        .set({ attempt, ...values })
        .where('id', '=', delivery.id)
        .execute();

    if (outcome.kind === 'delivered') {
      await update({ state: 'delivered', last_status: outcome.status, last_error: null });
      return;
    }
    let { kind, error } = outcome;
    const next = kind === 'retry' ? nextAttemptAt(attempt, now, rand) : null;
    if (kind === 'retry' && next) {
      await update({ next_attempt_at: next, last_status: outcome.status, last_error: error });
      return;
    }
    if (kind === 'retry') error = `gave up after ${MAX_DELIVERY_ATTEMPTS} attempts: ${error}`;
    kind = 'dead';
    await update({ state: 'dead', last_status: outcome.status, last_error: error });
    await appendEvent(trx, {
      type: 'webhook.delivery.failed',
      programId,
      data: {
        deliveryId: delivery.id,
        endpointId: delivery.endpoint_id,
        eventId: delivery.event_id,
        reason: error,
      },
    });
  });
}

async function attemptDelivery(
  db: Kysely<Database>,
  http: HttpClient,
  delivery: DeliveryRow,
  now: Date,
  rand: () => number,
): Promise<void> {
  const endpoint = await db
    .selectFrom('webhook_endpoint')
    .selectAll()
    .where('id', '=', delivery.endpoint_id)
    .executeTakeFirstOrThrow();
  if (!endpoint.active) {
    return settle(
      db,
      delivery,
      endpoint.program_id,
      delivery.attempt,
      { kind: 'dead', status: null, error: 'the endpoint was deactivated' },
      now,
      rand,
    );
  }
  const event = await getEvent(db, delivery.event_id);
  if (!event) {
    return settle(
      db,
      delivery,
      endpoint.program_id,
      delivery.attempt,
      { kind: 'dead', status: null, error: 'the event no longer exists' },
      now,
      rand,
    );
  }

  const attempt = delivery.attempt + 1;
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    programId: event.programId,
    createdAt: event.occurredAt,
    data: event.data,
  });
  let status: number | null = null;
  let error: string | null = null;
  try {
    ({ status } = await http.post(endpoint.url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      body,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'venue-cover-webhooks/1',
        'x-signature': sign(endpoint.secret, Math.floor(now.getTime() / 1000), body),
        'x-event-id': event.id,
        'x-event-type': event.type,
        'x-delivery-attempt': String(attempt),
      },
    }));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  await settle(db, delivery, endpoint.program_id, attempt, classify(status, error), now, rand);
}

// Claims the deliveries that are due (SKIP LOCKED plus a lease, so concurrent workers never send the same one twice),
// sends them, and records what happened. Delivery is at least once: receivers dedupe on x-event-id.
export async function deliverDue(
  db: Kysely<Database>,
  http: HttpClient,
  now: Date,
  options: { rand?: () => number; batch?: number } = {},
): Promise<number> {
  const rand = options.rand ?? Math.random;
  const claimed = await db.transaction().execute(async (trx) => {
    const due = await trx
      .selectFrom('webhook_delivery')
      .select('id')
      .where('state', '=', 'pending')
      .where('next_attempt_at', '<=', now)
      .orderBy('next_attempt_at')
      .limit(options.batch ?? 20)
      .forUpdate()
      .skipLocked()
      .execute();
    if (due.length === 0) return [];
    return trx
      .updateTable('webhook_delivery')
      .set({ next_attempt_at: new Date(now.getTime() + LEASE_MS) })
      .where(
        'id',
        'in',
        due.map((d) => d.id),
      )
      .returningAll()
      .execute();
  });
  await Promise.all(claimed.map((delivery) => attemptDelivery(db, http, delivery, now, rand)));
  return claimed.length;
}

export function startDeliveryWorker(
  db: Kysely<Database>,
  http: HttpClient,
  options: { intervalMs: number; clock: () => Date; onError: (error: unknown) => void },
): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void>;
  const tick = async () => {
    try {
      while (!stopped && (await deliverDue(db, http, options.clock())) > 0);
    } catch (error) {
      options.onError(error);
    }
    if (!stopped) {
      timer = setTimeout(() => {
        running = tick();
      }, options.intervalMs);
    }
  };
  running = tick();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
