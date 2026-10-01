/** A fixed calendar avoids different monthly totals on devices in different time zones. */
export function expenseMonth(date: string | Date) {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) return '';
  return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
}

export function monthlySummary(
  expenses: Array<{ amount: string | number; created_at?: string; expense_splits?: Array<{ user_id: string; amount_owed?: string | number }> }>,
  userId: string,
  month: string,
) {
  let totalCents = 0;
  let shareCents = 0;
  for (const expense of expenses) {
    if (!expense.created_at || expenseMonth(expense.created_at) !== month) continue;
    totalCents += Math.round(Number(expense.amount) * 100);
    for (const split of expense.expense_splits ?? []) {
      if (split.user_id === userId) shareCents += Math.round(Number(split.amount_owed ?? 0) * 100);
    }
  }
  return { total: totalCents / 100, share: shareCents / 100 };
}
