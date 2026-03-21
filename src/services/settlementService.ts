import { dbQuery, dbInsert, dbUpdate } from '../lib/db';

export const SettlementService = {
    /**
     * Calculate the net balance for a single user in a group.
     *
     * Uses ALL expense_splits (no is_settled filter) so the result always
     * matches the full expense history — consistent with the CSV export.
     *
     * net > 0 → others owe this user (creditor)
     * net < 0 → this user owes others (debtor)
     */
    async calculateBalance(groupId: string, userId: string): Promise<{ totalPaid: number; totalOwed: number; netBalance: number }> {
        // Step 1: Fetch all expenses for this group with their payer
        const groupExpenses = await dbQuery('expenses', `group_id=eq.${groupId}&select=id,added_by,amount`);
        if (!groupExpenses || groupExpenses.length === 0) {
            return { totalPaid: 0, totalOwed: 0, netBalance: 0 };
        }

        // totalPaid = sum of all expense amounts where this user is the payer
        const totalPaid = (groupExpenses as any[])
            .filter((e: any) => e.added_by === userId)
            .reduce((sum: number, e: any) => sum + Number(e.amount), 0);

        // Build expenseId → added_by map
        const expenseCreditorMap: Record<string, string> = {};
        for (const exp of groupExpenses as any[]) {
            expenseCreditorMap[exp.id] = exp.added_by;
        }

        const expenseIds = (groupExpenses as any[]).map((e: any) => e.id);
        const expenseIdsStr = `(${expenseIds.join(',')})`;

        // Step 2: Fetch ALL splits for those expenses (no is_settled filter)
        //         — ensures balances match the full expense history / CSV export
        const splits = await dbQuery(
            'expense_splits',
            `expense_id=in.${expenseIdsStr}&select=amount_owed,user_id,expense_id`
        );

        let totalOwed = 0;      // what this user owes others
        let realOwedToMe = 0;   // what others owe this user

        (splits as any[] || []).forEach((split: any) => {
            const debtor = split.user_id;
            const creditor = expenseCreditorMap[split.expense_id];
            const amount = Number(split.amount_owed);

            // Skip self-owed splits (payer's own share cancels out)
            if (debtor !== creditor) {
                if (debtor === userId) totalOwed += amount;
                if (creditor === userId) realOwedToMe += amount;
            }
        });

        const netBalance = Math.round((realOwedToMe - totalOwed) * 100) / 100;

        return {
            totalPaid: Math.round(totalPaid * 100) / 100,
            totalOwed: Math.round(totalOwed * 100) / 100,
            netBalance,
        };
    },

    /**
     * Settle Up: records a payment from debtor → creditor and marks ALL related
     * unsettled splits between the two users in BOTH directions as settled.
     *
     * Why both directions?
     * The greedy algorithm nets mutual debts. E.g. Bilal owes Alfaiz ₹100 and
     * Alfaiz owes Bilal ₹30 → net shows Bilal pays Alfaiz ₹70. After settling,
     * BOTH sets of splits should be marked settled, otherwise Alfaiz's ₹30 split
     * lingers as a ghost balance.
     *
     * @param groupId    - the group
     * @param debtorId   - person who owes (s.from / paidBy)
     * @param creditorId - person who is owed (s.to / paidTo)
     * @param amount     - net amount being settled
     */
    async settleUp(groupId: string, debtorId: string, creditorId: string, amount: number) {
        // Guard: only the debtor should be able to call this — if IDs are the same something is wrong
        if (debtorId === creditorId) throw new Error('Debtor and creditor cannot be the same person');

        // 1. INSERT a settlement record: debtor paid creditor
        await dbInsert('settlements', {
            group_id: groupId,
            paid_by: debtorId,
            paid_to: creditorId,
            amount: amount
        });

        // 2a. Fetch expenses added by the CREDITOR in this group
        //     → these are expenses where the DEBTOR owes money to the CREDITOR
        const creditorExpenses = await dbQuery('expenses', `added_by=eq.${creditorId}&group_id=eq.${groupId}&select=id`);
        const creditorExpenseIds = (creditorExpenses as any[] || []).map((e: any) => e.id);

        if (creditorExpenseIds.length > 0) {
            const idsStr = `(${creditorExpenseIds.join(',')})`;
            // Mark the DEBTOR's splits on the CREDITOR's expenses as settled
            await dbUpdate(
                'expense_splits',
                `user_id=eq.${debtorId}&is_settled=eq.false&expense_id=in.${idsStr}`,
                { is_settled: true, settled_at: new Date().toISOString() }
            );
        }

        // 2b. Fetch expenses added by the DEBTOR in this group
        //     → these are expenses where the CREDITOR may owe money to the DEBTOR
        //     These must ALSO be cleared because the net settlement already accounts for them.
        const debtorExpenses = await dbQuery('expenses', `added_by=eq.${debtorId}&group_id=eq.${groupId}&select=id`);
        const debtorExpenseIds = (debtorExpenses as any[] || []).map((e: any) => e.id);

        if (debtorExpenseIds.length > 0) {
            const idsStr = `(${debtorExpenseIds.join(',')})`;
            // Mark the CREDITOR's splits on the DEBTOR's expenses as settled
            await dbUpdate(
                'expense_splits',
                `user_id=eq.${creditorId}&is_settled=eq.false&expense_id=in.${idsStr}`,
                { is_settled: true, settled_at: new Date().toISOString() }
            );
        }

        return true;
    },

    /**
     * Calculate minimized settlements for the entire group (Greedy debt-simplification).
     *
     * Uses ALL expense_splits (no is_settled filter) to produce gross balances
     * that always match the full expense history / CSV export.
     *
     * Algorithm:
     *  1. Sum amount_owed per user pair from splits → net[user] = owed_to_me - i_owe
     *  2. Split into creditors (net > 0) and debtors (net < 0)
     *  3. Greedy: largest debtor pays largest creditor first, repeat until cleared
     */
    async calculateGroupSettlements(groupId: string, members: any[], categoryFilter?: string) {
        // Step 1: Fetch all expense IDs for this group (optionally filtered by category)
        let expQuery = `group_id=eq.${groupId}&select=id,added_by`;
        if (categoryFilter && categoryFilter !== 'All') expQuery += `&category=eq.${categoryFilter}`;
        const groupExpenses = await dbQuery('expenses', expQuery);

        if (!groupExpenses || (groupExpenses as any[]).length === 0) return [];

        // Build creditor map: expenseId → added_by (the payer / creditor)
        const expenseCreditorMap: Record<string, string> = {};
        for (const exp of groupExpenses as any[]) {
            expenseCreditorMap[exp.id] = exp.added_by;
        }

        const expenseIds = (groupExpenses as any[]).map((e: any) => e.id);
        const expenseIdsStr = `(${expenseIds.join(',')})`;

        // Step 2: Fetch ALL splits for those expenses — no is_settled filter.
        //         Settled state is tracked in the settlements table, not here.
        const splits = await dbQuery(
            'expense_splits',
            `expense_id=in.${expenseIdsStr}&select=amount_owed,user_id,expense_id`
        );

        // Step 3: Calculate net balance for every group member (in integer cents to avoid float drift)
        const balancesCents: Record<string, number> = {};
        members.forEach((m: any) => { balancesCents[m.user_id] = 0; });

        (splits as any[] || []).forEach((split: any) => {
            const debtor = split.user_id;
            const creditor = expenseCreditorMap[split.expense_id];
            // Convert to cents for integer arithmetic
            const amountCents = Math.round(Number(split.amount_owed) * 100);

            // Skip self-owed splits (payer's own share cancels out in the net)
            if (debtor !== creditor) {
                if (balancesCents[debtor] !== undefined) balancesCents[debtor] -= amountCents;
                if (balancesCents[creditor] !== undefined) balancesCents[creditor] += amountCents;
            }
        });

        // Step 4: Separate into debtors (net < 0) and creditors (net > 0) — using 1 cent threshold
        const debtors: { userId: string; cents: number }[] = [];
        const creditors: { userId: string; cents: number }[] = [];

        for (const [userId, cents] of Object.entries(balancesCents)) {
            if (cents < -1) debtors.push({ userId, cents: Math.abs(cents) });
            else if (cents > 1) creditors.push({ userId, cents });
        }

        // Step 5: Greedy matching — re-sort after each step so we always match the largest amounts
        const settlements: { from: string; to: string; amount: number }[] = [];

        debtors.sort((a, b) => b.cents - a.cents);
        creditors.sort((a, b) => b.cents - a.cents);

        while (debtors.length > 0 && creditors.length > 0) {
            const debtor = debtors[0];
            const creditor = creditors[0];

            const settleCents = Math.min(debtor.cents, creditor.cents);

            if (settleCents > 1) {
                settlements.push({
                    from: debtor.userId,
                    to: creditor.userId,
                    amount: Math.round(settleCents) / 100,   // convert back to rupees
                });
            }

            debtor.cents -= settleCents;
            creditor.cents -= settleCents;

            // Remove fully settled parties, then re-sort for next iteration
            if (debtor.cents <= 1) debtors.shift();
            if (creditor.cents <= 1) creditors.shift();

            // Re-sort both lists so the largest remaining amount is always first
            debtors.sort((a, b) => b.cents - a.cents);
            creditors.sort((a, b) => b.cents - a.cents);
        }

        return settlements;
    }
};
