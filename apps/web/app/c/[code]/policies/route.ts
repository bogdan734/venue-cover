import { apiResponse } from '@/lib/api';
import { clientOf } from '@/lib/client';

// The program's policies for a month, as CSV, for the holder of its console link only.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const access = await clientOf((await params).code);
  if (!access) return new Response('This link does not open a console.', { status: 404 });
  const month = new URL(request.url).searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month))
    return new Response('Name a month as YYYY-MM.', { status: 400 });
  const upstream = await apiResponse(
    { client: access.programId },
    `/v1/reports/policies?month=${month}&format=csv`,
  );
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/csv',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment',
    },
  });
}
