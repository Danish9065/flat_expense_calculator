import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { build } from 'esbuild';

let ledger, pages, monthly;
async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
before(async () => {
  [ledger, pages, monthly] = await Promise.all([
    load('src/lib/settlementCalculation.ts'), load('src/lib/pagination.ts'), load('src/lib/monthlySummary.ts'),
  ]);
});

test('opposite expense errors cannot cancel out and certify a broken ledger', () => {
  const result = ledger.calculateSettlementLedger([
    { id: 'a', added_by: 'payer', amount: 100 }, { id: 'b', added_by: 'payer', amount: 100 },
  ], [
    { expense_id: 'a', user_id: 'member', amount_owed: 90 },
    { expense_id: 'b', user_id: 'member', amount_owed: 110 },
  ], []);
  assert.equal(result.totals.balanceChecksum, 0);
  assert.equal(result.issues.length, 2);
  assert.deepEqual(result.settlements, []);
});

test('duplicate shares block settlement even when the total matches', () => {
  const result = ledger.calculateSettlementLedger([{ id: 'a', added_by: 'payer', amount: 100 }], [
    { expense_id: 'a', user_id: 'member', amount_owed: 50 },
    { expense_id: 'a', user_id: 'member', amount_owed: 50 },
  ], []);
  assert.match(result.issues[0], /Duplicate/);
  assert.deepEqual(result.settlements, []);
});

test('pagination reads beyond 1000 rows, including servers with a smaller page cap', async () => {
  const source = Array.from({ length: 1207 }, (_, id) => ({ id }));
  const result = await pages.readAllPages(async (from, to) => ({
    data: source.slice(from, Math.min(to + 1, from + 50)), error: null, count: source.length,
  }));
  assert.deepEqual(result, source);
});

test('a failed or incomplete later page never returns a partial balance', async () => {
  await assert.rejects(pages.readAllPages(async (from) => from === 0
    ? { data: [1], count: 2, error: null }
    : { data: null, count: null, error: { message: 'Network failure' } }), /Network failure/);
  await assert.rejects(pages.readAllPages(async () => ({ data: [], count: 1, error: null })), /Incomplete/);
  await assert.rejects(pages.readAllPages(async (from) => ({ data: [1], count: from ? 3 : 2, error: null })), /changed/);
});

test('monthly totals use IST boundaries and preserve paise', () => {
  assert.equal(monthly.expenseMonth('2026-09-30T18:29:59Z'), '2026-09');
  assert.equal(monthly.expenseMonth('2026-09-30T18:30:00Z'), '2026-10');
  const expenses = [
    { created_at: '2026-09-30T18:29:59Z', amount: 100, expense_splits: [{ user_id: 'me', amount_owed: 50 }] },
    { created_at: '2026-09-30T18:30:00Z', amount: 0.1, expense_splits: [{ user_id: 'me', amount_owed: 0.1 }] },
    { created_at: '2026-10-01T12:00:00Z', amount: 0.2, expense_splits: [{ user_id: 'me', amount_owed: 0.2 }] },
  ];
  assert.deepEqual(monthly.monthlySummary(expenses, 'me', '2026-10'), { total: 0.3, share: 0.3 });
  assert.deepEqual(monthly.monthlySummary(expenses, 'me', '2026-09'), { total: 100, share: 50 });
});
