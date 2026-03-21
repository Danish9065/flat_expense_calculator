import { dbInsert, dbQuery, dbUpdate, dbDelete } from '../lib/db';

export interface ExpenseData {
    group_id: string;
    category: string;
    item_name: string;
    amount: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    added_by: any; // User ID
    note: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    receipt_url: any;
    is_recurring: boolean;
    recur_type: 'weekly' | 'monthly' | null;
    splitBetween?: string[]; // Array of user_ids involved in the split
}

/**
 * Distribute a total amount across members using integer cent arithmetic.
 *
 * Works entirely in cents (integers) to eliminate floating-point drift.
 * The payer absorbs all remainder cents (leftover after even division).
 *
 * Example: ₹100 split 3 ways → ₹33.33, ₹33.33, ₹33.34 (payer gets the extra cent)
 *
 * Returns an array of { userId, amount_owed } in the same order as memberIds.
 */
function distributeSplit(totalAmount: number, memberIds: string[], payerUserId: string) {
    const n = memberIds.length;

    // Work in integer cents to avoid float precision drift
    const totalCents = Math.round(totalAmount * 100);
    const baseCents = Math.floor(totalCents / n);
    const remainderCents = totalCents - baseCents * n; // always 0 to (n-1)

    // Find payer index; if payer is not in the split list fall back to index 0
    const payerIndex = memberIds.indexOf(payerUserId) !== -1 ? memberIds.indexOf(payerUserId) : 0;

    return memberIds.map((userId, i) => ({
        userId,
        // Payer absorbs all remainder cents — convert back to rupees
        amount_owed: (i === payerIndex ? baseCents + remainderCents : baseCents) / 100,
    }));
}

export const ExpenseService = {
    /**
     * Fetch all expenses for a group, including:
     *  - users(full_name) → joined from added_by FK (the payer)
     *  - expense_splits(user_id, amount_owed) → who owes what
     *
     * Call this from any page that needs "Paid by → For whom" display.
     * Map unknown UUIDs to names using the group_members list already
     * available in GroupContext (members[].user_id → members[].users.full_name).
     */
    async getExpenses(groupId: string) {
        return dbQuery(
            'expenses',
            `group_id=eq.${groupId}&order=created_at.desc&select=*,users(full_name),expense_splits(user_id,amount_owed)`
        );
    },


    async addExpense(expenseData: ExpenseData) {
        const { splitBetween, ...dbPayload } = expenseData;

        const expenses = await dbInsert('expenses', dbPayload);
        if (!expenses || expenses.length === 0) throw new Error('Failed to add expense');
        const expense = expenses[0] as any;

        let splitMemberIds = expenseData.splitBetween;

        if (!splitMemberIds || splitMemberIds.length === 0) {
            const members = await dbQuery('group_members', `group_id=eq.${expenseData.group_id}&select=user_id`);
            if (!members || members.length === 0) {
                throw new Error('No members found in group');
            }
            splitMemberIds = members.map((m: any) => m.user_id);
        }

        if (!splitMemberIds || splitMemberIds.length === 0) throw new Error('No members to split with');
        const splits = distributeSplit(expenseData.amount, splitMemberIds, expenseData.added_by);

        for (const split of splits) {
            await dbInsert('expense_splits', {
                expense_id: expense.id,
                user_id: split.userId,
                amount_owed: split.amount_owed,
            });
        }

        return expense;
    },

    async editExpense(expenseId: string, updates: Partial<ExpenseData>) {
        const { splitBetween, ...dbPayload } = updates;

        const updatedExpenses = await dbUpdate('expenses', `id=eq.${expenseId}`, {
            ...dbPayload,
            updated_at: new Date().toISOString()
        });
        if (!updatedExpenses || updatedExpenses.length === 0) throw new Error('Failed to update expense');
        const expense = updatedExpenses[0] as any;

        if (updates.amount !== undefined || updates.splitBetween !== undefined) {
            await dbDelete('expense_splits', `expense_id=eq.${expenseId}`);

            let splitMemberIds = updates.splitBetween;

            if (!splitMemberIds || splitMemberIds.length === 0) {
                const members = await dbQuery('group_members', `group_id=eq.${expense.group_id}&select=user_id`);
                if (!members || members.length === 0) throw new Error('Failed to fetch members for split recalculation');
                splitMemberIds = members.map((m: any) => m.user_id);
            }

            const totalAmount = updates.amount !== undefined ? updates.amount : expense.amount;
            // Use the original payer (expense.added_by) so remainder still goes to them
            if (!splitMemberIds || splitMemberIds.length === 0) throw new Error('No members to split with');
            const payerUserId = updates.added_by ?? expense.added_by;
            const splits = distributeSplit(totalAmount, splitMemberIds, payerUserId);

            for (const split of splits) {
                await dbInsert('expense_splits', {
                    expense_id: expense.id,
                    user_id: split.userId,
                    amount_owed: split.amount_owed,
                });
            }
        }

        return expense;
    }
};
