import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let phone;
let outputDirectory;

before(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), 'splitmate-country-phone-'));
  const outputFile = join(outputDirectory, 'country-phone.mjs');
  await build({
    entryPoints: ['src/lib/countryPhone.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: outputFile,
  });
  phone = await import(`${pathToFileURL(outputFile).href}?test=${Date.now()}`);
});

after(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

test('defaults to India and adds +91 to valid Indian mobile numbers', () => {
  assert.equal(phone.getCountryDialCode('IN').dialCode, '91');
  assert.equal(phone.buildInternationalWhatsAppNumber('IN', '90654 40786'), '919065440786');
});

test('loads legacy Indian numbers and international numbers into editable parts', () => {
  assert.deepEqual(phone.splitInternationalWhatsAppNumber('9065440786'), { countryIso: 'IN', localNumber: '9065440786' });
  assert.deepEqual(phone.splitInternationalWhatsAppNumber('919065440786'), { countryIso: 'IN', localNumber: '9065440786' });
  assert.deepEqual(phone.splitInternationalWhatsAppNumber('447911123456'), { countryIso: 'GB', localNumber: '7911123456' });
});

test('rejects invalid local numbers before they can be saved', () => {
  assert.equal(phone.buildInternationalWhatsAppNumber('IN', '1234567890'), null);
  assert.equal(phone.buildInternationalWhatsAppNumber('IN', '09876543210'), null);
  assert.equal(phone.buildInternationalWhatsAppNumber('GB', '123'), null);
});
