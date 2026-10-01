import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { build } from 'esbuild';

let service;
before(async () => {
  const result = await build({
    entryPoints: ['src/services/settlementService.ts'], bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'database-fixture', setup(api) {
      api.onResolve({ filter: /lib\/db$/ }, () => ({ path: 'db', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const dbInsert = async (table, row) => { globalThis.__ledgerFixture.writes.push(row); return [row]; };
        export const supabaseClient = {
          rpc: async (name, args) => { globalThis.__ledgerFixture.writes.push(args); return { data: [], error: null }; },
          from(table) {
            const filters = [];
            const query = {
              select() { return query; }, eq(key,value) { filters.push([key,value]); return query; },
              order() { return query; },
              async range(from,to) {
                const state = globalThis.__ledgerFixture;
                if (state.fail === table) return { data:null, count:null, error:{message:'Network failed'} };
                const rows = state[table].filter(row => filters.every(([key,value]) => {
                  if (key.startsWith('expenses.')) {
                    const parent = state.expenses.find(e => e.id === row.expense_id);
                    return parent?.[key.split('.')[1]] === value;
                  }
                  return row[key] === value;
                }));
                return {data:rows.slice(from,to+1),count:rows.length,error:null};
              }
            }; return query;
          }
        };
      ` }));
    } }],
  });
  service = (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)).SettlementService;
});
beforeEach(() => {
  globalThis.__ledgerFixture = {
    expenses: [
      { id: 'e1', group_id: 'g', category: 'Food', amount: 40, added_by: 'b' },
      { id: 'e2', group_id: 'g', category: 'Home', amount: 20, added_by: 'me' },
      { id: 'other', group_id: 'other-group', category: 'Food', amount: 999, added_by: 'b' },
    ],
    expense_splits: [
      { expense_id: 'e1', user_id: 'me', amount_owed: 20 },
      { expense_id: 'e1', user_id: 'b', amount_owed: 20 },
      { expense_id: 'e2', user_id: 'me', amount_owed: 10 },
      { expense_id: 'e2', user_id: 'c', amount_owed: 10 },
      { expense_id: 'other', user_id: 'me', amount_owed: 999 },
    ], settlements: [], writes: [],
  };
});

test('dashboard, report and payment service share one group-scoped canonical ledger', async () => {
  const report = await service.getCalculationExplanation('g');
  const payments = await service.calculateGroupSettlements('g');
  assert.deepEqual(payments, report.suggestedPayments);
  assert.deepEqual(payments, [{from:'c',to:'b',amount:10},{from:'me',to:'b',amount:10}]);
  assert.notDeepEqual(payments, report.directPayments);
  assert.deepEqual(await service.calculateBalance('g','me'), { totalPaid:20, totalOwed:30, netBalance:-10 });
});

test('group payments count once, while category views remain pre-payment', async () => {
  globalThis.__ledgerFixture.settlements.push({group_id:'g',paid_by:'me',paid_to:'b',amount:5});
  assert.equal((await service.calculateBalance('g','me')).netBalance,-5);
  const report = await service.getCalculationExplanation('g','Food');
  assert.equal(report.expenses.length,1);
  assert.equal(report.priorPayments.length,0);
  assert.deepEqual(report.suggestedPayments,[{from:'me',to:'b',amount:20}]);
});

test('failed reads and incomplete expense splits block payment plans', async () => {
  globalThis.__ledgerFixture.fail='settlements';
  await assert.rejects(service.calculateGroupSettlements('g'), /Network failed/);
  globalThis.__ledgerFixture.fail=null;
  globalThis.__ledgerFixture.expense_splits.shift();
  await assert.rejects(service.calculateGroupSettlements('g'), /assigned shares/);
  await assert.rejects(service.calculateBalance('g','me'), /assigned shares/);
});

test('stale and invalid confirmations are rejected without writing', async () => {
  await assert.rejects(service.settleUp('g','me','b',20), /changed/);
  await assert.rejects(service.settleUpPartial('g','me','b',1001), /changed/);
  await assert.rejects(service.settleUpPartial('g','me','b',0), /Invalid/);
  assert.equal(globalThis.__ledgerFixture.writes.length,0);
});

test('a valid current receipt writes once and concurrent confirmation is blocked', async () => {
  const first=service.settleUp('g','me','b',10);
  await assert.rejects(service.settleUp('g','me','b',10), /already being recorded/);
  await first;
  assert.equal(globalThis.__ledgerFixture.writes.length,1);
  assert.equal(globalThis.__ledgerFixture.writes[0].amount,10);
});

test('combined receipts reject duplicate allocations without recording them twice', async () => {
  const allocation={groupId:'g',debtorId:'me',creditorId:'b',amount:10};
  await assert.rejects(service.settleMultiple([allocation,allocation]), /unique/);
  assert.equal(globalThis.__ledgerFixture.writes.length,0);
});
