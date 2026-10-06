import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let invite;
let recovery;
let outputDirectory;

before(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), 'splitmate-auth-flows-'));
  await build({
    entryPoints: ['src/utils/invite.ts', 'src/lib/passwordRecovery.ts'],
    outdir: outputDirectory,
    entryNames: '[name]',
    outExtension: { '.js': '.mjs' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  invite = await import(pathToFileURL(join(outputDirectory, 'invite.mjs')).href);
  recovery = await import(pathToFileURL(join(outputDirectory, 'passwordRecovery.mjs')).href);
});

after(async () => {
  delete globalThis.sessionStorage;
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

test('normalizes invite keys copied with spaces and lowercase letters', () => {
  assert.equal(invite.normalizeInviteKey('  split- k7mn2p  '), 'SPLIT-K7MN2P');
});

test('shows a specific invite-key error instead of a misleading generic failure', () => {
  assert.match(invite.getInviteKeyError('used'), /already been used/i);
  assert.match(invite.getInviteKeyError('expired'), /expired/i);
  assert.match(invite.getInviteKeyError('invalid'), /not valid/i);
});

test('recognizes implicit and PKCE password recovery links', () => {
  assert.equal(recovery.hasPasswordRecoveryParams({ search: '?code=abc', hash: '' }), true);
  assert.equal(recovery.hasPasswordRecoveryParams({ search: '', hash: '#type=recovery&access_token=abc' }), true);
  assert.equal(recovery.hasPasswordRecoveryParams({ search: '', hash: '' }), false);
});

test('tracks recovery intent only for the active browser tab', () => {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  recovery.markPasswordRecoverySession();
  assert.equal(recovery.hasActivePasswordRecoverySession(), true);
  recovery.clearPasswordRecoverySession();
  assert.equal(recovery.hasActivePasswordRecoverySession(), false);
});
