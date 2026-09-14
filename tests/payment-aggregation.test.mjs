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

test('adds merged-group allocations in integer paise', () => {
  const result = aggregation.aggregateUserPayments([
    { groupId: 'g1', groupName: 'Kitchen', settlements: [{ from: 'yaz', to: 'me', amount: 828.15 }] },
    { groupId: 'g2', groupName: 'Flat', settlements: [{ from: 'yaz', to: 'me', amount: 39.99 }] },
  ], 'me');
  assert.equal(result[0].total, 868.14);
  assert.equal(result[0].allocations.reduce((sum, item) => sum + Math.round(item.amount * 100), 0), 86814);
});

test('keeps different people in the same group as separate balances', () => {
  const result = aggregation.aggregateUserPayments([
    {
      groupId: 'flat-204',
      groupName: 'FLAT-204',
      settlements: [
        { from: 'yaz', to: 'me', amount: 39.99 },
        { from: 'iqtihar', to: 'me', amount: 79.99 },
      ],
    },
  ], 'me');
  assert.deepEqual(result.map((payment) => [payment.counterpartyId, payment.total]), [
    ['iqtihar', 79.99],
    ['yaz', 39.99],
  ]);
});

test('keeps different counterparties separate across multiple groups', () => {
  const result = aggregation.aggregateUserPayments([
    { groupId: 'g1', groupName: 'One', settlements: [{ from: 'a', to: 'me', amount: 20 }] },
    { groupId: 'g2', groupName: 'Two', settlements: [{ from: 'b', to: 'me', amount: 20 }] },
  ], 'me');
  assert.equal(result.length, 2);
  assert.deepEqual(new Set(result.map((payment) => payment.counterpartyId)), new Set(['a', 'b']));
});

test('sums hundreds of one-paise group allocations exactly', () => {
  const sources = Array.from({ length: 500 }, (_, index) => ({
    groupId: `g${index}`,
    groupName: `Group ${index}`,
    settlements: [{ from: 'yaz', to: 'me', amount: 0.01 }],
  }));
  const result = aggregation.aggregateUserPayments(sources, 'me');
  assert.equal(result[0].total, 5);
  assert.equal(result[0].allocations.length, 500);
});

test('ignores zero, negative, non-numeric and self-payments', () => {
  const result = aggregation.aggregateUserPayments([
    {
      groupId: 'g1',
      groupName: 'Invalid',
      settlements: [
        { from: 'yaz', to: 'me', amount: 0 },
        { from: 'yaz', to: 'me', amount: -1 },
        { from: 'yaz', to: 'me', amount: Number.NaN },
        { from: 'me', to: 'me', amount: 10 },
      ],
    },
  ], 'me');
  assert.deepEqual(result, []);
});

test('does not mutate source settlements while sorting allocations', () => {
  const sources = [
    { groupId: 'g1', groupName: 'One', settlements: [{ from: 'yaz', to: 'me', amount: 10 }] },
    { groupId: 'g2', groupName: 'Two', settlements: [{ from: 'yaz', to: 'me', amount: 20 }] },
  ];
  const snapshot = structuredClone(sources);
  aggregation.aggregateUserPayments(sources, 'me');
  assert.deepEqual(sources, snapshot);
});

test('production all-group fixture gives Danish the exact direct merged totals', () => {
  const result = aggregation.aggregateUserPayments([
    {
      groupId: 'flat-204',
      groupName: 'FLAT-204',
      settlements: [
        { from: 'adnan', to: 'danish', amount: 13.33 },
        { from: 'alfaiz', to: 'danish', amount: 46.66 },
        { from: 'ibtehaj', to: 'danish', amount: 46.66 },
        { from: 'ashad', to: 'danish', amount: 46.66 },
        { from: 'yazz', to: 'danish', amount: 46.66 },
      ],
    },
    {
      groupId: 'kitchen',
      groupName: 'Kitchen_expense',
      settlements: [
        { from: 'adnan', to: 'danish', amount: 828.15 },
        { from: 'alfaiz', to: 'danish', amount: 329.40 },
        { from: 'ibtehaj', to: 'danish', amount: 828.15 },
        { from: 'yazz', to: 'danish', amount: 828.15 },
      ],
    },
    { groupId: 'new-flat', groupName: 'new_flat', settlements: [] },
  ], 'danish');

  assert.deepEqual(result.map((payment) => [payment.counterpartyId, payment.total]), [
    ['ibtehaj', 874.81],
    ['yazz', 874.81],
    ['adnan', 841.48],
    ['alfaiz', 376.06],
    ['ashad', 46.66],
  ]);
});
