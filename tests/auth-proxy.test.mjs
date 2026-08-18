import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let handler;
let outputDirectory;
let originalFetch;

before(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), 'splitmate-auth-proxy-'));
  const outputFile = join(outputDirectory, 'auth-proxy.mjs');
  await build({
    entryPoints: ['api/auth/[...path].ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: outputFile,
  });
  ({ default: handler } = await import(`${pathToFileURL(outputFile).href}?test=${Date.now()}`));
  originalFetch = globalThis.fetch;
  globalThis.process.env.INSFORGE_URL = 'https://backend.insforge.test';
});

after(async () => {
  globalThis.fetch = originalFetch;
  delete globalThis.process.env.INSFORGE_URL;
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

test('auth proxy forwards only InsForge cookies and makes response cookies first-party', async () => {
  let forwardedRequest;
  globalThis.fetch = async (input, init) => {
    forwardedRequest = { input: String(input), init };
    const headers = new globalThis.Headers({ 'content-type': 'application/json' });
    headers.append(
      'set-cookie',
      'insforge_refresh_token=rotated; Domain=backend.insforge.test; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
    return new globalThis.Response(JSON.stringify({ accessToken: 'new-token', user: { id: 'user-1' } }), {
      status: 200,
      headers,
    });
  };

  const response = await handler.fetch(new globalThis.Request('https://splitmate.example/api/auth/refresh', {
    method: 'POST',
    headers: {
      cookie: 'theme=dark; insforge_refresh_token=old; insforge_csrf_token=csrf',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf',
    },
    body: '{}',
  }));

  assert.equal(forwardedRequest.input, 'https://backend.insforge.test/api/auth/refresh');
  assert.equal(forwardedRequest.init.headers.get('cookie'), 'insforge_refresh_token=old; insforge_csrf_token=csrf');
  assert.equal(forwardedRequest.init.headers.get('origin'), 'https://backend.insforge.test');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.doesNotMatch(response.headers.get('set-cookie') || '', /Domain=/i);
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/i);
});

test('auth proxy never forwards unrelated application cookies', async () => {
  globalThis.fetch = async (_input, init) => {
    assert.equal(init.headers.get('cookie'), null);
    return globalThis.Response.json({ ok: true });
  };

  const response = await handler.fetch(new globalThis.Request('https://splitmate.example/api/auth/logout', {
    method: 'POST',
    headers: { cookie: 'theme=dark; analytics_id=123' },
  }));
  assert.equal(response.status, 200);
});
