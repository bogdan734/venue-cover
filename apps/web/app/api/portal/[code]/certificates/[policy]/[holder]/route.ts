import { apiResponse } from '@/lib/api';
import { portalOf } from '@/lib/portal';

// Passes a certificate PDF from the API to the browser. The portal's key stays on the server; the API still decides
// whether this program may read this policy and whether this party has a certificate.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ code: string; policy: string; holder: string }> },
) {
  const { code, policy, holder } = await params;
  const { as } = await portalOf(code);
  const upstream = await apiResponse(
    as,
    `/v1/policies/${encodeURIComponent(policy)}/certificates/${encodeURIComponent(holder)}`,
  );
  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
