export interface LedgerExpense {
  id: string;
  added_by: string;
  amount: string | number;
}

export interface LedgerSplit {
  expense_id: string;
  user_id: string;
  amount_owed: string | number;
}

export interface LedgerPayment {
  paid_by: string;
  paid_to: string;
  amount: string | number;
}

export interface LedgerMember {
  userId: string;
  paid: number;
  assignedShare: number;
  paymentsMade: number;
  paymentsReceived: number;
  netBalance: number;
}

export interface SettlementCalculation {
  members: LedgerMember[];
  directSettlements: Array<{ from: string; to: string; amount: number }>;
  settlements: Array<{ from: string; to: string; amount: number }>;
  totals: {
    expenses: number;
    assignedShares: number;
    priorPayments: number;
    balanceChecksum: number;
    splitDifference: number;
  };
}

const fromCents = (cents: number) => cents / 100;

function toCents(value: string | number, label: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be a valid non-negative amount`);
  }
  return Math.round((amount + Number.EPSILON) * 100);
}

/** Splits an expense exactly; remainder paise are spread one per member, payer first. */
export function distributeExpenseAmount(totalAmount: number, memberIds: string[], payerUserId: string) {
  if (memberIds.length === 0) throw new Error('No members to split with');
  const uniqueMemberIds = Array.from(new Set(memberIds));
  if (uniqueMemberIds.length !== memberIds.length) throw new Error('A member cannot appear twice in one split');

  const totalCents = toCents(totalAmount, 'Expense');
  const baseCents = Math.floor(totalCents / uniqueMemberIds.length);
  const remainderCents = totalCents - baseCents * uniqueMemberIds.length;
  const payerIndex = uniqueMemberIds.indexOf(payerUserId);
  const remainderOrder = payerIndex >= 0
    ? [payerIndex, ...uniqueMemberIds.map((_, index) => index).filter((index) => index !== payerIndex)]
    : uniqueMemberIds.map((_, index) => index);
  const remainderRecipients = new Set(remainderOrder.slice(0, remainderCents));

  return uniqueMemberIds.map((userId, index) => ({
    userId,
    amount_owed: fromCents(baseCents + (remainderRecipients.has(index) ? 1 : 0)),
  }));
}

/**
 * Produces an exact, deterministic settlement plan from member balances.
 * All arithmetic stays in integer paise, including the matching loop.
 */
export function minimizeNetBalances(netBalances: Record<string, number>) {
  const entries = Object.entries(netBalances).map(([userId, amount]) => ({
    userId,
    cents: toCents(Math.abs(amount), `Balance for ${userId}`) * Math.sign(amount),
  }));
  const checksum = entries.reduce((sum, entry) => sum + entry.cents, 0);
  if (checksum !== 0) {
    throw new Error(`Ledger is out of balance by ${fromCents(checksum).toFixed(2)}`);
  }

  const creditors = entries
    .filter((entry) => entry.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.userId.localeCompare(b.userId));
  const debtors = entries
    .filter((entry) => entry.cents < 0)
    .map((entry) => ({ ...entry, cents: -entry.cents }))
    .sort((a, b) => b.cents - a.cents || a.userId.localeCompare(b.userId));

  const result: Array<{ from: string; to: string; amount: number }> = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const settledCents = Math.min(debtor.cents, creditor.cents);

    if (settledCents > 0) {
      result.push({ from: debtor.userId, to: creditor.userId, amount: fromCents(settledCents) });
    }
    debtor.cents -= settledCents;
    creditor.cents -= settledCents;
    if (debtor.cents === 0) debtorIndex += 1;
    if (creditor.cents === 0) creditorIndex += 1;
  }

  return result.sort((a, b) => b.amount - a.amount || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/**
 * Canonical ledger formula, evaluated in paise:
 * paid - assigned share + payments made - payments received.
 */
export function calculateSettlementLedger(
  expenses: LedgerExpense[],
  splits: LedgerSplit[],
  payments: LedgerPayment[],
): SettlementCalculation {
  const expenseIds = new Set(expenses.map((expense) => expense.id));
  const expensePayers = new Map(expenses.map((expense) => [expense.id, expense.added_by]));
  const ledger = new Map<string, { paid: number; assignedShare: number; paymentsMade: number; paymentsReceived: number }>();
  const pairDebts = new Map<string, { left: string; right: string; leftOwesRight: number }>();
  const ensureMember = (userId: string) => {
    const existing = ledger.get(userId);
    if (existing) return existing;
    const created = { paid: 0, assignedShare: 0, paymentsMade: 0, paymentsReceived: 0 };
    ledger.set(userId, created);
    return created;
  };
  const addPairDebt = (debtorId: string, creditorId: string, cents: number) => {
    if (debtorId === creditorId || cents === 0) return;
    const [left, right] = debtorId.localeCompare(creditorId) < 0
      ? [debtorId, creditorId]
      : [creditorId, debtorId];
    const key = `${left}\u0000${right}`;
    const pair = pairDebts.get(key) ?? { left, right, leftOwesRight: 0 };
    pair.leftOwesRight += debtorId === left ? cents : -cents;
    pairDebts.set(key, pair);
  };

  let expenseTotal = 0;
  for (const expense of expenses) {
    const cents = toCents(expense.amount, `Expense ${expense.id}`);
    expenseTotal += cents;
    ensureMember(expense.added_by).paid += cents;
  }

  let shareTotal = 0;
  for (const split of splits) {
    if (!expenseIds.has(split.expense_id)) continue;
    const cents = toCents(split.amount_owed, `Split for expense ${split.expense_id}`);
    shareTotal += cents;
    ensureMember(split.user_id).assignedShare += cents;
    const payerId = expensePayers.get(split.expense_id);
    if (payerId) addPairDebt(split.user_id, payerId, cents);
  }

  let paymentTotal = 0;
  for (const payment of payments) {
    const cents = toCents(payment.amount, 'Settlement payment');
    paymentTotal += cents;
    ensureMember(payment.paid_by).paymentsMade += cents;
    ensureMember(payment.paid_to).paymentsReceived += cents;
    addPairDebt(payment.paid_by, payment.paid_to, -cents);
  }

  const netCents: Record<string, number> = {};
  const members = Array.from(ledger.entries())
    .map(([userId, row]) => {
      const netBalance = row.paid - row.assignedShare + row.paymentsMade - row.paymentsReceived;
      netCents[userId] = netBalance;
      return {
        userId,
        paid: fromCents(row.paid),
        assignedShare: fromCents(row.assignedShare),
        paymentsMade: fromCents(row.paymentsMade),
        paymentsReceived: fromCents(row.paymentsReceived),
        netBalance: fromCents(netBalance),
      };
    })
    .sort((a, b) => a.userId.localeCompare(b.userId));

  const balanceChecksum = Object.values(netCents).reduce((sum, cents) => sum + cents, 0);
  const directSettlements = Array.from(pairDebts.values())
    .filter((pair) => pair.leftOwesRight !== 0)
    .map((pair) => pair.leftOwesRight > 0
      ? { from: pair.left, to: pair.right, amount: fromCents(pair.leftOwesRight) }
      : { from: pair.right, to: pair.left, amount: fromCents(-pair.leftOwesRight) })
    .sort((a, b) => b.amount - a.amount || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const settlements = balanceChecksum === 0
    ? minimizeNetBalances(Object.fromEntries(Object.entries(netCents).map(([userId, cents]) => [userId, fromCents(cents)])))
    : [];

  return {
    members,
    directSettlements,
    settlements,
    totals: {
      expenses: fromCents(expenseTotal),
      assignedShares: fromCents(shareTotal),
      priorPayments: fromCents(paymentTotal),
      balanceChecksum: fromCents(balanceChecksum),
      splitDifference: fromCents(expenseTotal - shareTotal),
    },
  };
}
