import { useState, useEffect } from 'react';
import { dbQuery } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import { SettlementService } from '../services/settlementService';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { ArrowRight, Loader2, CheckCircle2, Handshake, BarChart3 } from 'lucide-react';
import { CATEGORY_MAP } from '../constants/categories';
import { useToast } from '../context/ToastContext';

// Colors for the donut chart
const COLORS = ['#6C63FF', '#22C55E', '#F59E0B', '#EF4444', '#06b6d4', '#8b5cf6', '#ec4899'];

export default function Balance() {
    const { user } = useAuth();
    const { groupId, members } = useGroup();
    const { success, error: showError } = useToast();

    const [loading, setLoading] = useState(true);
    const [settling, setSettling] = useState<string | null>(null);
    const [category, setCategory] = useState<string>('All');
    // Partial payment state
    const [settlingCard, setSettlingCard] = useState<string | null>(null); // `${from}__${to}`
    const [partialAmount, setPartialAmount] = useState<string>('');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [chartData, setChartData] = useState<any[]>([]);
    const [categoryTotals, setCategoryTotals] = useState<Record<string, number>>({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [settlements, setSettlements] = useState<any[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [minimizedSettlements, setMinimizedSettlements] = useState<any[]>([]);

    const fetchBalanceData = async () => {
        if (!groupId) { setLoading(false); return; }

        try {
            // 1. Chart Data: "Who paid what" total
            let expQuery = `group_id=eq.${groupId}&select=added_by,amount,category`;
            if (category !== 'All') expQuery += `&category=eq.${category}`;
            const expenses = await dbQuery('expenses', expQuery);

            if (expenses) {
                const userTotals: Record<string, number> = {};
                const catTotals: Record<string, number> = {};

                expenses.forEach((e: any) => {
                    userTotals[e.added_by] = (userTotals[e.added_by] || 0) + Number(e.amount);
                    catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount);
                });

                const cData = members.map((m: any, index: number) => ({
                    name: m.users?.full_name?.split(' ')[0] || 'Member',
                    value: userTotals[m.user_id] || 0,
                    color: COLORS[index % COLORS.length]
                })).filter((d: any) => d.value > 0);

                setChartData(cData);
                setCategoryTotals(catTotals);
            }

            // 2. Settlement Data: "How to settle up"
            const calcSettlements = await SettlementService.calculateGroupSettlements(groupId, members, category);
            setSettlements(calcSettlements);
            setMinimizedSettlements(calcSettlements);

        } catch (err) {
            console.error('Failed to load balance data', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBalanceData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId, members, category]);

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
            await fetchBalanceData();
            window.dispatchEvent(new CustomEvent('settle-complete'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'Failed to settle up');
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
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                    Total owed: <span className="text-gray-900 dark:text-white font-bold">₹{fullAmount.toFixed(2)}</span>
                </p>
                <div className="flex items-center space-x-2 mb-2">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400 shrink-0">Paying:</span>
                    <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">₹</span>
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
                            className="w-full pl-7 pr-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-semibold bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                            disabled={isSettlingNow}
                        />
                    </div>
                </div>
                {hint && (
                    <p className={`text-[11px] mb-2 leading-tight ${
                        isFullPayment
                            ? 'text-green-600 dark:text-green-400 font-semibold'
                            : 'text-amber-600 dark:text-amber-400'
                    }`}>
                        {hint}
                    </p>
                )}
                <div className="flex items-center space-x-2">
                    <button
                        id={`cancel-settle-${key}`}
                        onClick={() => { setSettlingCard(null); setPartialAmount(''); }}
                        disabled={isSettlingNow}
                        className="flex-1 py-2 text-xs font-bold rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        id={`confirm-settle-${key}`}
                        onClick={() => handleSettleUp(from, to, enteredNum, fullAmount)}
                        disabled={isSettlingNow || !isValid}
                        className="flex-1 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center space-x-1"
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
        return members.find((m: any) => m.user_id === id)?.users?.full_name || 'Someone';
    };

    const getMemberAvatar = (id: string) => {
        const url = members.find((m: any) => m.user_id === id)?.users?.avatar_url;
        if (url) return url;
        // fallback avatar based on name
        const name = getMemberName(id);
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
    };

    if (loading) {
        return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
    }

    if (!groupId) return (
        <div className="text-center py-20 px-4">
            <h2 className="text-xl font-bold">No Balances</h2>
            <p className="text-gray-500 mt-2">Join a group first to see your balance</p>
        </div>
    );

    return (
        <div className="pb-24 pt-6 px-4 max-w-lg mx-auto min-h-screen">
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white mb-6">Balances</h1>

            {/* Donut Chart */}
            <div className="bg-card dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Who paid what</h2>
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
                    <div className="h-48 flex items-center justify-center text-gray-400">
                        No expenses yet
                    </div>
                )}
            </div>

            {/* Category Breakdown */}
            <div className="mb-6">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3 uppercase tracking-wider">Category Breakdown</h2>
                <div className="grid grid-cols-2 gap-3">
                    {Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).map(([cat, total]) => {
                        const mapEntry = CATEGORY_MAP[cat] || CATEGORY_MAP['General'];
                        const Icon = mapEntry.icon;
                        return (
                            <div key={cat} className="bg-card dark:bg-gray-800 p-3 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center space-x-3">
                                <div className={`p-2 rounded-xl ${mapEntry.colorClass}`}>
                                    <Icon className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{cat}</p>
                                    <p className="font-extrabold text-gray-900 dark:text-white">₹{total.toFixed(0)}</p>
                                </div>
                            </div>
                        );
                    })}
                    {Object.keys(categoryTotals).length === 0 && (
                        <p className="text-xs text-gray-400 col-span-2 italic">Reflects applied filters above</p>
                    )}
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
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* ── SECTION 1: How to Settle Up (Minimized) ── */}
            <div className="mb-2">
                <div className="flex items-center space-x-2 mb-1">
                    <div className="p-1.5 rounded-xl bg-indigo-100 dark:bg-indigo-900/40">
                        <Handshake className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">How to Settle Up</h2>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight">Minimum transactions to clear debts</p>
                    </div>
                </div>
            </div>

            {minimizedSettlements.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 border-dashed mb-6">
                    <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-2 opacity-80" />
                    <p className="text-gray-500 dark:text-gray-400 font-medium">All settled up!</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">No pending balances in the group.</p>
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
                            <div key={idx} className={`bg-card dark:bg-gray-800 p-4 rounded-2xl shadow-sm border ${
                                isUserInvolved ? 'border-indigo-300/60 dark:border-indigo-600/40' : 'border-gray-100 dark:border-gray-700'
                            }`}>
                                <div className="flex items-center justify-between">
                                    {/* Avatars & Owes arrow */}
                                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                                        <img src={getMemberAvatar(s.from)} alt="" className="w-10 h-10 rounded-full bg-gray-200" />
                                        <div className="flex flex-col items-center px-2">
                                            <span className="text-[10px] text-gray-400 font-medium tracking-wider uppercase mb-1">Owes</span>
                                            <ArrowRight className="w-4 h-4 text-gray-300" />
                                        </div>
                                        <img src={getMemberAvatar(s.to)} alt="" className="w-10 h-10 rounded-full bg-gray-200" />
                                    </div>

                                    <div className="flex items-center space-x-4 pl-4 border-l border-gray-100 dark:border-gray-700 ml-2">
                                        <div className="text-right">
                                            <span className="block font-bold text-gray-900 dark:text-white">₹{s.amount.toFixed(2)}</span>
                                        </div>
                                        {isCreditor ? (() => {
                                                const settleAmount = s.amount;
                                                const isCardSettling = settlingCard === settlingKey;
                                                return isCardSettling ? null : (
                                                    <button
                                                        id={`settle-btn-minimized-${settlingKey}`}
                                                        onClick={() => openSettleModal(s.from, s.to, settleAmount)}
                                                        disabled={isSettlingNow}
                                                        className="bg-indigo-600 text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                                    >
                                                        Settle
                                                    </button>
                                                );
                                            })() : isDebtor ? (
                                            <div className="text-[10px] text-gray-500 italic max-w-[80px] leading-tight text-center">
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

                                <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 text-center">
                                    <span className={fromMe ? 'font-bold text-gray-900 dark:text-gray-200' : ''}>
                                        {fromMe ? 'You' : getMemberName(s.from).split(' ')[0]}
                                    </span>
                                    {' owe '}
                                    <span className={isCreditor ? 'font-bold text-gray-900 dark:text-gray-200' : ''}>
                                        {user?.id === s.to ? 'You' : getMemberName(s.to).split(' ')[0]}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── SECTION 2: Full Balance Breakdown (existing — DO NOT modify) ── */}
            <div className="mb-4">
                <div className="flex items-center space-x-2 mb-1">
                    <div className="p-1.5 rounded-xl bg-violet-100 dark:bg-violet-900/40">
                        <BarChart3 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">Full Balance Breakdown</h2>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight">Every individual debt pair</p>
                    </div>
                </div>
            </div>

            {settlements.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 border-dashed">
                    <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-2 opacity-80" />
                    <p className="text-gray-500 dark:text-gray-400 font-medium">All settled up!</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">No pending balances in the group.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {settlements.map((s, idx) => {
                        const isUserInvolved = user?.id === s.from || user?.id === s.to;
                        const fromMe = user?.id === s.from;

                        return (
                            <div key={idx} className={`bg-card dark:bg-gray-800 p-4 rounded-2xl shadow-sm border ${isUserInvolved ? 'border-primary/30' : 'border-gray-100 dark:border-gray-700'}`}>
                                <div className="flex items-center justify-between">

                                    {/* Avatars & Names */}
                                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                                        <img src={getMemberAvatar(s.from)} alt="" className="w-10 h-10 rounded-full bg-gray-200" />
                                        <div className="flex flex-col items-center px-2">
                                            <span className="text-[10px] text-gray-400 font-medium tracking-wider uppercase mb-1">Owes</span>
                                            <ArrowRight className="w-4 h-4 text-gray-300" />
                                        </div>
                                        <img src={getMemberAvatar(s.to)} alt="" className="w-10 h-10 rounded-full bg-gray-200" />
                                    </div>

                                    <div className="flex items-center space-x-4 pl-4 border-l border-gray-100 dark:border-gray-700 ml-2">
                                        <div className="text-right">
                                            <span className="block font-bold text-gray-900 dark:text-white">₹{s.amount.toFixed(2)}</span>
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
                                                        className="bg-primary text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                                                    >
                                                        Settle
                                                    </button>
                                                );
                                            }
                                            if (isDebtor) {
                                                return (
                                                    <div className="text-[10px] text-gray-500 italic max-w-[80px] leading-tight text-center">
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

                                <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 text-center">
                                    <span className={fromMe ? 'font-bold text-gray-900 dark:text-gray-200' : ''}>
                                        {fromMe ? 'You' : getMemberName(s.from).split(' ')[0]}
                                    </span>
                                    {' owe '}
                                    <span className={user?.id === s.to ? 'font-bold text-gray-900 dark:text-gray-200' : ''}>
                                        {user?.id === s.to ? 'You' : getMemberName(s.to).split(' ')[0]}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
