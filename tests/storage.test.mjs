import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let storage;
let outputDirectory;

before(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), 'splitmate-storage-'));
  const mockDbFile = join(outputDirectory, 'mock-db.mjs');
  const outputFile = join(outputDirectory, 'storage.mjs');

  await writeFile(mockDbFile, `
    const getState = () => globalThis.__splitmateStorageTestState;
    export const supabaseClient = {
      auth: {
        refreshSession: async () => {
          const state = getState();
          state.refreshes += 1;
          return { data: {}, error: null };
        },
      },
      storage: {
        from: () => ({
          upload: async (path) => {
            const state = getState();
            state.uploads += 1;
            if (state.mode === 'expired' && state.uploads === 1) {
              return { data: null, error: { statusCode: 401, message: 'JWT expired' } };
            }
            if (state.mode === 'denied') {
              return { data: null, error: { statusCode: 403, message: 'row-level security policy denied upload' } };
            }
            return { data: { path }, error: null };
          },
          createSignedUrl: async (path) => ({ data: { signedUrl: 'https://signed.test/' + path }, error: null }),
          remove: async (paths) => ({ data: paths, error: null }),
        }),
      },
    };
  `);

  await build({
    entryPoints: ['src/lib/storage.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: outputFile,
    plugins: [{
      name: 'mock-supabase-client',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^\.\/db$/ }, () => ({ path: mockDbFile }));
      },
    }],
  });

  storage = await import(`${pathToFileURL(outputFile).href}?test=${Date.now()}`);
});

beforeEach(() => {
  globalThis.__splitmateStorageTestState = { mode: 'ok', uploads: 0, refreshes: 0 };
});

after(async () => {
  delete globalThis.__splitmateStorageTestState;
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

test('refreshes an expired session once and retries a private upload', async () => {
  globalThis.__splitmateStorageTestState.mode = 'expired';
  const file = new File(['image'], 'avatar.png', { type: 'image/png' });

  const reference = await storage.uploadPrivateFile('avatars', 'user-id/avatar.png', file);

  assert.equal(reference, 'supabase-storage://avatars/user-id%2Favatar.png');
  assert.equal(globalThis.__splitmateStorageTestState.uploads, 2);
  assert.equal(globalThis.__splitmateStorageTestState.refreshes, 1);
});

test('surfaces an RLS denial without retrying it as an auth expiry', async () => {
  globalThis.__splitmateStorageTestState.mode = 'denied';
  const file = new File(['image'], 'avatar.png', { type: 'image/png' });

  await assert.rejects(
    storage.uploadPrivateFile('avatars', 'user-id/avatar.png', file),
    /row-level security policy denied upload/,
  );
  assert.equal(globalThis.__splitmateStorageTestState.uploads, 1);
  assert.equal(globalThis.__splitmateStorageTestState.refreshes, 0);
});

test('round-trips private references and sanitizes unsafe file names', () => {
  const reference = storage.createStorageReference('receipts', 'group/user/My bill (1).png');
  assert.deepEqual(storage.parseStorageReference(reference), {
    bucket: 'receipts',
    path: 'group/user/My bill (1).png',
  });
  assert.equal(storage.safeStorageFileName('  My bill (1).png  '), 'My-bill-1-.png');
});
