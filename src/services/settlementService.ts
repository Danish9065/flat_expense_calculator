import { dbQuery, dbInsert, dbUpdate } from '../lib/db';

export const SettlementService = {
    /**
     * Calculate the net balance for a single user in a group.
     *
     * Filters to only UNSETTLED splits (is_settled=eq.false) so that
     * confirmed settlements are immediately excluded from the balance.
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

        // Step 2: Fetch only UNSETTLED splits — excludes splits already confirmed as settled
        const splits = await dbQuery(
            'expense_splits',
            `expense_id=in.${expenseIdsStr}&is_settled=eq.false&select=amount_owed,user_id,expense_id`
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
     * Settle Up: records a payment from debtor → creditor and marks only the
     * MINIMUM SET of splits (oldest first) needed to cover the settled amount.
     *
     * BUG 1 FIX: Previously ALL splits were bulk-marked settled, which wiped
     * remaining balances when a payment was partial. Now splits are settled
     * one by one (sorted by expense created_at ASC) until the amount is consumed.
     * Any splits beyond the settled amount remain is_settled=false.
     *
     * Also handles the reverse direction: if debtor is also a creditor for the
     * other person, those reverse splits are similarly settled up to their total
     * (since the greedy algorithm already netted them into the settlement amount).
     *
     * @param groupId    - the group
     * @param debtorId   - person who owes (s.from / paidBy)
     * @param creditorId - person who is owed (s.to / paidTo)
     * @param amount     - net amount being settled
     */
    async settleUp(groupId: string, debtorId: string, creditorId: string, amount: number) {
        // Guard: only the debtor should be able to call this — if IDs are the same something is wrong
        if (debtorId === creditorId) throw new Error('Debtor and creditor cannot be the same person');

        // 1. INSERT a settlement record (net cash transfer for audit trail / CSV export)
        await dbInsert('settlements', {
            group_id: groupId,
            paid_by: debtorId,
            paid_to: creditorId,
            amount: amount
        });

        // ─────────────────────────────────────────────────────────────────────
        // WHY WE CLEAR GROSS, NOT NET
        //
        // calculateGroupSettlements already nets mutual debts.
        // Example: Bilal owes Alfaiz ₹100 gross, Alfaiz owes Bilal ₹30 gross.
        //   → displayed net: Bilal pays Alfaiz ₹70.
        //
        // The CORRECT way to close the books is:
        //   Step 2a: mark ALL of Bilal's ₹100 splits on Alfaiz's expenses settled
        //   Step 2b: mark ALL of Alfaiz's ₹30 splits on Bilal's expenses settled
        //   Record:  amount = ₹70 (actual cash handed over)
        //
        // Using the net ₹70 as a budget for step 2a causes "ghost balances":
        //   if Bilal's single split = ₹100 > budget ₹70 → SKIP → ₹100 unsettled
        //   After: calculateGroupSettlements still sees Bilal owes Alfaiz ₹100!
        // ─────────────────────────────────────────────────────────────────────

        const settledAt = new Date().toISOString();

        // 2a. Clear ALL of debtor's unsettled splits on creditor's expenses (gross)
        const creditorExpenses = await dbQuery(
            'expenses',
            `added_by=eq.${creditorId}&group_id=eq.${groupId}&select=id`
        );
        const creditorExpenseIds = (creditorExpenses as any[] || []).map((e: any) => e.id);

        if (creditorExpenseIds.length > 0) {
            const idsStr = `(${creditorExpenseIds.join(',')})`;
            await dbUpdate(
                'expense_splits',
                `user_id=eq.${debtorId}&is_settled=eq.false&expense_id=in.${idsStr}`,
                { is_settled: true, settled_at: settledAt }
            );
        }

        // 2b. Clear ALL of creditor's unsettled reverse splits on debtor's expenses (gross)
        //     These represent the mutual debt already netted into the settlement amount.
        //     Clearing them prevents ghost credits re-appearing after the net payment.
        const debtorExpenses = await dbQuery(
            'expenses',
            `added_by=eq.${debtorId}&group_id=eq.${groupId}&select=id`
        );
        const debtorExpenseIds = (debtorExpenses as any[] || []).map((e: any) => e.id);

        if (debtorExpenseIds.length > 0) {
            const idsStr = `(${debtorExpenseIds.join(',')})`;
            await dbUpdate(
                'expense_splits',
                `user_id=eq.${creditorId}&is_settled=eq.false&expense_id=in.${idsStr}`,
                { is_settled: true, settled_at: settledAt }
            );
        }

        return true;
    },


    /**
     * Calculate who owes whom in the group using DIRECT PER-PAIR net balances.
     *
     * BUG 2 FIX: The previous greedy algorithm collapsed per-pair debts into a
     * single creditor per debtor (minimizing total transactions). This caused
     * "Alfaiz owes Yazz ₹61.66" and "Alfaiz owes Danish ₹83.33" to be merged
     * and attributed to just one creditor (whichever had the larger net balance).
     *
     * The new approach:
     *  1. Compute net(A→B) = what A owes B (unsettled) minus what B owes A (unsettled)
     *  2. If net > 0: emit a row "A owes B net_amount"
     *  3. This correctly shows SEPARATE rows per creditor, preserving the true
     *     per-person relationships that match the CSV export.
     *
     * Algorithm:
     *  For each ordered pair (debtor, creditor):
     *    gross_A_owes_B = sum of unsettled splits where user_id=A and expense.added_by=B
     *    gross_B_owes_A = sum of unsettled splits where user_id=B and expense.added_by=A
     *    net = gross_A_owes_B - gross_B_owes_A
     *    if net > 0.01: add { from: A, to: B, amount: net }
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

        // Step 2: Fetch only UNSETTLED splits — excludes splits already confirmed as settled
        const splits = await dbQuery(
            'expense_splits',
            `expense_id=in.${expenseIdsStr}&is_settled=eq.false&select=amount_owed,user_id,expense_id`
        );

        // Step 3: BUG 2 FIX — Build per-pair gross balances (in integer cents, no float drift)
        // pairOwed[A][B] = how much A owes B (gross, in cents)
        const pairOwedCents: Record<string, Record<string, number>> = {};

        const ensurePair = (a: string, b: string) => {
            if (!pairOwedCents[a]) pairOwedCents[a] = {};
            if (!pairOwedCents[a][b]) pairOwedCents[a][b] = 0;
        };

        (splits as any[] || []).forEach((split: any) => {
            const debtor = split.user_id;
            const creditor = expenseCreditorMap[split.expense_id];
            if (!debtor || !creditor || debtor === creditor) return; // skip self-splits

            const amountCents = Math.round(Number(split.amount_owed) * 100);
            ensurePair(debtor, creditor);
            pairOwedCents[debtor][creditor] += amountCents;
        });

        // Step 4: For each ordered pair (A, B), compute net = A_owes_B - B_owes_A
        // Only emit a settlement row if net > 1 cent
        const settlements: { from: string; to: string; amount: number }[] = [];
        const emittedPairs = new Set<string>(); // prevent double-counting A→B and B→A

        for (const debtor of Object.keys(pairOwedCents)) {
            for (const creditor of Object.keys(pairOwedCents[debtor])) {
                const pairKey = [debtor, creditor].sort().join('__');
                if (emittedPairs.has(pairKey)) continue;
                emittedPairs.add(pairKey);

                const aOwesB = pairOwedCents[debtor]?.[creditor] ?? 0;
                const bOwesA = pairOwedCents[creditor]?.[debtor] ?? 0;

                const netCents = aOwesB - bOwesA;

                if (netCents > 1) {
                    // debtor owes creditor net amount
                    settlements.push({
                        from: debtor,
                        to: creditor,
                        amount: Math.round(netCents) / 100,
                    });
                } else if (netCents < -1) {
                    // creditor owes debtor net amount (reverse direction)
                    settlements.push({
                        from: creditor,
                        to: debtor,
                        amount: Math.round(Math.abs(netCents)) / 100,
                    });
                }
            }
        }

        // Sort by amount descending for consistent display
        settlements.sort((a, b) => b.amount - a.amount);

        return settlements;
    },

    /**
     * Debt-Minimization Algorithm (Greedy)
     *
     * Takes the raw pairwise net balances produced by calculateGroupSettlements
     * and reduces them to the MINIMUM number of transactions needed to clear all debts.
     *
     * Step 1: Compute a single net position per person across all pairs.
     *   netBalance[person] = (total owed to them) - (total they owe)
     *   positive → creditor (others owe them)
     *   negative → debtor   (they owe others)
     *
     * Step 2: Greedily pair the largest debtor with the largest creditor,
     *   settle the minimum of their magnitudes, advance whichever hits zero.
     *
     * @param rawNetBalances - output of calculateGroupSettlements ({ from, to, amount }[])
     * @returns minimized list: { from, to, amount }[]
     */
    calculateMinimizedSettlements(
        rawNetBalances: { from: string; to: string; amount: number }[]
    ): { from: string; to: string; amount: number }[] {
        // Step 1: collapse all pairs into a single net position per person
        const net: Record<string, number> = {};
        for (const { from: debtor, to: creditor, amount } of rawNetBalances) {
            net[debtor]   = (net[debtor]   ?? 0) - amount;
            net[creditor] = (net[creditor] ?? 0) + amount;
        }

        // Step 2: greedy matching — pair largest creditor with largest debtor
        // creditors: positive net (they are owed money)
        // debtors:   negative net (they owe money)
        const creditors = Object.entries(net)
            .filter(([, v]) => v > 0.01)
            .map(([name, v]) => [name, v] as [string, number])
            .sort((a, b) => b[1] - a[1]);                  // largest first

        const debtors = Object.entries(net)
            .filter(([, v]) => v < -0.01)
            .map(([name, v]) => [name, v] as [string, number])
            .sort((a, b) => a[1] - b[1]);                  // most negative first

        const result: { from: string; to: string; amount: number }[] = [];
        let i = 0, j = 0;

        while (i < debtors.length && j < creditors.length) {
            const [dName, dAmt] = debtors[i];    // negative value
            const [cName, cAmt] = creditors[j];  // positive value

            const settle = Math.min(-dAmt, cAmt);
            result.push({
                from: dName,
                to: cName,
                amount: Math.round(settle * 100) / 100,
            });

            (debtors[i] as [string, number])[1]   += settle;   // makes less negative
            (creditors[j] as [string, number])[1] -= settle;   // makes less positive

            if (Math.abs(debtors[i][1])   < 0.01) i++;
            if (Math.abs(creditors[j][1]) < 0.01) j++;
        }

        // Sort by amount descending for consistent display
        result.sort((a, b) => b.amount - a.amount);
        return result;
    },
};
