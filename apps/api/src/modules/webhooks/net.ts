import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function privateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

// True for addresses a webhook must never be sent to: loopback, private, link-local (cloud metadata), reserved.
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(ip) === 4) return privateV4(ip);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return privateV4(mapped[1] as string);
  if (isIP(ip) === 6) {
    return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  }
  return true; // not an address at all: refuse
}

// Cheap check at registration: https only, no credentials, no local names, no private address literals.
// Names are resolved again at delivery time, which is where a hostname that points inside gets caught.
export function assertAllowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('the URL must use https');
  if (url.username || url.password) throw new Error('the URL must not contain credentials');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host))
    throw new Error('the URL must not point to a local name');
  if (isIP(host) !== 0 && isPrivateAddress(host))
    throw new Error('the URL must not point to a private address');
  return url;
}

export interface HttpClient {
  post(
    url: string,
    init: { headers: Record<string, string>; body: string; timeoutMs: number },
  ): Promise<{ status: number }>;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress))
    throw new Error('the target address is not public');
}

// Posts without following redirects. Unless private targets are allowed (local tests only), the host is resolved and
// refused when any address is private. A DNS answer can still change between this lookup and the connection; an
// egress proxy is the complete fix and belongs to deployment.
export function createFetchClient(options: { allowPrivateTargets?: boolean } = {}): HttpClient {
  return {
    async post(url, init) {
      if (!options.allowPrivateTargets) await assertPublicHost(new URL(url).hostname);
      const response = await fetch(url, {
        method: 'POST',
        headers: init.headers,
        body: init.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(init.timeoutMs),
      });
      await response.body?.cancel();
      return { status: response.status };
    },
  };
}
