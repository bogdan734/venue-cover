// The stable public address of the demo. The demo itself runs on one machine; every request goes from here through a
// named Cloudflare Tunnel (a Workers VPC service) to the web app on 127.0.0.1:3100. Nothing is stored in this Worker.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    // The web app limits and signs cookies per visitor and builds links from the host the visitor used; the hop through
    // the tunnel would otherwise hide both.
    headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', 'https');
    try {
      return await env.VENUE.fetch(`http://127.0.0.1:3100${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
      });
    } catch {
      return new Response(
        'The demo is offline right now: it runs on one machine, which is switched off. Try again later.',
        {
          status: 503,
          headers: { 'retry-after': '300', 'content-type': 'text/plain; charset=utf-8' },
        },
      );
    }
  },
};
