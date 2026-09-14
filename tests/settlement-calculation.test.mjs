import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let calculation;
let outputDirectory;

before(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), 'splitmate-settlement-calculation-'));
  const outputFile = join(outputDirectory, 'settlement-calculation.mjs');
  await build({ entryPoints: ['src/lib/settlementCalculation.ts'], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: outputFile });
  calculation = await import(`${pathToFileURL(outputFile).href}?test=${Date.now()}`);
});

after(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

test('calculates Alphas, Yaz and Ittihad exactly from paid minus assigned share', () => {
  const result = calculation.calculateSettlementLedger(
    [{ id: 'kitchen', added_by: 'danish', amount: 3312.60 }],
    [
      { expense_id: 'kitchen', user_id: 'danish', amount_owed: 828.15 },
      { expense_id: 'kitchen', user_id: 'alphas', amount_owed: 828.15 },
      { expense_id: 'kitchen', user_id: 'yaz', amount_owed: 828.15 },
      { expense_id: 'kitchen', user_id: 'ittihad', amount_owed: 828.15 },
    ],
    [],
  );

  assert.equal(result.totals.balanceChecksum, 0);
  assert.deepEqual(result.settlements, [
    { from: 'alphas', to: 'danish', amount: 828.15 },
    { from: 'ittihad', to: 'danish', amount: 828.15 },
    { from: 'yaz', to: 'danish', amount: 828.15 },
  ]);
});

test('splits uneven amounts without creating or losing a paise', () => {
  const splits = calculation.distributeExpenseAmount(100, ['alphas', 'yaz', 'ittihad'], 'yaz');
  assert.deepEqual(splits, [
    { userId: 'alphas', amount_owed: 33.33 },
    { userId: 'yaz', amount_owed: 33.34 },
    { userId: 'ittihad', amount_owed: 33.33 },
  ]);
  assert.equal(splits.reduce((sum, split) => sum + Math.round(split.amount_owed * 100), 0), 10000);
});

test('applies a prior payment in the correct direction', () => {
  const result = calculation.calculateSettlementLedger(
    [{ id: 'rent', added_by: 'danish', amount: 100 }],
    [
      { expense_id: 'rent', user_id: 'danish', amount_owed: 50 },
      { expense_id: 'rent', user_id: 'yaz', amount_owed: 50 },
    ],
    [{ paid_by: 'yaz', paid_to: 'danish', amount: 20 }],
  );
  assert.deepEqual(result.settlements, [{ from: 'yaz', to: 'danish', amount: 30 }]);
});

test('keeps the final one-paise balance instead of dropping it', () => {
  assert.deepEqual(
    calculation.minimizeNetBalances({ alphas: -0.01, danish: 0.01 }),
    [{ from: 'alphas', to: 'danish', amount: 0.01 }],
  );
});

test('refuses to invent a settlement when expense shares do not balance', () => {
  const result = calculation.calculateSettlementLedger(
    [{ id: 'food', added_by: 'danish', amount: 100 }],
    [{ expense_id: 'food', user_id: 'yaz', amount_owed: 50 }],
    [],
  );
  assert.equal(result.totals.splitDifference, 50);
  assert.equal(result.totals.balanceChecksum, 50);
  assert.deepEqual(result.settlements, []);
});

test('a 40.00 confirmed payment reduces a 79.99 obligation to 39.99', () => {
  const expenses = [{ id: 'example', added_by: 'danish', amount: 319.96 }];
  const splits = ['danish', 'alphas', 'yaz', 'iqtihar'].map((user_id) => ({
    expense_id: 'example',
    user_id,
    amount_owed: 79.99,
  }));
  const result = calculation.calculateSettlementLedger(
    expenses,
    splits,
    [{ paid_by: 'yaz', paid_to: 'danish', amount: 40 }],
  );

  assert.equal(result.members.find((member) => member.userId === 'yaz').netBalance, -39.99);
  assert.equal(result.members.find((member) => member.userId === 'iqtihar').netBalance, -79.99);
  assert.deepEqual(result.settlements, [
    { from: 'alphas', to: 'danish', amount: 79.99 },
    { from: 'iqtihar', to: 'danish', amount: 79.99 },
    { from: 'yaz', to: 'danish', amount: 39.99 },
  ]);
});

test('members with identical shares and no other activity owe identical amounts', () => {
  const result = calculation.calculateSettlementLedger(
    [{ id: 'flat-204', added_by: 'danish', amount: 319.96 }],
    ['danish', 'alphas', 'yaz', 'iqtihar'].map((user_id) => ({
      expense_id: 'flat-204', user_id, amount_owed: 79.99,
    })),
    [],
  );
  for (const userId of ['alphas', 'yaz', 'iqtihar']) {
    assert.equal(result.members.find((member) => member.userId === userId).netBalance, -79.99);
  }
});

test('Flat-204 direct debts give every equal member the same two creditor amounts', () => {
  const expenses = [
    { id: 'waste', added_by: 'danish', amount: 150 },
    { id: 'harpic', added_by: 'danish', amount: 130 },
    { id: 'spray', added_by: 'adnan', amount: 200 },
  ];
  const ordinaryMembers = ['alfaiz', 'ibtehaj', 'ashad', 'yazz'];
  const splits = [
    ...['adnan', 'alfaiz', 'danish', 'ibtehaj', 'ashad', 'yazz'].map((user_id) => ({ expense_id: 'waste', user_id, amount_owed: 25 })),
    { expense_id: 'harpic', user_id: 'danish', amount_owed: 21.70 },
    ...['adnan', 'alfaiz', 'ibtehaj', 'ashad', 'yazz'].map((user_id) => ({ expense_id: 'harpic', user_id, amount_owed: 21.66 })),
    { expense_id: 'spray', user_id: 'adnan', amount_owed: 33.35 },
    ...['alfaiz', 'danish', 'ibtehaj', 'ashad', 'yazz'].map((user_id) => ({ expense_id: 'spray', user_id, amount_owed: 33.33 })),
  ];
  const result = calculation.calculateSettlementLedger(expenses, splits, []);

  for (const member of ordinaryMembers) {
    assert.deepEqual(
      result.directSettlements.filter((payment) => payment.from === member),
      [
        { from: member, to: 'danish', amount: 46.66 },
        { from: member, to: 'adnan', amount: 33.33 },
      ],
    );
  }
  assert.ok(result.directSettlements.some((payment) =>
    payment.from === 'adnan' && payment.to === 'danish' && payment.amount === 13.33));
});

test('Muhammed Ashad owes 46.66 to Danish plus 33.33 to Adnan, totaling 79.99', () => {
  const result = calculation.calculateSettlementLedger(
    [
      { id: 'waste', added_by: 'danish', amount: 150 },
      { id: 'harpic', added_by: 'danish', amount: 130 },
      { id: 'spray', added_by: 'adnan', amount: 200 },
    ],
    [
      { expense_id: 'waste', user_id: 'ashad', amount_owed: 25 },
      { expense_id: 'waste', user_id: 'danish', amount_owed: 125 },
      { expense_id: 'harpic', user_id: 'ashad', amount_owed: 21.66 },
      { expense_id: 'harpic', user_id: 'danish', amount_owed: 108.34 },
      { expense_id: 'spray', user_id: 'ashad', amount_owed: 33.33 },
      { expense_id: 'spray', user_id: 'adnan', amount_owed: 166.67 },
    ],
    [],
  );
  const ashadPayments = result.directSettlements.filter((payment) => payment.from === 'ashad');
  assert.deepEqual(ashadPayments, [
    { from: 'ashad', to: 'danish', amount: 46.66 },
    { from: 'ashad', to: 'adnan', amount: 33.33 },
  ]);
  assert.equal(ashadPayments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0), 7999);
  assert.equal(result.members.find((member) => member.userId === 'ashad').netBalance, -79.99);
});

test('direct balances net mutual expenses between the same two people', () => {
  const result = calculation.calculateSettlementLedger(
    [
      { id: 'one', added_by: 'danish', amount: 100 },
      { id: 'two', added_by: 'yaz', amount: 40 },
    ],
    [
      { expense_id: 'one', user_id: 'danish', amount_owed: 50 },
      { expense_id: 'one', user_id: 'yaz', amount_owed: 50 },
      { expense_id: 'two', user_id: 'danish', amount_owed: 20 },
      { expense_id: 'two', user_id: 'yaz', amount_owed: 20 },
    ],
    [],
  );
  assert.deepEqual(result.directSettlements, [{ from: 'yaz', to: 'danish', amount: 30 }]);
});

test('confirmed payments reduce the matching direct person-to-person balance', () => {
  const result = calculation.calculateSettlementLedger(
    [{ id: 'one', added_by: 'danish', amount: 100 }],
    [
      { expense_id: 'one', user_id: 'danish', amount_owed: 50 },
      { expense_id: 'one', user_id: 'yaz', amount_owed: 50 },
    ],
    [{ paid_by: 'yaz', paid_to: 'danish', amount: 15 }],
  );
  assert.deepEqual(result.directSettlements, [{ from: 'yaz', to: 'danish', amount: 35 }]);
});

test('a full confirmed payment clears the balance exactly', () => {
  const result = calculation.calculateSettlementLedger(
    [{ id: 'bill', added_by: 'danish', amount: 80 }],
    [
      { expense_id: 'bill', user_id: 'danish', amount_owed: 40 },
      { expense_id: 'bill', user_id: 'yaz', amount_owed: 40 },
    ],
    [{ paid_by: 'yaz', paid_to: 'danish', amount: 40 }],
  );
  assert.deepEqual(result.settlements, []);
  assert.ok(result.members.every((member) => member.netBalance === 0));
});

test('an overpayment reverses the remaining direction', () => {
  const result = calculation.calculateSettlementLedger(
    [{ id: 'bill', added_by: 'danish', amount: 80 }],
    [
      { expense_id: 'bill', user_id: 'danish', amount_owed: 40 },
      { expense_id: 'bill', user_id: 'yaz', amount_owed: 40 },
    ],
    [{ paid_by: 'yaz', paid_to: 'danish', amount: 50 }],
  );
  assert.deepEqual(result.settlements, [{ from: 'danish', to: 'yaz', amount: 10 }]);
});

test('multiple payers are netted once without double counting self shares', () => {
  const result = calculation.calculateSettlementLedger(
    [
      { id: 'rent', added_by: 'danish', amount: 300 },
      { id: 'food', added_by: 'yaz', amount: 120 },
    ],
    [
      { expense_id: 'rent', user_id: 'danish', amount_owed: 100 },
      { expense_id: 'rent', user_id: 'yaz', amount_owed: 100 },
      { expense_id: 'rent', user_id: 'iqtihar', amount_owed: 100 },
      { expense_id: 'food', user_id: 'danish', amount_owed: 40 },
      { expense_id: 'food', user_id: 'yaz', amount_owed: 40 },
      { expense_id: 'food', user_id: 'iqtihar', amount_owed: 40 },
    ],
    [],
  );
  assert.deepEqual(result.settlements, [
    { from: 'iqtihar', to: 'danish', amount: 140 },
    { from: 'yaz', to: 'danish', amount: 20 },
  ]);
});

test('numeric strings from persisted rows calculate identically to numbers', () => {
  const result = calculation.calculateSettlementLedger(
    [{ id: 'bill', added_by: 'danish', amount: '100.00' }],
    [
      { expense_id: 'bill', user_id: 'danish', amount_owed: '50.00' },
      { expense_id: 'bill', user_id: 'yaz', amount_owed: '50.00' },
    ],
    [{ paid_by: 'yaz', paid_to: 'danish', amount: '0.01' }],
  );
  assert.deepEqual(result.settlements, [{ from: 'yaz', to: 'danish', amount: 49.99 }]);
});

test('removed members remain in the ledger when their historical rows exist', () => {
  const result = calculation.calculateSettlementLedger(
    [{ id: 'old', added_by: 'removed-user', amount: 60 }],
    [
      { expense_id: 'old', user_id: 'removed-user', amount_owed: 30 },
      { expense_id: 'old', user_id: 'active-user', amount_owed: 30 },
    ],
    [],
  );
  assert.deepEqual(result.settlements, [{ from: 'active-user', to: 'removed-user', amount: 30 }]);
});

test('settlement ordering is deterministic when amounts tie', () => {
  const balances = { yaz: -10, alphas: -10, danish: 10, iqtihar: 10 };
  assert.deepEqual(calculation.minimizeNetBalances(balances), [
    { from: 'alphas', to: 'danish', amount: 10 },
    { from: 'yaz', to: 'iqtihar', amount: 10 },
  ]);
});

test('rejects empty and duplicate split member lists', () => {
  assert.throws(() => calculation.distributeExpenseAmount(10, [], 'danish'), /No members/);
  assert.throws(() => calculation.distributeExpenseAmount(10, ['yaz', 'yaz'], 'danish'), /cannot appear twice/);
});

test('rejects negative and non-numeric monetary inputs', () => {
  assert.throws(() => calculation.distributeExpenseAmount(-1, ['yaz'], 'yaz'), /non-negative/);
  assert.throws(() => calculation.calculateSettlementLedger(
    [{ id: 'bad', added_by: 'danish', amount: 'not-money' }], [], [],
  ), /valid non-negative/);
});

test('generated splits conserve every paise across many totals and group sizes', () => {
  for (let totalCents = 1; totalCents <= 10000; totalCents += 37) {
    for (let count = 1; count <= 12; count += 1) {
      const ids = Array.from({ length: count }, (_, index) => `member-${index}`);
      const splits = calculation.distributeExpenseAmount(totalCents / 100, ids, ids[count - 1]);
      const splitCents = splits.map((split) => Math.round(split.amount_owed * 100));
      assert.equal(splitCents.reduce((sum, cents) => sum + cents, 0), totalCents);
      assert.ok(Math.max(...splitCents) - Math.min(...splitCents) <= 1);
      assert.equal(splitCents[count - 1], Math.max(...splitCents));
    }
  }
});

test('every generated balanced ledger produces settlements that clear all balances', () => {
  for (let seed = 1; seed <= 250; seed += 1) {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const payer = ids[seed % ids.length];
    const amount = ((seed * 7919) % 50000 + 1) / 100;
    const splits = calculation.distributeExpenseAmount(amount, ids, payer)
      .map((split) => ({ expense_id: `expense-${seed}`, user_id: split.userId, amount_owed: split.amount_owed }));
    const result = calculation.calculateSettlementLedger(
      [{ id: `expense-${seed}`, added_by: payer, amount }], splits, [],
    );
    assert.equal(result.totals.balanceChecksum, 0);
    const net = Object.fromEntries(result.members.map((member) => [member.userId, Math.round(member.netBalance * 100)]));
    for (const payment of result.settlements) {
      const cents = Math.round(payment.amount * 100);
      net[payment.from] += cents;
      net[payment.to] -= cents;
    }
    assert.ok(Object.values(net).every((cents) => cents === 0));
  }
});

test('production Kitchen_expense fixture matches every audited member balance', () => {
  const expenses = [
    { id: 'repair', added_by: 'danish', amount: 130 },
    { id: 'food-1995', added_by: 'danish', amount: 1995 },
    { id: 'food-1517', added_by: 'danish', amount: 1517 },
  ];
  const splits = [
    ...['danish', 'adnan', 'alfaiz', 'ibtehaj', 'yazz'].map((user_id) => ({ expense_id: 'repair', user_id, amount_owed: 26 })),
    ...['danish', 'adnan', 'ibtehaj', 'yazz'].map((user_id) => ({ expense_id: 'food-1995', user_id, amount_owed: 498.75 })),
    ...['danish', 'adnan', 'alfaiz', 'ibtehaj', 'yazz'].map((user_id) => ({ expense_id: 'food-1517', user_id, amount_owed: 303.40 })),
  ];
  const result = calculation.calculateSettlementLedger(expenses, splits, []);
  const balances = Object.fromEntries(result.members.map((member) => [member.userId, member.netBalance]));

  assert.deepEqual(balances, {
    adnan: -828.15,
    alfaiz: -329.40,
    danish: 2813.85,
    ibtehaj: -828.15,
    yazz: -828.15,
  });
  assert.equal(result.totals.expenses, 3642);
  assert.equal(result.totals.assignedShares, 3642);
  assert.equal(result.totals.balanceChecksum, 0);
});

test('production new_flat fixture is self-funded and has no payment due', () => {
  const amounts = [30000, 5000, 200];
  const result = calculation.calculateSettlementLedger(
    amounts.map((amount, index) => ({ id: `self-${index}`, added_by: 'danish', amount })),
    amounts.map((amount, index) => ({ expense_id: `self-${index}`, user_id: 'danish', amount_owed: amount })),
    [],
  );
  assert.deepEqual(result.members, [{
    userId: 'danish',
    paid: 35200,
    assignedShare: 35200,
    paymentsMade: 0,
    paymentsReceived: 0,
    netBalance: 0,
  }]);
  assert.deepEqual(result.directSettlements, []);
  assert.deepEqual(result.settlements, []);
});
