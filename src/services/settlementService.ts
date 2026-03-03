import { dbQuery, dbInsert, dbUpdate } from '../lib/db';

export const SettlementService = {
    // Calculate Balance Per User
    async calculateBalance(groupId: string, userId: string): Promise<{ totalPaid: number; totalOwed: number; netBalance: number }> {
        const splits = await dbQuery('expense_splits', `is_settled=eq.false&expenses.group_id=eq.${groupId}&select=amount_owed,user_id,expenses!inner(added_by)`);

        let realOwed = 0;
        let realOwedToMe = 0;

        (splits || []).forEach((split: any) => {
            const debtor = split.user_id;
            const creditor = split.expenses.added_by;
            const amount = Number(split.amount_owed);

            if (debtor !== creditor) {
                if (debtor === userId) realOwed += amount;
                if (creditor === userId) realOwedToMe += amount;
            }
        });

        const netBalance = realOwedToMe - realOwed;

        return { totalPaid: 0, totalOwed: realOwed, netBalance };
    },

    // Settle Up
    async settleUp(groupId: string, paidByUserId: string, targetUserId: string, amount: number, categoryFilter?: string) {
        // 1. INSERT into settlements { group_id, paid_by, paid_to, amount }
        await dbInsert('settlements', {
            group_id: groupId,
            paid_by: paidByUserId,
            paid_to: targetUserId,
            amount: amount
        });

        // 2. UPDATE expense_splits SET is_settled=true, settled_at=now()
        // Need to fetch target expenses first to do this via postgREST
        let queryStr = `added_by=eq.${targetUserId}&group_id=eq.${groupId}&select=id`;
        if (categoryFilter && categoryFilter !== 'All') queryStr += `&category=eq.${categoryFilter.toLowerCase()}`;
        const targetExpenses = await dbQuery('expenses', queryStr);

        const expenseIds = (targetExpenses || []).map((e: any) => e.id);

        if (expenseIds.length > 0) {
            const expenseIdsString = `(${expenseIds.join(',')})`;
            await dbUpdate('expense_splits', `user_id=eq.${paidByUserId}&is_settled=eq.false&expense_id=in.${expenseIdsString}`, {
                is_settled: true,
                settled_at: new Date().toISOString()
            });
        }

        return true;
    },

    // Calculate minimized settlements for the entire group
    async calculateGroupSettlements(groupId: string, members: any[], categoryFilter?: string) {
        // Fetch all unsettled splits for this group
        let q = `is_settled=eq.false&expenses.group_id=eq.${groupId}&select=amount_owed,user_id,expenses!inner(added_by,group_id,category)`;
        if (categoryFilter && categoryFilter !== 'All') q += `&expenses.category=eq.${categoryFilter.toLowerCase()}`;
        const splits = await dbQuery('expense_splits', q);

        // 1. Calculate net balances
        const balances: Record<string, number> = {};
        members.forEach(m => balances[m.user_id] = 0);

        (splits || []).forEach((split: any) => {
            const debtor = split.user_id;
            const creditor = split.expenses.added_by;
            const amount = Number(split.amount_owed);

            if (debtor !== creditor) {
                if (balances[debtor] !== undefined) balances[debtor] -= amount;
                if (balances[creditor] !== undefined) balances[creditor] += amount;
            }
        });

        // 2. Separate into debtors and creditors
        const debtors: { userId: string, amount: number }[] = [];
        const creditors: { userId: string, amount: number }[] = [];

        for (const [userId, balance] of Object.entries(balances)) {
            if (balance < -0.01) debtors.push({ userId, amount: Math.abs(balance) });
            else if (balance > 0.01) creditors.push({ userId, amount: balance });
        }

        // Sort descending
        debtors.sort((a, b) => b.amount - a.amount);
        creditors.sort((a, b) => b.amount - a.amount);

        // 3. Match debtors and creditors (Greedy algorithm)
        const settlements = [];
        let d = 0, c = 0;

        while (d < debtors.length && c < creditors.length) {
            const debtor = debtors[d];
            const creditor = creditors[c];

            const settleAmount = Math.min(debtor.amount, creditor.amount);

            if (settleAmount > 0.01) {
                settlements.push({
                    from: debtor.userId,
                    to: creditor.userId,
                    amount: settleAmount
                });
            }

            debtor.amount -= settleAmount;
            creditor.amount -= settleAmount;

            if (debtor.amount < 0.01) d++;
            if (creditor.amount < 0.01) c++;
        }

        return settlements;
    }
};
