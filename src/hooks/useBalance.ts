import { useState, useEffect } from 'react';
// @ts-ignore
import insforge from '../lib/db';
import { dbQuery } from '../lib/db';

export function useBalance(groupId: string | null, userId: string | null) {
    const [balance, setBalance] = useState(0);
    const [debts, setDebts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const calculateBalance = async () => {
        if (!groupId || !userId) return;

        try {
            setLoading(true);
            const paid = await dbQuery('expenses', `group_id=eq.${groupId}&added_by=eq.${userId}&select=amount`);

            const totalPaid = paid?.reduce((sum: number, e: any) => sum + parseFloat(e.amount), 0) ?? 0;

            const owed = await dbQuery('expense_splits', `user_id=eq.${userId}&is_settled=eq.false&select=amount_owed`);

            const totalOwed = owed?.reduce((sum: number, s: any) => sum + parseFloat(s.amount_owed), 0) ?? 0;

            setBalance(parseFloat((totalPaid - totalOwed).toFixed(2)));
        } catch (e) { console.error(e) } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        calculateBalance();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId, userId]);

    return { balance, debts, loading, recalculate: calculateBalance };
}
