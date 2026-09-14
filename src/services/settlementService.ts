import { dbInsert, supabaseClient } from '../lib/db';
import { calculateSettlementLedger, minimizeNetBalances } from '../lib/settlementCalculation';

interface ExpenseBalanceRow {
    id: string;
    added_by: string;
    amount: string | number;
}

interface ExpenseSplitBalanceRow {
    expense_id: string;
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

interface BatchSettlementAllocation {
    groupId: string;
    debtorId: string;
    creditorId: string;
    amount: number;
}

export const SettlementService = {
    /**
     * Records a creditor-confirmed combined payment atomically across groups.
     * The database function derives the creditor from auth.uid() and validates
     * that both parties belong to every source group.
     */
    async settleMultiple(allocations: BatchSettlementAllocation[]) {
        if (allocations.length === 0) throw new Error('No payment allocations were provided');
        const creditorIds = new Set(allocations.map((allocation) => allocation.creditorId));
        if (creditorIds.size !== 1) throw new Error('A combined confirmation must have one receiver');

        const { data, error } = await supabaseClient.rpc('record_group_settlements_batch', {
            p_payments: allocations.map((allocation) => ({
                group_id: allocation.groupId,
                debtor_id: allocation.debtorId,
                amount: Math.round(allocation.amount * 100) / 100,
            })),
        });
        if (error) throw new Error(error.message || 'Failed to record combined payment');
        return data;
    },

    /**
     * Calculate the net balance for a single user in a group.
     */
    async calculateBalance(groupId: string, userId: string): Promise<{ totalPaid: number; totalOwed: number; netBalance: number }> {
        // Step 1: Get all expenses
        const { data: expenses, error: expensesError } = await supabaseClient
            .from('expenses')
            .select('id, added_by, amount')
            .eq('group_id', groupId);

        if (expensesError) throw new Error(expensesError.message);

        const expenseRows = (expenses || []) as ExpenseBalanceRow[];
        const expenseIds = expenseRows.map((e) => e.id);

        // Step 2: Get all expense splits
        let splits: ExpenseSplitBalanceRow[] = [];
        if (expenseIds.length > 0) {
            const { data: splitsData, error: splitsError } = await supabaseClient
                .from('expense_splits')
                .select('expense_id, user_id, amount_owed')
                .in('expense_id', expenseIds);
            
            if (splitsError) throw new Error(splitsError.message);
            splits = (splitsData || []) as ExpenseSplitBalanceRow[];
        }

        // Step 3: Get all settlements
        const { data: settlements, error: settlementsError } = await supabaseClient
            .from('settlements')
            .select('paid_by, paid_to, amount')
            .eq('group_id', groupId);
            
        if (settlementsError) throw new Error(settlementsError.message);

        const calculation = calculateSettlementLedger(
            expenseRows,
            splits,
            (settlements || []) as SettlementBalanceRow[],
        );
        const member = calculation.members.find((row) => row.userId === userId);

        return {
            totalPaid: member?.paid ?? 0,
            totalOwed: member?.assignedShare ?? 0,
            netBalance: member?.netBalance ?? 0,
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
        return minimizeNetBalances(net);
    },

    /**
     * Calculate direct person-to-person balances for a group. This preserves
     * the original expense payer instead of arbitrarily rerouting equal debts.
     */
    async calculateGroupSettlements(groupId: string, members?: GroupMemberRow[], categoryFilter?: string) {
        void members;
        // Step 1: Get all expenses
        let expQuery = supabaseClient.from('expenses').select('id, added_by, amount').eq('group_id', groupId);
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
            const { data: splitsData, error: splitsError } = await supabaseClient
                .from('expense_splits')
                .select('expense_id, user_id, amount_owed')
                .in('expense_id', expenseIds);
            
            if (splitsError) throw new Error(splitsError.message);
            splits = (splitsData || []) as ExpenseSplitBalanceRow[];
        }

        // Step 3: Get all settlements
        const { data: settlements, error: settlementsError } = await supabaseClient
            .from('settlements')
            .select('paid_by, paid_to, amount')
            .eq('group_id', groupId);
            
        if (settlementsError) throw new Error(settlementsError.message);

        // Payments have no category field, so applying every historical payment
        // to one category invents a category allocation that was never recorded.
        const applicableSettlements = categoryFilter && categoryFilter !== 'All'
            ? []
            : (settlements || []) as SettlementBalanceRow[];
        const calculation = calculateSettlementLedger(expenseRows, splits, applicableSettlements);
        if (calculation.totals.balanceChecksum !== 0) {
            throw new Error(
                `Group ledger is out of balance by ₹${Math.abs(calculation.totals.balanceChecksum).toFixed(2)}. ` +
                'One or more expenses do not have matching assigned shares.',
            );
        }
        return calculation.directSettlements;
    },

    /**
     * Builds a read-only audit trail for the explanation/report UI.
     * It mirrors the existing balance inputs and delegates settlement minimization
     * to the same helper; it never writes data or changes calculation behavior.
     */
    async getCalculationExplanation(groupId: string, categoryFilter = 'All'): Promise<CalculationExplanation> {
        let expenseQuery = supabaseClient
            .from('expenses')
            .select('id,item_name,category,created_at,added_by,amount')
            .eq('group_id', groupId);
        if (categoryFilter !== 'All') expenseQuery = expenseQuery.eq('category', categoryFilter);

        const settlementRequest = supabaseClient
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
            const { data, error } = await supabaseClient
                .from('expense_splits')
                .select('expense_id,user_id,amount_owed')
                .in('expense_id', expenseIds);
            if (error) throw new Error(error.message);
            splits = (data || []) as ExplanationSplitRow[];
        }

        const priorPayments = categoryFilter === 'All'
            ? (settlementData || []) as SettlementBalanceRow[]
            : [];
        const calculation = calculateSettlementLedger(expenses, splits, priorPayments);

        return {
            generatedAt: new Date().toISOString(),
            category: categoryFilter,
            expenses,
            splits,
            priorPayments,
            memberRows: calculation.members,
            suggestedPayments: calculation.settlements,
            totals: calculation.totals,
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
