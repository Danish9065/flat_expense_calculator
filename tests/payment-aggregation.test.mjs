import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let aggregation;
let outputDirectory;

before(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), 'splitmate-payment-aggregation-'));
  const outputFile = join(outputDirectory, 'payment-aggregation.mjs');
  await build({ entryPoints: ['src/lib/paymentAggregation.ts'], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: outputFile });
  aggregation = await import(`${pathToFileURL(outputFile).href}?test=${Date.now()}`);
});

after(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

test('combines payments to the same person while preserving group allocations', () => {
  const result = aggregation.aggregateUserPayments([
    { groupId: 'g1', groupName: 'Flat', settlements: [{ from: 'me', to: 'asha', amount: 200 }] },
    { groupId: 'g2', groupName: 'Trip', settlements: [{ from: 'me', to: 'asha', amount: 350.5 }] },
  ], 'me');
  assert.equal(result.length, 1);
  assert.equal(result[0].direction, 'pay');
  assert.equal(result[0].total, 550.5);
  assert.deepEqual(result[0].allocations.map((item) => item.groupName), ['Trip', 'Flat']);
});

test('does not incorrectly net opposite directions across groups', () => {
  const result = aggregation.aggregateUserPayments([
    { groupId: 'g1', groupName: 'Flat', settlements: [{ from: 'me', to: 'asha', amount: 200 }] },
    { groupId: 'g2', groupName: 'Trip', settlements: [{ from: 'asha', to: 'me', amount: 80 }] },
  ], 'me');
  assert.equal(result.length, 2);
  assert.equal(result.find((item) => item.direction === 'pay').total, 200);
  assert.equal(result.find((item) => item.direction === 'receive').total, 80);
});

test('excludes payments that do not involve the current user', () => {
  const result = aggregation.aggregateUserPayments([
    { groupId: 'g1', groupName: 'Flat', settlements: [{ from: 'ravi', to: 'asha', amount: 200 }] },
  ], 'me');
  assert.deepEqual(result, []);
});
