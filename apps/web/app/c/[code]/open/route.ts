import { NextResponse } from 'next/server';
import { consoleCookie, resolveLink } from '@/lib/client';

// The link a client is given: `/c/<code>/open?key=…`. The secret moves into a cookie and out of the address bar, so it
// is not kept in the history or sent on as a referrer.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const token = new URL(request.url).searchParams.get('key') ?? '';
  const access = token ? await resolveLink(token) : null;
  const valid = access !== null && access.code === code;
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      location: valid ? `/c/${code}` : `/c/${code}?link=off`,
      'referrer-policy': 'no-referrer',
    },
  });
  if (valid) {
    response.cookies.set(consoleCookie(code), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.headers.get('x-forwarded-proto') === 'https',
      path: `/c/${code}`,
      maxAge: 90 * 24 * 3600,
    });
  }
  return response;
}
