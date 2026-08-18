const FORWARDED_COOKIE_PREFIX = 'insforge_';

function getBackendOrigin() {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const configured = runtime.process?.env?.INSFORGE_URL || runtime.process?.env?.VITE_INSFORGE_URL;
  if (!configured) throw new Error('INSFORGE_URL or VITE_INSFORGE_URL is required');

  const url = new URL(configured);
  if (url.protocol !== 'https:') throw new Error('The production InsForge URL must use HTTPS');
  return url.origin;
}

function getAuthCookies(cookieHeader: string | null) {
  if (!cookieHeader) return '';
  return cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(FORWARDED_COOKIE_PREFIX))
    .join('; ');
}

function makeFirstPartyCookie(cookie: string) {
  return cookie
    .replace(/;\s*Domain=[^;]+/gi, '')
    .replace(/;\s*Partitioned/gi, '');
}

/**
 * Same-origin auth bridge for the Vite frontend.
 *
 * Safari blocks the InsForge refresh cookie when the backend is cross-site.
 * Routing only /api/auth through the app origin makes that cookie first-party,
 * while Secure/httpOnly/SameSite and backend CSRF validation remain intact.
 */
export default {
  async fetch(request: Request) {
    try {
      const requestUrl = new URL(request.url);
      const backendOrigin = getBackendOrigin();
      const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, backendOrigin);

      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('content-length');
      headers.delete('connection');
      headers.delete('accept-encoding');
      headers.set('origin', backendOrigin);
      headers.set('referer', `${backendOrigin}/`);

      const authCookies = getAuthCookies(request.headers.get('cookie'));
      if (authCookies) headers.set('cookie', authCookies);
      else headers.delete('cookie');

      const body = request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer();
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body,
        redirect: 'manual',
      });

      const responseHeaders = new Headers(upstreamResponse.headers);
      responseHeaders.delete('content-length');
      responseHeaders.delete('content-encoding');
      responseHeaders.delete('transfer-encoding');
      responseHeaders.delete('access-control-allow-origin');
      responseHeaders.delete('access-control-allow-credentials');
      responseHeaders.set('cache-control', 'no-store, max-age=0');

      const upstreamHeaders = upstreamResponse.headers as Headers & { getSetCookie?: () => string[] };
      const setCookies = upstreamHeaders.getSetCookie?.()
        || (upstreamResponse.headers.get('set-cookie') ? [upstreamResponse.headers.get('set-cookie') as string] : []);
      responseHeaders.delete('set-cookie');
      setCookies.forEach((cookie) => responseHeaders.append('set-cookie', makeFirstPartyCookie(cookie)));

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error('Auth proxy failed', error);
      return Response.json(
        { error: 'AUTH_PROXY_UNAVAILABLE', message: 'Authentication service is temporarily unavailable' },
        { status: 502, headers: { 'cache-control': 'no-store' } },
      );
    }
  },
};
