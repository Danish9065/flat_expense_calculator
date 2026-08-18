import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ChevronDown, Layers3, Loader2, ReceiptText, RefreshCw, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import { useToast } from '../context/ToastContext';
import { dbQuery } from '../lib/db';
import { aggregateUserPayments, type ConsolidatedPayment, type GroupSettlementSource } from '../lib/paymentAggregation';
import { SettlementService } from '../services/settlementService';
import PaymentActions from '../components/PaymentActions';
import { notifyGroupDataChanged } from '../hooks/useRealtimeSync';

const Balance = lazy(() => import('./Balance'));

interface GroupSummary {
  id: string;
  name?: string;
}

interface ProfileSummary {
  id: string;
  full_name?: string;
  whatsapp_number?: string | null;
  upi_id?: string | null;
}

export default function PaymentCenter() {
  const { user } = useAuth();
  const { groups } = useGroup();
  const { success, error: showError } = useToast();
  const [view, setView] = useState<'all' | 'group'>('all');
  const [payments, setPayments] = useState<ConsolidatedPayment[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileSummary>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [recordingKey, setRecordingKey] = useState<string | null>(null);

  const groupList = useMemo(() => (groups || []) as GroupSummary[], [groups]);

  const loadAllPayments = useCallback(async (silent = false) => {
    if (!user) return;
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const sources = await Promise.all(groupList.map(async (group): Promise<GroupSettlementSource> => ({
        groupId: group.id,
        groupName: group.name || 'Unnamed group',
        settlements: await SettlementService.calculateGroupSettlements(group.id),
      })));
      const consolidated = aggregateUserPayments(sources, user.id);
      const profileIds = Array.from(new Set([user.id, ...consolidated.map((payment) => payment.counterpartyId)]));

      const [userRows, paymentRows] = profileIds.length > 0
        ? await Promise.all([
            dbQuery('users', `id=in.(${profileIds.join(',')})&select=id,full_name`),
            dbQuery('user_payment_profiles', `user_id=in.(${profileIds.join(',')})&select=user_id,whatsapp_number,upi_id`).catch(() => []),
          ])
        : [[], []];

      const paymentByUser = new Map(
        ((paymentRows || []) as unknown as Array<{ user_id: string; whatsapp_number?: string | null; upi_id?: string | null }>)
          .map((profile) => [profile.user_id, profile]),
      );
      const profileMap: Record<string, ProfileSummary> = {};
      for (const row of (userRows || []) as unknown as Array<{ id: string; full_name?: string }>) {
        profileMap[row.id] = { ...row, ...paymentByUser.get(row.id) };
      }

      setProfiles(profileMap);
      setPayments(consolidated);
    } catch (error) {
      console.error('Failed to load all-group payments', error);
      showError('Could not load all group payments. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupList, showError, user]);

  useEffect(() => {
    if (view === 'all') void loadAllPayments();
  }, [loadAllPayments, view]);

  useEffect(() => {
    const refresh = () => void loadAllPayments(true);
    window.addEventListener('settle-complete', refresh);
    return () => window.removeEventListener('settle-complete', refresh);
  }, [loadAllPayments]);

  const totals = useMemo(() => payments.reduce((result, payment) => {
    if (payment.direction === 'pay') result.toPay += payment.total;
    else result.toReceive += payment.total;
    return result;
  }, { toPay: 0, toReceive: 0 }), [payments]);

  const confirmAllReceived = async (payment: ConsolidatedPayment) => {
    if (payment.direction !== 'receive' || recordingKey) return;
    setRecordingKey(payment.key);
    try {
      await SettlementService.settleMultiple(payment.allocations);
      await Promise.all(Array.from(new Set(payment.allocations.map((allocation) => allocation.groupId))).map(notifyGroupDataChanged));
      window.dispatchEvent(new CustomEvent('settle-complete'));
      success(`Recorded ₹${payment.total.toFixed(2)} across ${payment.allocations.length} group${payment.allocations.length === 1 ? '' : 's'}.`);
      setConfirmingKey(null);
      await loadAllPayments(true);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not record the combined payment');
    } finally {
      setRecordingKey(null);
    }
  };

  return (
    <div className="app-section min-h-screen pb-28">
      <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="app-label mb-3">Everything in one place</p>
          <h1 className="app-title">Payment Center</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">See what you owe and what you should receive across every group, with each amount traceable to its source.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadAllPayments(true)}
          disabled={refreshing || view !== 'all'}
          className="ghost-button inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold sm:w-auto"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1" role="tablist" aria-label="Payment views">
        <button type="button" role="tab" aria-selected={view === 'all'} onClick={() => setView('all')} className={`min-h-11 rounded-xl px-3 text-sm font-bold transition-colors ${view === 'all' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-white'}`}>All groups</button>
        <button type="button" role="tab" aria-selected={view === 'group'} onClick={() => setView('group')} className={`min-h-11 rounded-xl px-3 text-sm font-bold transition-colors ${view === 'group' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-white'}`}>Group details</button>
      </div>

      {view === 'group' ? (
        <Suspense fallback={<div className="grid min-h-64 place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}><Balance embedded /></Suspense>
      ) : loading ? (
        <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="app-panel p-5"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-300"><ArrowUpRight className="h-4 w-4" /> You need to pay</div><p className="mt-3 text-3xl font-black text-white">₹{totals.toPay.toFixed(2)}</p></div>
            <div className="app-panel p-5"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300"><ArrowDownLeft className="h-4 w-4" /> You will receive</div><p className="mt-3 text-3xl font-black text-white">₹{totals.toReceive.toFixed(2)}</p></div>
            <div className="app-panel p-5"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary"><Layers3 className="h-4 w-4" /> Across groups</div><p className="mt-3 text-3xl font-black text-white">{groupList.length}</p></div>
          </div>

          <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/[0.06] p-4 text-sm leading-relaxed text-muted-foreground">
            <strong className="text-white">One payment per person.</strong> Amounts owed to the same person are combined across groups. Different recipients require separate UPI transactions because each UPI payment has one payee.
          </div>

          {payments.length === 0 ? (
            <div className="app-panel border-dashed py-14 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-success" /><h2 className="mt-3 text-lg font-bold text-white">All groups are settled</h2><p className="mt-1 text-sm text-muted-foreground">There are no payments involving you right now.</p></div>
          ) : (
            <div className="space-y-4">
              {payments.map((payment) => {
                const profile = profiles[payment.counterpartyId];
                const ownProfile = user ? profiles[user.id] : undefined;
                const name = profile?.full_name || 'Group member';
                const isPaying = payment.direction === 'pay';
                const isConfirming = confirmingKey === payment.key;
                const isRecording = recordingKey === payment.key;

                return (
                  <article key={payment.key} className={`rounded-2xl border bg-card p-4 shadow-sm sm:p-5 ${isPaying ? 'border-rose-400/30' : 'border-emerald-400/30'}`}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className={`text-xs font-bold uppercase tracking-wider ${isPaying ? 'text-rose-300' : 'text-emerald-300'}`}>{isPaying ? `Pay ${name}` : `Receive from ${name}`}</p>
                        <p className="mt-2 text-3xl font-black text-white">₹{payment.total.toFixed(2)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Combined from {payment.allocations.length} group{payment.allocations.length === 1 ? '' : 's'}</p>
                      </div>
                      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${isPaying ? 'bg-rose-400/10 text-rose-300' : 'bg-emerald-400/10 text-emerald-300'}`}>{isPaying ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}</div>
                    </div>

                    <details className="mt-4 rounded-xl bg-white/[0.035] p-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-bold text-white"><span className="inline-flex items-center gap-2"><ReceiptText className="h-4 w-4 text-primary" />See group calculation</span><ChevronDown className="h-4 w-4 text-muted-foreground" /></summary>
                      <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                        {payment.allocations.map((allocation) => <div key={`${allocation.groupId}:${allocation.debtorId}:${allocation.creditorId}`} className="flex items-center justify-between gap-3 text-sm"><span className="inline-flex min-w-0 items-center gap-2 text-muted-foreground"><Users className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{allocation.groupName}</span></span><strong className="shrink-0 text-white">₹{allocation.amount.toFixed(2)}</strong></div>)}
                        <div className="flex items-center justify-between border-t border-white/10 pt-2 text-sm"><span className="font-bold text-white">Combined total</span><strong className="text-primary">₹{payment.total.toFixed(2)}</strong></div>
                      </div>
                    </details>

                    <PaymentActions
                      amount={payment.total}
                      groupName={`${payment.allocations.length} SplitMate group${payment.allocations.length === 1 ? '' : 's'}`}
                      debtorName={isPaying ? 'You' : name}
                      debtorWhatsApp={isPaying ? ownProfile?.whatsapp_number : profile?.whatsapp_number}
                      creditorName={isPaying ? name : 'You'}
                      creditorUpiId={isPaying ? profile?.upi_id : ownProfile?.upi_id}
                      isDebtor={isPaying}
                      isCreditor={!isPaying}
                      payLabel={`Pay all ₹${payment.total.toFixed(2)}`}
                      reminderLabel={`Remind ${name}`}
                      onInfo={success}
                      onError={showError}
                    />

                    {!isPaying ? (
                      <div className="mt-3">
                        {isConfirming ? (
                          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
                            <p className="text-xs leading-relaxed text-emerald-100">Confirm only after ₹{payment.total.toFixed(2)} has reached you. This records one settlement in each listed group.</p>
                            <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setConfirmingKey(null)} disabled={isRecording} className="ghost-button min-h-11 rounded-xl text-xs font-bold">Cancel</button><button type="button" onClick={() => void confirmAllReceived(payment)} disabled={isRecording} className="accent-button inline-flex min-h-11 items-center justify-center gap-2 rounded-xl text-xs font-bold">{isRecording ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Confirm all</button></div>
                          </div>
                        ) : <button type="button" onClick={() => setConfirmingKey(payment.key)} className="ghost-button min-h-11 w-full rounded-xl text-xs font-bold">Confirm combined payment received</button>}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
