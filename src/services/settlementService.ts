import insforge, { dbInsert } from '../lib/db';

interface ExpenseBalanceRow {
    id: string;
    added_by: string;
    amount: string | number;
}

interface ExpenseSplitBalanceRow {
    user_id: string;
    amount_owed: string | number;
}

interface SettlementBalanceRow {
    paid_by: string;
    paid_to: string;
    amount: string | number;
    settled_at?: string;
    is_partial?: boolean;
}

interface ExplanationExpenseRow extends ExpenseBalanceRow {
    item_name?: string;
    category?: string;
    created_at?: string;
}

interface ExplanationSplitRow extends ExpenseSplitBalanceRow {
    expense_id: string;
}

export interface MemberCalculationRow {
    userId: string;
    paid: number;
    assignedShare: number;
    paymentsMade: number;
    paymentsReceived: number;
    netBalance: number;
}

export interface CalculationExplanation {
    generatedAt: string;
    category: string;
    expenses: ExplanationExpenseRow[];
    splits: ExplanationSplitRow[];
    priorPayments: SettlementBalanceRow[];
    memberRows: MemberCalculationRow[];
    suggestedPayments: { from: string; to: string; amount: number }[];
    totals: {
        expenses: number;
        assignedShares: number;
        priorPayments: number;
        balanceChecksum: number;
        splitDifference: number;
    };
}

interface GroupMemberRow {
    user_id: string;
    users?: {
        full_name?: string;
        avatar_url?: string;
    };
}

export const SettlementService = {
    /**
     * Calculate the net balance for a single user in a group.
     */
    async calculateBalance(groupId: string, userId: string): Promise<{ totalPaid: number; totalOwed: number; netBalance: number }> {
        // Step 1: Get all expenses
        const { data: expenses, error: expensesError } = await insforge.database
            .from('expenses')
            .select('id, added_by, amount')
            .eq('group_id', groupId);

        if (expensesError) throw new Error(expensesError.message);

        const expenseRows = (expenses || []) as ExpenseBalanceRow[];
        const expenseIds = expenseRows.map((e) => e.id);

        // Step 2: Get all expense splits
        let splits: ExpenseSplitBalanceRow[] = [];
        if (expenseIds.length > 0) {
            const { data: splitsData, error: splitsError } = await insforge.database
                .from('expense_splits')
                .select('user_id, amount_owed')
                .in('expense_id', expenseIds);
            
            if (splitsError) throw new Error(splitsError.message);
            splits = (splitsData || []) as ExpenseSplitBalanceRow[];
        }

        // Step 3: Get all settlements
        const { data: settlements, error: settlementsError } = await insforge.database
            .from('settlements')
            .select('paid_by, paid_to, amount')
            .eq('group_id', groupId);
            
        if (settlementsError) throw new Error(settlementsError.message);

        let netBalance = 0;

        for (const exp of expenseRows) {
            if (exp.added_by === userId) {
                netBalance += Number(exp.amount);
            }
        }

        for (const split of splits) {
            if (split.user_id === userId) {
                netBalance -= Number(split.amount_owed);
            }
        }

        for (const s of (settlements || []) as SettlementBalanceRow[]) {
            if (s.paid_by === userId) netBalance += Number(s.amount);
            if (s.paid_to === userId) netBalance -= Number(s.amount);
        }

        return {
            totalPaid: 0,
            totalOwed: 0,
            netBalance: Math.round(netBalance * 100) / 100,
        };
    },

    /**
     * Settle Up: simply records a payment from debtor → creditor.
     * Balance recalculation handles the state.
     */
    async settleUp(groupId: string, debtorId: string, creditorId: string, amount: number) {
        if (debtorId === creditorId) throw new Error('Debtor and creditor cannot be the same person');

        await dbInsert('settlements', {
            group_id: groupId,
            paid_by: debtorId,
            paid_to: creditorId,
            amount: amount,
            settled_at: new Date().toISOString(),
            is_partial: false
        });

        return true;
    },

    /**
     * Settle Up Partial: simply records a partial payment from debtor → creditor.
     */
    async settleUpPartial(
        groupId: string,
        debtorId: string,
        creditorId: string,
        partialAmountCents: number
    ): Promise<{ settled: number; remaining: number }> {
        if (debtorId === creditorId) throw new Error('Debtor and creditor cannot be the same person');

        await dbInsert('settlements', {
            group_id: groupId,
            paid_by: debtorId,
            paid_to: creditorId,
            amount: partialAmountCents / 100,
            settled_at: new Date().toISOString(),
            is_partial: true
        });

        return {
            settled: partialAmountCents / 100,
            remaining: 0,
        };
    },

    /**
     * Compute minimized transactions based on flat net balance.
     */
    _minimizeNetBalances(net: Record<string, number>): { from: string; to: string; amount: number }[] {
        const creditors = Object.entries(net)
            .filter(([, v]) => v > 0.01)
            .map(([name, v]) => [name, v] as [string, number])
            .sort((a, b) => b[1] - a[1]);                  // largest first

        const debtors = Object.entries(net)
            .filter(([, v]) => v < -0.01)
            .map(([name, v]) => [name, v] as [string, number])
            .sort((a, b) => a[1] - b[1]);                  // most negative first

        const result: { from: string; to: string; amount: number }[] = [];
        let i = 0, j = 0;

        while (i < debtors.length && j < creditors.length) {
            const [dName, dAmt] = debtors[i];    // negative value
            const [cName, cAmt] = creditors[j];  // positive value

            const settle = Math.min(-dAmt, cAmt);
            result.push({
                from: dName,
                to: cName,
                amount: Math.round(settle * 100) / 100,
            });

            (debtors[i] as [string, number])[1]   += settle;   // makes less negative
            (creditors[j] as [string, number])[1] -= settle;   // makes less positive

            if (Math.abs(debtors[i][1])   < 0.01) i++;
            if (Math.abs(creditors[j][1]) < 0.01) j++;
        }

        result.sort((a, b) => b.amount - a.amount);
        return result;
    },

    /**
     * Calculate who owes whom using the pure net balance approach.
     */
    async calculateGroupSettlements(groupId: string, members?: GroupMemberRow[], categoryFilter?: string) {
        void members;
        // Step 1: Get all expenses
        let expQuery = insforge.database.from('expenses').select('id, added_by, amount').eq('group_id', groupId);
        if (categoryFilter && categoryFilter !== 'All') {
            expQuery = expQuery.eq('category', categoryFilter);
        }
        const { data: expenses, error: expensesError } = await expQuery;
        if (expensesError) throw new Error(expensesError.message);

        const expenseRows = (expenses || []) as ExpenseBalanceRow[];
        const expenseIds = expenseRows.map((e) => e.id);

        // Step 2: Get all expense splits
        let splits: ExpenseSplitBalanceRow[] = [];
        if (expenseIds.length > 0) {
            const { data: splitsData, error: splitsError } = await insforge.database
                .from('expense_splits')
                .select('user_id, amount_owed')
                .in('expense_id', expenseIds);
            
            if (splitsError) throw new Error(splitsError.message);
            splits = (splitsData || []) as ExpenseSplitBalanceRow[];
        }

        // Step 3: Get all settlements
        const { data: settlements, error: settlementsError } = await insforge.database
            .from('settlements')
            .select('paid_by, paid_to, amount')
            .eq('group_id', groupId);
            
        if (settlementsError) throw new Error(settlementsError.message);

        // Compute net balance per user
        const net: Record<string, number> = {};

        for (const exp of expenseRows) {
            const payer = exp.added_by;
            net[payer] = (net[payer] ?? 0) + Number(exp.amount);
        }

        for (const split of splits) {
            const uid = split.user_id;
            net[uid] = (net[uid] ?? 0) - Number(split.amount_owed);
        }

        for (const s of (settlements || []) as SettlementBalanceRow[]) {
            net[s.paid_by] = (net[s.paid_by] ?? 0) + Number(s.amount);
            net[s.paid_to] = (net[s.paid_to] ?? 0) - Number(s.amount);
        }

        // Step 4: Run minimization on net balances
        return SettlementService._minimizeNetBalances(net);
    },

    /**
     * Builds a read-only audit trail for the explanation/report UI.
     * It mirrors the existing balance inputs and delegates settlement minimization
     * to the same helper; it never writes data or changes calculation behavior.
     */
    async getCalculationExplanation(groupId: string, categoryFilter = 'All'): Promise<CalculationExplanation> {
        let expenseQuery = insforge.database
            .from('expenses')
            .select('id,item_name,category,created_at,added_by,amount')
            .eq('group_id', groupId);
        if (categoryFilter !== 'All') expenseQuery = expenseQuery.eq('category', categoryFilter);

        const settlementRequest = insforge.database
            .from('settlements')
            .select('paid_by,paid_to,amount,settled_at,is_partial')
            .eq('group_id', groupId);

        const [{ data: expenseData, error: expenseError }, { data: settlementData, error: settlementError }] =
            await Promise.all([expenseQuery, settlementRequest]);
        if (expenseError) throw new Error(expenseError.message);
        if (settlementError) throw new Error(settlementError.message);

        const expenses = (expenseData || []) as ExplanationExpenseRow[];
        const expenseIds = expenses.map((expense) => expense.id);
        let splits: ExplanationSplitRow[] = [];
        if (expenseIds.length > 0) {
            const { data, error } = await insforge.database
                .from('expense_splits')
                .select('expense_id,user_id,amount_owed')
                .in('expense_id', expenseIds);
            if (error) throw new Error(error.message);
            splits = (data || []) as ExplanationSplitRow[];
        }

        const priorPayments = (settlementData || []) as SettlementBalanceRow[];
        const ledger: Record<string, Omit<MemberCalculationRow, 'userId' | 'netBalance'>> = {};
        const ensureMember = (userId: string) => {
            ledger[userId] ??= { paid: 0, assignedShare: 0, paymentsMade: 0, paymentsReceived: 0 };
            return ledger[userId];
        };

        for (const expense of expenses) ensureMember(expense.added_by).paid += Number(expense.amount);
        for (const split of splits) ensureMember(split.user_id).assignedShare += Number(split.amount_owed);
        for (const payment of priorPayments) {
            ensureMember(payment.paid_by).paymentsMade += Number(payment.amount);
            ensureMember(payment.paid_to).paymentsReceived += Number(payment.amount);
        }

        const net: Record<string, number> = {};
        const memberRows = Object.entries(ledger).map(([userId, row]) => {
            const netBalance = row.paid - row.assignedShare + row.paymentsMade - row.paymentsReceived;
            net[userId] = netBalance;
            return { userId, ...row, netBalance: Math.round(netBalance * 100) / 100 };
        });

        const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
        const shareTotal = splits.reduce((sum, split) => sum + Number(split.amount_owed), 0);
        const paymentTotal = priorPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);

        return {
            generatedAt: new Date().toISOString(),
            category: categoryFilter,
            expenses,
            splits,
            priorPayments,
            memberRows,
            suggestedPayments: SettlementService._minimizeNetBalances({ ...net }),
            totals: {
                expenses: Math.round(expenseTotal * 100) / 100,
                assignedShares: Math.round(shareTotal * 100) / 100,
                priorPayments: Math.round(paymentTotal * 100) / 100,
                balanceChecksum: Math.round(Object.values(net).reduce((sum, value) => sum + value, 0) * 100) / 100,
                splitDifference: Math.round((expenseTotal - shareTotal) * 100) / 100,
            },
        };
    },

    /**
     * Retained for compatibility with Balance.tsx. 
     * Simply delegates to _minimizeNetBalances after reducing array.
     */
    calculateMinimizedSettlements(
        rawNetBalances: { from: string; to: string; amount: number }[]
    ): { from: string; to: string; amount: number }[] {
        const net: Record<string, number> = {};
        for (const { from: debtor, to: creditor, amount } of rawNetBalances) {
            net[debtor]   = (net[debtor]   ?? 0) - amount;
            net[creditor] = (net[creditor] ?? 0) + amount;
        }
        return SettlementService._minimizeNetBalances(net);
    },
};
