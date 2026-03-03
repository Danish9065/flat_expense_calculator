import { useState, useEffect } from 'react';
// @ts-ignore
import insforge from '../lib/db';
import { dbQuery, dbInsert, dbDelete, dbUpdate } from '../lib/db';

export function useExpenses(groupId: string | null, category: string | null = null) {
    const [expenses, setExpenses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchExpenses = async () => {
        if (!groupId) return;
        setLoading(true);
        let params = `group_id=eq.${groupId}&select=*,users(full_name,avatar_url)&order=created_at.desc`;
        if (category) params += `&category=eq.${category}`;

        try {
            const data = await dbQuery('expenses', params);
            setExpenses(data ?? []);
        } catch (e) { console.error('Error fetching expenses', e); }
        setLoading(false);
    };

    useEffect(() => {
        fetchExpenses();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId, category]);

    const addExpense = async (expense: any, members: any[]) => {
        const dataList = await dbInsert('expenses', expense);
        const data = dataList[0];
        const splitAmount = parseFloat((expense.amount / members.length).toFixed(2));
        const splits = members.map((m: any) => ({
            expense_id: data.id,
            user_id: m.id,
            amount_owed: splitAmount
        }));
        await dbInsert('expense_splits', splits);
        await fetchExpenses();
    };

    const deleteExpense = async (expenseId: string) => {
        await dbDelete('expenses', `id=eq.${expenseId}`);
        setExpenses((prev: any[]) => prev.filter(e => e.id !== expenseId));
    };

    const updateExpense = async (expenseId: string, updates: any, members: any[]) => {
        await dbUpdate('expenses', `id=eq.${expenseId}`, updates);
        await dbDelete('expense_splits', `expense_id=eq.${expenseId}`);

        const splitAmount = parseFloat((updates.amount / members.length).toFixed(2));
        const splits = members.map((m: any) => ({
            expense_id: expenseId,
            user_id: m.id,
            amount_owed: splitAmount
        }));
        await dbInsert('expense_splits', splits);
        await fetchExpenses();
    };

    return { expenses, loading, addExpense, deleteExpense, updateExpense, refetch: fetchExpenses };
}
