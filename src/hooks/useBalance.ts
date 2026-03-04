import { useState, useEffect } from 'react';
import { dbQuery } from '../lib/db';

export function useBalance(groupId: string | null, userId: string | null, category: string = 'All') {
    const [balance, setBalance] = useState(0);
    const [loading, setLoading] = useState(true);

    const calculateBalance = async () => {
        if (!groupId || !userId) return;

        try {
            setLoading(true);
            let paidQuery = `group_id=eq.${groupId}&added_by=eq.${userId}&select=amount`;
            if (category !== 'All') paidQuery += `&category=eq.${category}`;
            const paid = await dbQuery('expenses', paidQuery);

            const totalPaid = paid?.reduce((sum: number, e: any) => sum + parseFloat(e.amount), 0) ?? 0;

            let owedQuery = `user_id=eq.${userId}&is_settled=eq.false&select=amount_owed,expenses!inner(category)`;
            if (category !== 'All') owedQuery += `&expenses.category=eq.${category}`;
            const owed = await dbQuery('expense_splits', owedQuery);

            const totalOwed = owed?.reduce((sum: number, s: any) => sum + parseFloat(s.amount_owed), 0) ?? 0;

            setBalance(parseFloat((totalPaid - totalOwed).toFixed(2)));
        } catch (e) { console.error(e) } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        calculateBalance();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId, userId, category]);

    return { balance, loading, recalculate: calculateBalance };
}
