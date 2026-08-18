import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let paymentLinks;
let outputDirectory;

before(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), 'splitmate-payment-links-'));
  const outputFile = join(outputDirectory, 'payment-links.mjs');
  await build({
    entryPoints: ['src/lib/paymentLinks.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: outputFile,
  });
  paymentLinks = await import(`${pathToFileURL(outputFile).href}?test=${Date.now()}`);
});

after(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

test('normalizes international WhatsApp numbers and rejects unsafe values', () => {
  assert.equal(paymentLinks.normalizeWhatsAppNumber('+91 98765-43210'), '919876543210');
  assert.equal(paymentLinks.normalizeWhatsAppNumber('0091 98765 43210'), '919876543210');
  assert.equal(paymentLinks.normalizeWhatsAppNumber('123'), null);
});

test('builds a targeted encoded WhatsApp reminder', () => {
  const url = new URL(paymentLinks.buildWhatsAppReminderUrl({
    amount: 425.5,
    creditorName: 'Asha',
    debtorName: 'Ravi',
    groupName: 'Flat 12',
    whatsappNumber: '+91 98765 43210',
    upiId: 'asha@okbank',
    appUrl: 'https://splitmate.example/balance',
  }));
  assert.equal(url.hostname, 'wa.me');
  assert.equal(url.pathname, '/919876543210');
  assert.match(url.searchParams.get('text') || '', /₹425\.50/);
  assert.match(url.searchParams.get('text') || '', /asha@okbank/);
});

test('builds an interoperable generic UPI payment intent', () => {
  const url = new URL(paymentLinks.buildUpiPaymentUri({
    amount: 425.5,
    payeeName: 'Asha Sharma',
    upiId: 'ASHA@OKBANK',
    groupName: 'Flat 12',
    reference: 'split-1700000000000',
  }));
  assert.equal(url.protocol, 'upi:');
  assert.equal(url.hostname, 'pay');
  assert.equal(url.searchParams.get('pa'), 'asha@okbank');
  assert.equal(url.searchParams.get('am'), '425.50');
  assert.equal(url.searchParams.get('cu'), 'INR');
  assert.equal(url.searchParams.get('tr'), '1700000000000');
});

test('rejects invalid UPI IDs and non-positive amounts', () => {
  assert.equal(paymentLinks.isValidUpiId('not-a-vpa'), false);
  assert.throws(() => paymentLinks.buildUpiPaymentUri({
    amount: 0,
    payeeName: 'Asha',
    upiId: 'asha@okbank',
    groupName: 'Flat 12',
  }), /greater than zero/);
});
