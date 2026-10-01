import { dbInsert, supabaseClient } from '../lib/db';
import { readAllPages } from '../lib/pagination';
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
    issues: string[];
    directPayments: { from: string; to: string; amount: number }[];
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

const recordingGroups = new Set<string>();

/** Recheck displayed amounts immediately before confirmation; serialize this client's writes. */
async function confirmCurrentPayments<T>(allocations: BatchSettlementAllocation[], exact: boolean, write: () => Promise<T>) {
    const groups = [...new Set(allocations.map((allocation) => allocation.groupId))];
    if (groups.some((id) => recordingGroups.has(id))) throw new Error('A payment is already being recorded. Please wait.');
    groups.forEach((id) => recordingGroups.add(id));
    try {
        const keys = new Set<string>();
        const plans = new Map(await Promise.all(groups.map(async (id) =>
            [id, await SettlementService.calculateGroupSettlements(id)] as const)));
        for (const allocation of allocations) {
            const key = `${allocation.groupId}:${allocation.debtorId}:${allocation.creditorId}`;
            const cents = Math.round(allocation.amount * 100);
            if (keys.has(key) || !Number.isSafeInteger(cents) || cents <= 0 || Math.abs(cents / 100 - allocation.amount) > 0.000001) {
                throw new Error('Payment amounts must be positive, unique and have at most two decimal places.');
            }
            keys.add(key);
            const payment = plans.get(allocation.groupId)?.find((row) => row.from === allocation.debtorId && row.to === allocation.creditorId);
            const available = Math.round((payment?.amount ?? 0) * 100);
            if (cents > available || (exact && cents !== available)) {
                throw new Error('This payment amount has changed. Refresh and review the current calculation before confirming.');
            }
        }
        return await write();
    } finally {
        groups.forEach((id) => recordingGroups.delete(id));
    }
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

        return confirmCurrentPayments(allocations, true, async () => {
        const { data, error } = await supabaseClient.rpc('record_group_settlements_batch', {
            p_payments: allocations.map((allocation) => ({
                group_id: allocation.groupId,
                debtor_id: allocation.debtorId,
                amount: Math.round(allocation.amount * 100) / 100,
            })),
        });
        if (error) throw new Error(error.message || 'Failed to record combined payment');
        return data;
        });
    },

    /**
     * Calculate the net balance for a single user in a group.
     */
    async calculateBalance(groupId: string, userId: string): Promise<{ totalPaid: number; totalOwed: number; netBalance: number }> {
        const report = await SettlementService.getCalculationExplanation(groupId);
        if (report.issues.length) throw new Error(report.issues[0]);
        const member = report.memberRows.find((row) => row.userId === userId);

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

        await confirmCurrentPayments([{ groupId, debtorId, creditorId, amount }], true, () => dbInsert('settlements', {
            group_id: groupId,
            paid_by: debtorId,
            paid_to: creditorId,
            amount: amount,
            settled_at: new Date().toISOString(),
            is_partial: false
        }));

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

        if (!Number.isSafeInteger(partialAmountCents) || partialAmountCents <= 0) throw new Error('Invalid partial payment');
        await confirmCurrentPayments([{ groupId, debtorId, creditorId, amount: partialAmountCents / 100 }], false, () => dbInsert('settlements', {
            group_id: groupId,
            paid_by: debtorId,
            paid_to: creditorId,
            amount: partialAmountCents / 100,
            settled_at: new Date().toISOString(),
            is_partial: true
        }));

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
     * Calculate the canonical minimized payment plan for a group.
     *
     * Every consumer (group details, Payment Center, exports, and payment
     * confirmation) must use this same plan. Returning direct expense-payer
     * debts here makes the all-groups view disagree with "How to Settle Up"
     * whenever a member has both debits and credits inside one group.
     */
    async calculateGroupSettlements(groupId: string, members?: GroupMemberRow[], categoryFilter?: string) {
        void members;
        const report = await SettlementService.getCalculationExplanation(groupId, categoryFilter);
        if (report.issues.length) throw new Error(report.issues[0]);
        return report.suggestedPayments;
    },

    /**
     * Builds a read-only audit trail for the explanation/report UI.
     * It mirrors the existing balance inputs and delegates settlement minimization
     * to the same helper; it never writes data or changes calculation behavior.
     */
    async getCalculationExplanation(groupId: string, categoryFilter = 'All'): Promise<CalculationExplanation> {
        // Stable ordering + exact counts avoid silently truncating large groups.
        const [expenses, splits, priorPayments] = await Promise.all([
            readAllPages<ExplanationExpenseRow>((from, to) => {
                let query = supabaseClient.from('expenses')
                    .select('id,item_name,category,created_at,added_by,amount', { count: 'exact' })
                    .eq('group_id', groupId);
                if (categoryFilter !== 'All') query = query.eq('category', categoryFilter);
                return query.order('id').range(from, to);
            }),
            readAllPages<ExplanationSplitRow>((from, to) => {
                let query = supabaseClient.from('expense_splits')
                    .select('expense_id,user_id,amount_owed,expenses!inner(group_id,category)', { count: 'exact' })
                    .eq('expenses.group_id', groupId);
                if (categoryFilter !== 'All') query = query.eq('expenses.category', categoryFilter);
                return query.order('id').range(from, to);
            }),
            categoryFilter === 'All'
                ? readAllPages<SettlementBalanceRow>((from, to) => supabaseClient.from('settlements')
                    .select('paid_by,paid_to,amount,settled_at,is_partial', { count: 'exact' })
                    .eq('group_id', groupId).order('id').range(from, to))
                : Promise.resolve([]),
        ]);
        const expenseIds = new Set(expenses.map((expense) => expense.id));
        if (splits.some((split) => !expenseIds.has(split.expense_id))) {
            throw new Error('The ledger changed while loading. Please refresh.');
        }
        const calculation = calculateSettlementLedger(expenses, splits, priorPayments);

        return {
            generatedAt: new Date().toISOString(),
            category: categoryFilter,
            expenses,
            splits,
            priorPayments,
            memberRows: calculation.members,
            issues: calculation.issues,
            directPayments: calculation.issues.length ? [] : calculation.directSettlements,
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
