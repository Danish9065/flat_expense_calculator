import { dbInsert, dbQuery, dbUpdate, dbDelete } from '../lib/db';
import { distributeExpenseAmount } from '../lib/settlementCalculation';

export interface ExpenseData {
    group_id: string;
    category: string;
    item_name: string;
    amount: number;
    added_by: string; // User ID
    note: string;
    receipt_url: string | null;
    is_recurring: boolean;
    recur_type: 'weekly' | 'monthly' | null;
    splitBetween?: string[]; // Array of user_ids involved in the split
}

interface ExpenseRow extends ExpenseData {
    id: string;
}

interface GroupMemberRow {
    user_id: string;
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
        const { splitBetween: _splitBetween, ...dbPayload } = expenseData;
        void _splitBetween;

        const expenses = await dbInsert('expenses', dbPayload);
        if (!expenses || expenses.length === 0) throw new Error('Failed to add expense');
        const expense = (expenses as ExpenseRow[])[0];

        let splitMemberIds = expenseData.splitBetween;

        if (!splitMemberIds || splitMemberIds.length === 0) {
            const members = await dbQuery('group_members', `group_id=eq.${expenseData.group_id}&select=user_id`);
            if (!members || members.length === 0) {
                throw new Error('No members found in group');
            }
            splitMemberIds = (members as GroupMemberRow[]).map((m) => m.user_id);
        }

        if (!splitMemberIds || splitMemberIds.length === 0) throw new Error('No members to split with');
        const splits = distributeExpenseAmount(expenseData.amount, splitMemberIds, expenseData.added_by);

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
        const {
            splitBetween: _splitBetween,
            group_id: _groupId,
            added_by: _addedBy,
            ...dbPayload
        } = updates;
        void _splitBetween;
        void _groupId;
        void _addedBy;

        const updatedExpenses = await dbUpdate('expenses', `id=eq.${expenseId}`, {
            ...dbPayload,
            updated_at: new Date().toISOString()
        });
        if (!updatedExpenses || updatedExpenses.length === 0) throw new Error('Failed to update expense');
        const expense = (updatedExpenses as ExpenseRow[])[0];

        if (updates.amount !== undefined || updates.splitBetween !== undefined) {
            await dbDelete('expense_splits', `expense_id=eq.${expenseId}`);

            let splitMemberIds = updates.splitBetween;

            if (!splitMemberIds || splitMemberIds.length === 0) {
                const members = await dbQuery('group_members', `group_id=eq.${expense.group_id}&select=user_id`);
                if (!members || members.length === 0) throw new Error('Failed to fetch members for split recalculation');
                splitMemberIds = (members as GroupMemberRow[]).map((m) => m.user_id);
            }

            const totalAmount = updates.amount !== undefined ? updates.amount : expense.amount;
            // Use the original payer so they receive the first remainder paisa.
            if (!splitMemberIds || splitMemberIds.length === 0) throw new Error('No members to split with');
            const payerUserId = updates.added_by ?? expense.added_by;
            const splits = distributeExpenseAmount(totalAmount, splitMemberIds, payerUserId);

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
