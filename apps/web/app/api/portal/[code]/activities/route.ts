import { api } from '@/lib/api';
import { portalOf } from '@/lib/portal';

// The catalogue search behind the portal's "pick another activity" box.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { as } = await portalOf((await params).code);
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length === 0) return Response.json({ activities: [] });
  return Response.json(await api(as, `/v1/activities?q=${encodeURIComponent(q.slice(0, 120))}`));
}
