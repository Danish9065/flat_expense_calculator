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

test('former member pair debts stay frozen while future active expenses change the active plan',()=>{
  const expense=[{id:'old',added_by:'a',amount:100}];
  const split=[{expense_id:'old',user_id:'a',amount_owed:50},{expense_id:'old',user_id:'former',amount_owed:50}];
  const payments=[{paid_by:'former',paid_to:'a',amount:20}];
  const before=ledger.calculateSettlementLedger(expense,split,payments,['a','b']);
  const after=ledger.calculateSettlementLedger([...expense,{id:'new',added_by:'b',amount:200}],
    [...split,{expense_id:'new',user_id:'a',amount_owed:100},{expense_id:'new',user_id:'b',amount_owed:100}],payments,['a','b']);
  assert.deepEqual(before.historicalSettlements,[{from:'former',to:'a',amount:30}]);
  assert.deepEqual(after.historicalSettlements,before.historicalSettlements);
  assert.deepEqual(before.settlements,[]);
  assert.deepEqual(after.settlements,[{from:'a',to:'b',amount:100}]);
  assert.equal(after.members.find(row=>row.userId==='former').netBalance,-30);
  assert.equal(after.totals.balanceChecksum,0);
});

test('removed payer, multiple former members and fully paid history retain exact obligations',()=>{
  const result=ledger.calculateSettlementLedger([{id:'e',added_by:'former',amount:100}],
    [{expense_id:'e',user_id:'a',amount_owed:30},{expense_id:'e',user_id:'b',amount_owed:40},{expense_id:'e',user_id:'former',amount_owed:30}],
    [{paid_by:'a',paid_to:'former',amount:30}],['a']);
  assert.deepEqual(result.historicalSettlements,[{from:'b',to:'former',amount:40}]);
  assert.deepEqual(result.settlements,[]);
  assert.equal(result.members.find(row=>row.userId==='a').netBalance,0);
});

test('combining active payments and frozen pairs reproduces every original net balance',()=>{
  // Deterministic generated cases cover rounding, changing payers, archived
  // creditors and debtors, overpaid historical pairs, and all members removed.
  let seed=47;
  const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
  const ids=['a','b','c','d','e'];
  for(let trial=0;trial<500;trial++){
    const expenses=[],splits=[],payments=[];
    for(let i=0;i<12;i++){
      const payer=ids[rand(ids.length)],amount=(1+rand(50000))/100,id=`e${i}`;
      expenses.push({id,added_by:payer,amount});
      for(const row of ledger.distributeExpenseAmount(amount,ids,payer)) splits.push({expense_id:id,user_id:row.userId,amount_owed:row.amount_owed});
    }
    for(let i=0;i<5;i++){
      const paid_by=ids[rand(ids.length)],paid_to=ids[rand(ids.length)];
      if(paid_by!==paid_to)payments.push({paid_by,paid_to,amount:rand(10000)/100});
    }
    const active=ids.filter(()=>rand(2)===0);
    const result=ledger.calculateSettlementLedger(expenses,splits,payments,active);
    assert.deepEqual(result.issues,[]);
    const remaining=Object.fromEntries(result.members.map(row=>[row.userId,Math.round(row.netBalance*100)]));
    for(const row of [...result.settlements,...result.historicalSettlements]){
      remaining[row.from]+=Math.round(row.amount*100);remaining[row.to]-=Math.round(row.amount*100);
    }
    assert.ok(Object.values(remaining).every(n=>n===0));
    assert.ok(result.settlements.every(row=>active.includes(row.from)&&active.includes(row.to)));
  }
});

test('a former member who paid a simplified balance remains fully settled after removal',()=>{
  const expenses=[{id:'a',added_by:'a',amount:100},{id:'b',added_by:'b',amount:100}];
  const splits=[{expense_id:'a',user_id:'former',amount_owed:50},{expense_id:'a',user_id:'a',amount_owed:50},
    {expense_id:'b',user_id:'former',amount_owed:50},{expense_id:'b',user_id:'b',amount_owed:50}];
  const payments=[{paid_by:'former',paid_to:'a',amount:100}];
  const result=ledger.calculateSettlementLedger(expenses,splits,payments,['a','b']);
  assert.equal(result.members.find(row=>row.userId==='former').netBalance,0);
  assert.deepEqual(result.historicalSettlements,[]);
  assert.deepEqual(result.settlements,[{from:'a',to:'b',amount:50}]);
});
