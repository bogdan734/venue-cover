import { apiResponse } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { createSlots } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// The API polls its database for every open stream, so a visitor may hold a few and the demo only so many.
const slots = createSlots({ perKey: 3, total: 40 });

// The platform's live event feed, passed on to the browser as it is. The operator key sees every program's events.
export async function GET(request: Request) {
  if (!(await isAdmin())) return new Response('Sign in first.', { status: 401 });
  const visitor =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local';
  const release = slots.acquire(visitor);
  if (!release)
    return new Response('Too many open streams.', {
      status: 429,
      headers: { 'retry-after': '30' },
    });
  request.signal.addEventListener('abort', release, { once: true });

  const lastEventId = request.headers.get('last-event-id');
  let upstream: Response;
  try {
    upstream = await apiResponse('operator', '/v1/events/stream', {
      signal: request.signal,
      ...(lastEventId ? { headers: { 'last-event-id': lastEventId } } : {}),
    });
  } catch (error) {
    release();
    throw error;
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform' },
  });
}
