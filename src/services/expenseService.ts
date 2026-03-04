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

export const ExpenseService = {
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

        const totalAmount = expenseData.amount;
        const baseSplit = Math.floor((totalAmount / splitMemberIds.length) * 100) / 100;
        const remainder = Math.round((totalAmount - (baseSplit * splitMemberIds.length)) * 100) / 100;

        for (let i = 0; i < splitMemberIds.length; i++) {
            const userId = splitMemberIds[i];
            const amount_owed = i === 0 ? Math.round((baseSplit + remainder) * 100) / 100 : baseSplit;
            await dbInsert('expense_splits', {
                expense_id: expense.id,
                user_id: userId,
                amount_owed
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
            const baseSplit = Math.floor((totalAmount / splitMemberIds.length) * 100) / 100;
            const remainder = Math.round((totalAmount - (baseSplit * splitMemberIds.length)) * 100) / 100;

            for (let i = 0; i < splitMemberIds.length; i++) {
                const userId = splitMemberIds[i];
                const amount_owed = i === 0 ? Math.round((baseSplit + remainder) * 100) / 100 : baseSplit;
                await dbInsert('expense_splits', {
                    expense_id: expense.id,
                    user_id: userId,
                    amount_owed
                });
            }
        }
        return expense;
    }
};
