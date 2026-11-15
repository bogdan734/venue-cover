import { apiResponse } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

// The API's own description, for anyone who wants to feed it to a generator or a client.
export async function GET() {
  if (!(await isAdmin())) return new Response('Sign in first.', { status: 401 });
  const upstream = await apiResponse('operator', '/v1/openapi.json');
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
}
