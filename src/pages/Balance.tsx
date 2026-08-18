import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { dbQuery } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import { SettlementService } from '../services/settlementService';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { ArrowRight, Loader2, CheckCircle2, Handshake, BarChart3, RefreshCw, FileSearch } from 'lucide-react';
import { CATEGORY_MAP } from '../constants/categories';
import { useToast } from '../context/ToastContext';
import { useRealtimeSync, notifyGroupDataChanged } from '../hooks/useRealtimeSync';
import PaymentActions from '../components/PaymentActions';

const CalculationReport = lazy(() => import('../components/CalculationReport'));

// Colors for the donut chart
const COLORS = ['#6C63FF', '#22C55E', '#F59E0B', '#EF4444', '#06b6d4', '#8b5cf6', '#ec4899'];

interface GroupMemberRow {
    user_id: string;
    users?: {
        full_name?: string;
        avatar_url?: string;
        whatsapp_number?: string | null;
        upi_id?: string | null;
    };
}

interface ExpenseChartRow {
    added_by: string;
    amount: string | number;
    category: string;
}

interface ChartDatum {
    name: string;
    value: number;
    color: string;
}

interface SettlementRow {
    from: string;
    to: string;
    amount: number;
}

export default function Balance() {
    const { user } = useAuth();
    const { groupId, groupName, members } = useGroup();
    const { success, error: showError } = useToast();

    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [settling, setSettling] = useState<string | null>(null);
    const [category, setCategory] = useState<string>('All');
    // Partial payment state
    const [settlingCard, setSettlingCard] = useState<string | null>(null); // `${from}__${to}`
    const [partialAmount, setPartialAmount] = useState<string>('');
    const [showCalculationReport, setShowCalculationReport] = useState(false);

    const [chartData, setChartData] = useState<ChartDatum[]>([]);
    const [categoryTotals, setCategoryTotals] = useState<Record<string, number>>({});
    const [settlements, setSettlements] = useState<SettlementRow[]>([]);
    const [minimizedSettlements, setMinimizedSettlements] = useState<SettlementRow[]>([]);
    const [fallbackUsers, setFallbackUsers] = useState<Record<string, { full_name?: string }>>({});

    const fetchBalanceData = useCallback(async (silent = false) => {
        if (!groupId) { setLoading(false); return; }

        if (silent) {
            setIsRefreshing(true);
        } else {
            setLoading(true);
        }

        try {
            // 1. Chart Data: "Who paid what" total
            let expQuery = `group_id=eq.${groupId}&select=added_by,amount,category`;
            if (category !== 'All') expQuery += `&category=eq.${category}`;
            const expenses = await dbQuery('expenses', expQuery);

            const userTotals: Record<string, number> = {};
            const catTotals: Record<string, number> = {};

            if (expenses) {
                (expenses as ExpenseChartRow[]).forEach((e) => {
                    userTotals[e.added_by] = (userTotals[e.added_by] || 0) + Number(e.amount);
                    catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount);
                });
            }

            // 2. Settlement Data: "How to settle up"
            const calcSettlements = await SettlementService.calculateGroupSettlements(groupId, members, category);

            // 3. Fallback users for removed members
            const missingIds = new Set<string>();
            Object.keys(userTotals).forEach(id => {
                if (!members.find(m => m.user_id === id)) missingIds.add(id);
            });
            calcSettlements.forEach(s => {
                if (!members.find(m => m.user_id === s.from)) missingIds.add(s.from);
                if (!members.find(m => m.user_id === s.to)) missingIds.add(s.to);
            });

            const fMap: Record<string, { full_name?: string }> = {};
            if (missingIds.size > 0) {
                const idsArray = Array.from(missingIds);
                const missingUsersData = await dbQuery('users', `id=in.(${idsArray.join(',')})&select=id,full_name`);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (missingUsersData as any[])?.forEach(u => fMap[u.id] = u);
                setFallbackUsers(fMap);
            } else {
                setFallbackUsers({});
            }

            const allIds = Array.from(new Set([...members.map(m => m.user_id), ...Object.keys(userTotals)]));
            const cData = allIds.map((id, index) => {
                const active = members.find(m => m.user_id === id);
                let name = 'Member';
                if (active?.users?.full_name) {
                    name = active.users.full_name.split(' ')[0];
                } else if (fMap[id]?.full_name) {
                    name = fMap[id].full_name.split(' ')[0] + ' (Removed)';
                }
                
                return {
                    name,
                    value: userTotals[id] || 0,
                    color: COLORS[index % COLORS.length]
                };
            }).filter((d) => d.value > 0);

            setChartData(cData);
            setCategoryTotals(catTotals);
            setSettlements(calcSettlements);
            setMinimizedSettlements(calcSettlements);

        } catch (err) {
            console.error('Failed to load balance data', err);
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    }, [groupId, members, category]);

    // Fix 4: re-fetch on group/category switch
    useEffect(() => {
        fetchBalanceData();
    }, [fetchBalanceData]);

    // Fix 1: InsForge Realtime — silent re-fetch when any group member writes data
    useRealtimeSync(groupId, () => fetchBalanceData(true));

    /**
     * Open the inline partial-payment modal for a given debt pair.
     * Only the creditor (s.to) may initiate — same guard as before.
     */
    const openSettleModal = (from: string, to: string, fullAmount: number) => {
        if (!user || user.id !== to) return;
        const key = `${from}__${to}`;
        setSettlingCard(key);
        setPartialAmount(fullAmount.toFixed(2));
    };

    /**
     * Confirm the partial (or full) payment entered by the creditor.
     * Routes to settleUpPartial() for partial, settleUp() for full.
     */
    const handleSettleUp = async (from: string, to: string, enteredAmount: number, fullAmount: number) => {
        if (!groupId || !user) return;
        if (user.id !== to) return;

        const key = `${from}__${to}`;
        if (settling === key) return;
        setSettling(key);

        try {
            const isPartial = enteredAmount < fullAmount - 0.009; // >1 cent difference = partial
            if (isPartial) {
                await SettlementService.settleUpPartial(groupId, from, to, Math.round(enteredAmount * 100));
                success(`Partial payment of ₹${enteredAmount.toFixed(2)} recorded!`);
            } else {
                await SettlementService.settleUp(groupId, from, to, fullAmount);
                success('Settlement recorded successfully!');
            }
            setSettlingCard(null);
            setPartialAmount('');
            // Fix 2: optimistic re-fetch already happened — now notify others
            if (groupId) await notifyGroupDataChanged(groupId);
            window.dispatchEvent(new CustomEvent('settle-complete'));
            await fetchBalanceData();
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Failed to settle up');
        } finally {
            setSettling(null);
        }
    };

    /**
     * Render the inline partial-payment modal that replaces the Settle button row.
     */
    const renderSettleModal = (from: string, to: string, fullAmount: number) => {
        const key = `${from}__${to}`;
        const enteredNum = parseFloat(partialAmount) || 0;
        const remaining = Math.max(0, fullAmount - enteredNum);
        const isSettlingNow = settling === key;
        const isFullPayment = enteredNum >= fullAmount - 0.009;
        const isValid = enteredNum >= 1 && enteredNum <= fullAmount + 0.001;

        const hint = isFullPayment
            ? 'Full settlement — balance cleared ✅'
            : enteredNum > 0
            ? `Partial payment — remaining ₹${remaining.toFixed(2)} will stay on balance`
            : '';

        return (
            <div className="mt-3 pt-3 border-t border-[#1E1E1E]">
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Total owed: <span className="text-white font-bold">₹{fullAmount.toFixed(2)}</span>
                </p>
                <div className="flex items-center space-x-2 mb-2">
                    <span className="text-sm font-medium text-muted-foreground shrink-0">Paying:</span>
                    <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary font-bold text-sm">₹</span>
                        <input
                            id={`partial-input-${key}`}
                            type="number"
                            min="1"
                            max={fullAmount}
                            step="0.01"
                            value={partialAmount}
                            onChange={(e) => {
                                const val = e.target.value;
                                // Allow max 2 decimal places
                                if (/^\d*\.?\d{0,2}$/.test(val) || val === '') {
                                    setPartialAmount(val);
                                }
                            }}
                            className="dark-input pl-7 pr-3 py-2 rounded-lg text-sm font-semibold"
                            disabled={isSettlingNow}
                        />
                    </div>
                </div>
                {hint && (
                    <p className={`text-[11px] mb-2 leading-tight ${
                        isFullPayment
                        ? 'text-green-300 font-semibold'
                            : 'text-amber-300'
                    }`}>
                        {hint}
                    </p>
                )}
                <div className="flex items-center space-x-2">
                    <button
                        id={`cancel-settle-${key}`}
                        onClick={() => { setSettlingCard(null); setPartialAmount(''); }}
                        disabled={isSettlingNow}
                        className="ghost-button flex-1 py-2 text-xs font-bold rounded-lg"
                    >
                        Cancel
                    </button>
                    <button
                        id={`confirm-settle-${key}`}
                        onClick={() => handleSettleUp(from, to, enteredNum, fullAmount)}
                        disabled={isSettlingNow || !isValid}
                        className="accent-button flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center space-x-1"
                    >
                        {isSettlingNow
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Processing...</span></>
                            : <span>Confirm Payment</span>
                        }
                    </button>
                </div>
            </div>
        );
    };

    const getMemberName = (id: string) => {
        const active = (members as GroupMemberRow[]).find((m) => m.user_id === id);
        if (active?.users?.full_name) return active.users.full_name;
        if (fallbackUsers[id]?.full_name) return `${fallbackUsers[id].full_name} (Removed)`;
        return 'Unknown User (Removed)';
    };

    const getMemberAvatar = (id: string) => {
        const url = (members as GroupMemberRow[]).find((m) => m.user_id === id)?.users?.avatar_url;
        if (url) return url;
        // fallback avatar based on name
        const name = getMemberName(id);
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
    };

    const getMemberProfile = (id: string) =>
        (members as GroupMemberRow[]).find((member) => member.user_id === id)?.users;

    const closeCalculationReport = useCallback(() => setShowCalculationReport(false), []);

    if (loading) {
        return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
    }

    if (!groupId) return (
        <div className="text-center py-20 px-4">
            <h2 className="text-xl font-bold text-white">No Balances</h2>
            <p className="text-muted-foreground mt-2">Join a group first to see your balance</p>
        </div>
    );

    return (
        <div className="app-section pb-28 min-h-screen">
            <div className="mb-8 flex flex-col items-center justify-between gap-5 text-center sm:flex-row sm:text-left">
                <div>
                    <p className="app-label mb-3">Group settlement calculator</p>
                    <h1 className="app-title">Balances</h1>
                </div>
                <button
                    id="open-calculation-report"
                    onClick={() => setShowCalculationReport(true)}
                    className="ghost-button inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold sm:w-auto"
                >
                    <FileSearch className="h-4 w-4 text-primary" />
                    Explain this calculation
                </button>
                {isRefreshing && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground animate-pulse sm:absolute sm:right-4 sm:top-24">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Updating...
                    </span>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 app-panel overflow-hidden mb-8">
            <div className="bg-card p-6 lg:p-8 border-b lg:border-b-0 lg:border-r border-[#1E1E1E]">
                <h2 className="text-lg font-bold text-white mb-2">Who paid what</h2>
                {chartData.length > 0 ? (
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(value: number | undefined) => `₹${(value ?? 0).toFixed(0)}`}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="h-48 flex items-center justify-center text-muted-foreground">
                        No expenses yet
                    </div>
                )}
            </div>

            {/* Category Breakdown */}
            <div className="p-6 lg:p-8">
                <h2 className="app-label mb-4">Category Breakdown</h2>
                <div className="grid grid-cols-2 gap-3">
                    {Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).map(([cat, total]) => {
                        const mapEntry = CATEGORY_MAP[cat] || CATEGORY_MAP['General'];
                        const Icon = mapEntry.icon;
                        return (
                            <div key={cat} className="app-panel-muted p-3 flex items-center space-x-3">
                                <div className={`p-2 rounded-xl ${mapEntry.colorClass}`}>
                                    <Icon className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{cat}</p>
                                    <p className="font-extrabold text-white">₹{total.toFixed(0)}</p>
                                </div>
                            </div>
                        );
                    })}
                    {Object.keys(categoryTotals).length === 0 && (
                        <p className="text-xs text-muted-foreground col-span-2 italic">Reflects applied filters above</p>
                    )}
                </div>
            </div>
            </div>

            {/* ── Shared Category Filter Tabs ── */}
            <div className="flex space-x-2 mb-6 overflow-x-auto no-scrollbar pb-1">
                {['All', ...Object.keys(CATEGORY_MAP)].map(cat => (
                    <button
                        key={cat}
                        onClick={() => setCategory(cat)}
                        className={`px-3 py-1 rounded-full text-xs font-bold transition-colors whitespace-nowrap ${
                            category === cat
                                ? 'bg-primary text-white'
                                : 'bg-white/[0.04] text-muted-foreground border border-white/10 hover:text-white'
                        }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* ── SECTION 1: How to Settle Up (Minimized) ── */}
            <div className="mb-2">
                <div className="flex items-center space-x-2 mb-1">
                        <div className="p-1.5 rounded-xl bg-primary/10">
                        <Handshake className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white leading-tight">How to Settle Up</h2>
                        <p className="text-[11px] text-muted-foreground leading-tight">Minimum transactions to clear debts</p>
                    </div>
                </div>
            </div>

            {minimizedSettlements.length === 0 ? (
                <div className="text-center py-12 app-panel border-dashed mb-6">
                    <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-2 opacity-80" />
                    <p className="text-muted-foreground font-medium">All settled up!</p>
                    <p className="text-sm text-white/35 mt-1">No pending balances in the group.</p>
                </div>
            ) : (
                <div className="space-y-3 mb-8">
                    {minimizedSettlements.map((s, idx) => {
                        const isUserInvolved = user?.id === s.from || user?.id === s.to;
                        const fromMe = user?.id === s.from;
                        const isCreditor = user?.id === s.to;
                        const isDebtor   = user?.id === s.from;
                        const settlingKey = `${s.from}__${s.to}`;
                        const isSettlingNow = settling === settlingKey;

                        return (
                            <div key={idx} className={`bg-card p-4 rounded-2xl shadow-sm border ${
                                isUserInvolved ? 'border-primary/50' : 'border-white/10'
                            }`}>
                                <div className="flex items-center justify-between">
                                    {/* Avatars & Owes arrow */}
                                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                                        <img src={getMemberAvatar(s.from)} alt="" className="w-10 h-10 rounded-full bg-white/10 object-cover" />
                                        <div className="flex flex-col items-center px-2">
                                            <span className="text-[10px] text-muted-foreground font-medium tracking-wider uppercase mb-1">Owes</span>
                                            <ArrowRight className="w-4 h-4 text-white/25" />
                                        </div>
                                        <img src={getMemberAvatar(s.to)} alt="" className="w-10 h-10 rounded-full bg-white/10 object-cover" />
                                    </div>

                                    <div className="flex items-center space-x-4 pl-4 border-l border-[#1E1E1E] ml-2">
                                        <div className="text-right">
                                            <span className="block font-bold text-white">₹{s.amount.toFixed(2)}</span>
                                        </div>
                                        {isCreditor ? (() => {
                                                const settleAmount = s.amount;
                                                const isCardSettling = settlingCard === settlingKey;
                                                return isCardSettling ? null : (
                                                    <button
                                                        id={`settle-btn-minimized-${settlingKey}`}
                                                        onClick={() => openSettleModal(s.from, s.to, settleAmount)}
                                                        disabled={isSettlingNow}
                                                        className="accent-button text-xs font-bold px-3 py-2 rounded-lg"
                                                    >
                                                        Settle
                                                    </button>
                                                );
                                            })() : isDebtor ? (
                                            <div className="text-[10px] text-muted-foreground italic max-w-[80px] leading-tight text-center">
                                                Pending payment...
                                            </div>
                                        ) : (
                                            <div className="px-3 py-2" />
                                        )}
                                    </div>
                                </div>

                                {/* Inline partial-payment modal (minimized section) */}
                                {settlingCard === settlingKey && isCreditor && (() => {
                                    const settleAmount = s.amount;
                                    return renderSettleModal(s.from, s.to, settleAmount);
                                })()}

                                <div className="mt-3 text-sm text-muted-foreground text-center">
                                    <span className={fromMe ? 'font-bold text-white' : ''}>
                                        {fromMe ? 'You' : getMemberName(s.from).split(' ')[0]}
                                    </span>
                                    {' owe '}
                                    <span className={isCreditor ? 'font-bold text-white' : ''}>
                                        {user?.id === s.to ? 'You' : getMemberName(s.to).split(' ')[0]}
                                    </span>
                                </div>

                                <PaymentActions
                                    amount={s.amount}
                                    groupName={groupName}
                                    debtorName={getMemberName(s.from).split(' ')[0]}
                                    debtorWhatsApp={getMemberProfile(s.from)?.whatsapp_number}
                                    creditorName={getMemberName(s.to).split(' ')[0]}
                                    creditorUpiId={getMemberProfile(s.to)?.upi_id}
                                    isDebtor={isDebtor}
                                    isCreditor={isCreditor}
                                    onInfo={success}
                                    onError={showError}
                                />
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── SECTION 2: Full Balance Breakdown (existing — DO NOT modify) ── */}
            <div className="mb-4">
                <div className="flex items-center space-x-2 mb-1">
                        <div className="p-1.5 rounded-xl bg-white/[0.06]">
                        <BarChart3 className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white leading-tight">Full Balance Breakdown</h2>
                        <p className="text-[11px] text-muted-foreground leading-tight">Every individual debt pair</p>
                    </div>
                </div>
            </div>

            {settlements.length === 0 ? (
                <div className="text-center py-12 app-panel border-dashed">
                    <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-2 opacity-80" />
                    <p className="text-muted-foreground font-medium">All settled up!</p>
                    <p className="text-sm text-white/35 mt-1">No pending balances in the group.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {settlements.map((s, idx) => {
                        const isUserInvolved = user?.id === s.from || user?.id === s.to;
                        const fromMe = user?.id === s.from;

                        return (
                            <div key={idx} className={`bg-card p-4 rounded-2xl shadow-sm border ${isUserInvolved ? 'border-primary/50' : 'border-white/10'}`}>
                                <div className="flex items-center justify-between">

                                    {/* Avatars & Names */}
                                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                                        <img src={getMemberAvatar(s.from)} alt="" className="w-10 h-10 rounded-full bg-white/10 object-cover" />
                                        <div className="flex flex-col items-center px-2">
                                            <span className="text-[10px] text-muted-foreground font-medium tracking-wider uppercase mb-1">Owes</span>
                                            <ArrowRight className="w-4 h-4 text-white/25" />
                                        </div>
                                        <img src={getMemberAvatar(s.to)} alt="" className="w-10 h-10 rounded-full bg-white/10 object-cover" />
                                    </div>

                                    <div className="flex items-center space-x-4 pl-4 border-l border-[#1E1E1E] ml-2">
                                        <div className="text-right">
                                            <span className="block font-bold text-white">₹{s.amount.toFixed(2)}</span>
                                        </div>
                                        {(() => {
                                            const settlingKey = `${s.from}__${s.to}`;
                                            const isCreditor = user?.id === s.to;   // person who is owed — confirms receipt
                                            const isDebtor   = user?.id === s.from; // person who owes — waits for confirmation
                                            const isSettlingNow = settling === settlingKey;
                                            const isCardSettling = settlingCard === settlingKey;

                                            if (isCreditor) {
                                                // If modal is open for this card, hide the button
                                                if (isCardSettling) return null;
                                                return (
                                                    <button
                                                        id={`settle-btn-full-${settlingKey}`}
                                                        onClick={() => openSettleModal(s.from, s.to, s.amount)}
                                                        disabled={isSettlingNow}
                                                        className="accent-button text-xs font-bold px-3 py-2 rounded-lg"
                                                    >
                                                        Settle
                                                    </button>
                                                );
                                            }
                                            if (isDebtor) {
                                                return (
                                                    <div className="text-[10px] text-muted-foreground italic max-w-[80px] leading-tight text-center">
                                                        Pending payment...
                                                    </div>
                                                );
                                            }
                                            return <div className="px-3 py-2" />;
                                        })()}
                                    </div>

                                </div>

                                {/* Inline partial-payment modal (full breakdown section) */}
                                {settlingCard === `${s.from}__${s.to}` && user?.id === s.to &&
                                    renderSettleModal(s.from, s.to, s.amount)
                                }

                                <div className="mt-3 text-sm text-muted-foreground text-center">
                                    <span className={fromMe ? 'font-bold text-white' : ''}>
                                        {fromMe ? 'You' : getMemberName(s.from).split(' ')[0]}
                                    </span>
                                    {' owe '}
                                    <span className={user?.id === s.to ? 'font-bold text-white' : ''}>
                                        {user?.id === s.to ? 'You' : getMemberName(s.to).split(' ')[0]}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {showCalculationReport && (
                <Suspense fallback={<div className="fixed inset-0 z-[100] grid place-items-center bg-black/80"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
                    <CalculationReport
                        groupId={groupId}
                        groupName={groupName}
                        category={category}
                        members={members}
                        fallbackUsers={fallbackUsers}
                        onClose={closeCalculationReport}
                    />
                </Suspense>
            )}
        </div>
    );
}
