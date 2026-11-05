import { dbQuery, supabaseClient } from '../lib/db';

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

async function saveExpense(payload: Partial<ExpenseData>, expenseId: string | null) {
    const { data, error } = await supabaseClient.rpc('save_expense', {
        p_expense: payload, p_expense_id: expenseId,
    });
    if (error) throw new Error(error.message || 'Failed to save expense');
    if (!data) throw new Error('Failed to save expense');
    return data as ExpenseRow;
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


    async deleteExpense(groupId: string, expenseId: string) {
        const { error } = await supabaseClient.rpc('delete_group_expense', {
            p_group_id: groupId, p_expense_id: expenseId,
        });
        if (error) throw new Error(error.message || 'Failed to delete expense');
    },

    async resetGroupExpenses(groupId: string) {
        const { error } = await supabaseClient.rpc('reset_group_expenses', { p_group_id: groupId });
        if (error) throw new Error(error.message || 'Failed to reset group expenses');
    },

    async addExpense(expenseData: ExpenseData) {
        return saveExpense(expenseData, null);
    },

    async editExpense(expenseId: string, updates: Partial<ExpenseData>) {
        const { group_id: _groupId, added_by: _addedBy, ...payload } = updates;
        void _groupId;
        void _addedBy;
        return saveExpense(payload, expenseId);
    }
};
