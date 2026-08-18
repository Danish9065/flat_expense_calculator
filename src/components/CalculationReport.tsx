import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  Download,
  Loader2,
  ReceiptText,
  Scale,
  ShieldCheck,
  X,
} from 'lucide-react';
import { CalculationExplanation, SettlementService } from '../services/settlementService';

interface ReportMember {
  user_id: string;
  users?: { full_name?: string };
}

interface CalculationReportProps {
  groupId: string;
  groupName: string;
  category: string;
  members: ReportMember[];
  fallbackUsers: Record<string, { full_name?: string }>;
  onClose: () => void;
}

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

const money = (value: number | string) => currency.format(Number(value) || 0);

export default function CalculationReport({
  groupId,
  groupName,
  category,
  members,
  fallbackUsers,
  onClose,
}: CalculationReportProps) {
  const [report, setReport] = useState<CalculationExplanation | null>(null);
  const [loadError, setLoadError] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    SettlementService.getCalculationExplanation(groupId, category)
      .then((data) => {
        if (active) setReport(data);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Could not build the report');
      });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      active = false;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [category, groupId, onClose]);

  const names = useMemo(() => {
    const result = new Map<string, string>();
    members.forEach((member) => {
      if (member.users?.full_name) result.set(member.user_id, member.users.full_name);
    });
    Object.entries(fallbackUsers).forEach(([id, profile]) => {
      if (profile.full_name && !result.has(id)) result.set(id, `${profile.full_name} (removed)`);
    });
    return result;
  }, [fallbackUsers, members]);

  const getName = (id: string) => names.get(id) || `Member ${id.slice(0, 6)}`;
  const splitsByExpense = useMemo(() => {
    const result = new Map<string, CalculationExplanation['splits']>();
    report?.splits.forEach((split) => {
      const rows = result.get(split.expense_id) || [];
      rows.push(split);
      result.set(split.expense_id, rows);
    });
    return result;
  }, [report]);
  const maxPaid = Math.max(1, ...(report?.memberRows.map((row) => row.paid) || [1]));
  const isVerified = report
    ? Math.abs(report.totals.balanceChecksum) < 0.01 && Math.abs(report.totals.splitDifference) < 0.01
    : false;

  const handlePrint = () => {
    const originalTitle = document.title;
    const restoreTitle = () => {
      document.title = originalTitle;
    };
    document.title = `${groupName || 'Flat'} - payment calculation`;
    window.addEventListener('afterprint', restoreTitle, { once: true });
    window.print();
    window.setTimeout(restoreTitle, 60_000);
  };

  return (
    <div className="calculation-report-overlay fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm md:p-5" role="dialog" aria-modal="true" aria-labelledby="calculation-report-title">
      <div className="h-full overflow-y-auto bg-[#f5f2ea] text-[#17221d] md:mx-auto md:max-w-5xl md:rounded-[28px] md:shadow-2xl">
        <div className="calculation-report-toolbar sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/10 bg-[#f5f2ea]/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#66736c]">Transparent calculation</p>
            <p className="truncate text-sm font-bold text-[#17221d]">{groupName || 'Current group'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={handlePrint} disabled={!report} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#173f33] px-3.5 text-xs font-bold text-white disabled:opacity-40 sm:px-5">
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Print / Save PDF</span>
              <span className="sm:hidden">PDF</span>
            </button>
            <button ref={closeButtonRef} onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full border border-black/10 bg-white focus:outline-none focus:ring-2 focus:ring-[#c45735]" aria-label="Close calculation report">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <main id="calculation-report" className="calculation-report mx-auto max-w-4xl px-4 py-8 sm:px-8 md:px-12 md:py-12">
          {!report && !loadError ? (
            <div className="grid min-h-[60vh] place-items-center text-center">
              <div><Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-[#c45735]" /><p className="font-semibold">Building the calculation trail...</p></div>
            </div>
          ) : loadError ? (
            <div className="grid min-h-[60vh] place-items-center text-center">
              <div className="max-w-md rounded-3xl border border-red-200 bg-red-50 p-6">
                <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-600" />
                <h2 className="text-lg font-bold">Report unavailable</h2>
                <p className="mt-2 text-sm text-red-800">{loadError}</p>
              </div>
            </div>
          ) : report ? (
            <>
              <header className="border-b-2 border-[#173f33] pb-8">
                <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#dce8df] px-3 py-1.5 text-xs font-bold text-[#173f33]">
                  <ReceiptText className="h-4 w-4" /> Payment calculation report
                </div>
                <h1 id="calculation-report-title" className="max-w-3xl text-4xl font-black leading-[1.05] tracking-[-0.04em] sm:text-5xl">
                  Where every rupee went, explained simply.
                </h1>
                <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-[#59665f]">
                  <span><strong className="text-[#17221d]">Group:</strong> {groupName || 'Current group'}</span>
                  <span><strong className="text-[#17221d]">View:</strong> {category === 'All' ? 'All categories' : category}</span>
                  <span><strong className="text-[#17221d]">Created:</strong> {new Date(report.generatedAt).toLocaleString()}</span>
                </div>
              </header>

              <section className="report-section py-8">
                <div className={`flex flex-col gap-4 rounded-3xl border p-5 sm:flex-row sm:items-center ${isVerified ? 'border-[#a9c8b1] bg-[#e5f0e7]' : 'border-amber-300 bg-amber-50'}`}>
                  <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${isVerified ? 'bg-[#173f33] text-white' : 'bg-amber-500 text-white'}`}>
                    {isVerified ? <ShieldCheck className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
                  </div>
                  <div>
                    <h2 className="text-lg font-black">{isVerified ? 'The ledger balances correctly' : 'This ledger needs attention'}</h2>
                    <p className="mt-1 text-sm leading-6 text-[#59665f]">
                      {isVerified
                        ? `Expenses and assigned shares match, and all member balances add back to ${money(0)}.`
                        : `Expenses differ from assigned shares by ${money(report.totals.splitDifference)}. Review the detailed rows below.`}
                    </p>
                  </div>
                </div>
              </section>

              <section className="report-section pb-10">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    ['Total spent', money(report.totals.expenses)],
                    ['Expenses', String(report.expenses.length)],
                    ['People in ledger', String(report.memberRows.length)],
                    ['Payments recorded', money(report.totals.priorPayments)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#718078]">{label}</p>
                      <p className="mt-2 text-xl font-black sm:text-2xl">{value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="report-section border-t border-black/10 py-10">
                <div className="mb-6 flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f1d8ca] text-[#9c3f24]"><Calculator className="h-5 w-5" /></div>
                  <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9c3f24]">Step 1</p><h2 className="text-2xl font-black">The one formula used for everyone</h2></div>
                </div>
                <div className="rounded-3xl bg-[#17221d] p-5 text-white sm:p-7">
                  <div className="grid gap-3 text-center text-sm font-bold sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-center">
                    <span className="rounded-xl bg-white/10 px-3 py-3">Amount paid</span><span className="text-xl text-[#f4a47d]">-</span>
                    <span className="rounded-xl bg-white/10 px-3 py-3">Assigned share</span><span className="text-xl text-[#f4a47d]">+</span>
                    <span className="rounded-xl bg-white/10 px-3 py-3">Payments made</span><span className="text-xl text-[#f4a47d]">-</span>
                    <span className="rounded-xl bg-white/10 px-3 py-3">Payments received</span>
                  </div>
                  <p className="mt-5 text-sm leading-6 text-white/70">A positive result means the person should receive money. A negative result means the person still owes money.</p>
                </div>
              </section>

              <section className="report-section border-t border-black/10 py-10">
                <div className="mb-6"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9c3f24]">Step 2</p><h2 className="text-2xl font-black">Who paid the bills</h2><p className="mt-2 text-sm text-[#66736c]">Longer bars mean that person paid more cash toward group expenses.</p></div>
                <div className="space-y-4">
                  {report.memberRows.map((row) => (
                    <div key={row.userId} className="grid grid-cols-[minmax(80px,0.7fr)_minmax(120px,2fr)_auto] items-center gap-3 text-sm">
                      <span className="truncate font-bold">{getName(row.userId)}</span>
                      <div className="h-3 overflow-hidden rounded-full bg-black/10"><div className="h-full rounded-full bg-[#c45735]" style={{ width: `${Math.max(row.paid > 0 ? 3 : 0, (row.paid / maxPaid) * 100)}%` }} /></div>
                      <span className="font-mono text-xs font-bold">{money(row.paid)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="report-section border-t border-black/10 py-10">
                <div className="mb-6"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9c3f24]">Step 3</p><h2 className="text-2xl font-black">Each person's ledger</h2><p className="mt-2 text-sm text-[#66736c]">These columns show the exact values placed into the formula above.</p></div>
                <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white">
                  <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                    <thead className="bg-[#e7e5dc] text-[10px] uppercase tracking-wider text-[#59665f]"><tr><th className="p-3">Person</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Share</th><th className="p-3 text-right">Paid back</th><th className="p-3 text-right">Received</th><th className="p-3 text-right">Net result</th></tr></thead>
                    <tbody>{report.memberRows.map((row) => <tr key={row.userId} className="border-t border-black/10"><td className="p-3 font-bold">{getName(row.userId)}</td><td className="p-3 text-right">{money(row.paid)}</td><td className="p-3 text-right">{money(row.assignedShare)}</td><td className="p-3 text-right">{money(row.paymentsMade)}</td><td className="p-3 text-right">{money(row.paymentsReceived)}</td><td className={`p-3 text-right font-black ${row.netBalance >= 0 ? 'text-[#1f704c]' : 'text-[#b3412d]'}`}>{row.netBalance >= 0 ? '+' : ''}{money(row.netBalance)}</td></tr>)}</tbody>
                  </table>
                </div>
              </section>

              <section className="report-section border-t border-black/10 py-10">
                <div className="mb-6 flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#dce8df] text-[#173f33]"><Scale className="h-5 w-5" /></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1f704c]">Step 4</p><h2 className="text-2xl font-black">The shortest way to settle</h2><p className="mt-2 text-sm text-[#66736c]">The app matches the largest amount owed with the largest amount due until every balance reaches zero.</p></div></div>
                {report.suggestedPayments.length > 0 ? <div className="grid gap-3 sm:grid-cols-2">{report.suggestedPayments.map((payment, index) => <div key={`${payment.from}-${payment.to}-${index}`} className="rounded-2xl border border-black/10 bg-white p-4"><div className="flex items-center gap-3"><span className="min-w-0 flex-1 truncate font-bold">{getName(payment.from)}</span><ArrowRight className="h-5 w-5 shrink-0 text-[#c45735]" /><span className="min-w-0 flex-1 truncate text-right font-bold">{getName(payment.to)}</span></div><p className="mt-3 text-center text-2xl font-black text-[#173f33]">{money(payment.amount)}</p></div>)}</div> : <div className="rounded-2xl bg-[#e5f0e7] p-5 text-center font-bold text-[#173f33]">Nothing is owed. Everyone is settled up.</div>}
              </section>

              <section className="report-section border-t border-black/10 py-10">
                <div className="mb-6"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9c3f24]">Audit details</p><h2 className="text-2xl font-black">Every expense and assigned share</h2><p className="mt-2 text-sm text-[#66736c]">Rounding is already stored in paise. When an amount cannot split evenly, the payer carries the leftover paise.</p></div>
                <div className="space-y-3">{report.expenses.map((expense) => {
                  const expenseSplits = splitsByExpense.get(expense.id) || [];
                  return <details key={expense.id} className="rounded-2xl border border-black/10 bg-white p-4 open:shadow-sm"><summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="truncate font-black">{expense.item_name || 'Expense'}</p><p className="mt-1 text-xs text-[#718078]">Paid by {getName(expense.added_by)} · {expense.category || 'General'}</p></div><span className="shrink-0 text-lg font-black">{money(expense.amount)}</span></div></summary><div className="mt-4 border-t border-black/10 pt-3"><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#718078]">Assigned shares</p><div className="grid gap-2 sm:grid-cols-2">{expenseSplits.map((split) => <div key={split.user_id} className="flex justify-between gap-3 rounded-lg bg-[#f5f2ea] px-3 py-2 text-sm"><span className="truncate">{getName(split.user_id)}</span><strong>{money(split.amount_owed)}</strong></div>)}</div></div></details>;
                })}{report.expenses.length === 0 ? <p className="rounded-2xl bg-white p-5 text-center text-[#66736c]">No expenses are included in this view.</p> : null}</div>
              </section>

              <section className="report-section border-t border-black/10 py-10">
                <div className="mb-6"><h2 className="text-2xl font-black">Payments already recorded</h2><p className="mt-2 text-sm text-[#66736c]">These payments reduce what the payer owes and reduce what the receiver is due. Existing calculation logic applies them to every category view.</p></div>
                {report.priorPayments.length > 0 ? <div className="space-y-2">{report.priorPayments.map((payment, index) => <div key={`${payment.paid_by}-${payment.paid_to}-${index}`} className="flex flex-col gap-2 rounded-xl bg-white p-3 text-sm sm:flex-row sm:items-center"><span className="font-bold">{getName(payment.paid_by)}</span><span className="text-[#718078]">paid</span><span className="font-bold">{getName(payment.paid_to)}</span><strong className="sm:ml-auto">{money(payment.amount)}</strong></div>)}</div> : <p className="rounded-2xl bg-white p-5 text-center text-[#66736c]">No previous settlement payments have been recorded.</p>}
              </section>

              <footer className="report-section border-t-2 border-[#173f33] py-8 text-xs leading-5 text-[#66736c]">
                This is a read-only explanation generated from the group's saved expenses, assigned shares, and settlement payments. It does not alter any calculation or payment record.
              </footer>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
