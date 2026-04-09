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
            // Compute minimized settlements from the same raw data (no extra DB fetch)
            const minimized = SettlementService.calculateMinimizedSettlements(calcSettlements);
            setMinimizedSettlements(minimized);

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleSettleUp = async (settlement: any) => {
        if (!groupId || !user) return;

        // Guard: ONLY the creditor (s.to) may confirm receipt of payment.
        // This prevents the debtor from self-confirming.
        if (user.id !== settlement.to) return;

        // Use a separator so "abc" + "def" != "ab" + "cdef"
        const settlingKey = `${settlement.from}__${settlement.to}`;
        if (settling === settlingKey) return; // Prevent double-click
        setSettling(settlingKey);

        try {
            await SettlementService.settleUp(groupId, settlement.from, settlement.to, settlement.amount);
            success('Settlement recorded successfully!');
            await fetchBalanceData(); // await so UI doesn't flash stale data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'Failed to settle up');
        } finally {
            setSettling(null);
        }
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
                                                // Bug B Fix: use the RAW pairwise amount, not the minimized consolidated amount.
                                                // The minimized amount may span multiple creditors (e.g. Adnan→Danish ₹4195
                                                // absorbs Adnan→Yazz ₹112), but settleUp() only clears this specific pair.
                                                // Using the raw pair amount ensures the settlement record matches exactly
                                                // what was bilaterally agreed, and the remaining cross-pair debt stays for
                                                // the other creditor to settle separately.
                                                const rawPair = settlements.find(
                                                    (r: any) => r.from === s.from && r.to === s.to
                                                );
                                                const settlePayload = rawPair
                                                    ? { ...s, amount: rawPair.amount }
                                                    : s; // fallback: use minimized amount if no raw pair found
                                                return (
                                                    <button
                                                        onClick={() => handleSettleUp(settlePayload)}
                                                        disabled={isSettlingNow}
                                                        className="bg-indigo-600 text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                                    >
                                                        {isSettlingNow ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Settle'}
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

                                            if (isCreditor) {
                                                // Creditor confirms they received the cash
                                                return (
                                                    <button
                                                        onClick={() => handleSettleUp(s)}
                                                        disabled={isSettlingNow}
                                                        className="bg-primary text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                                                    >
                                                        {isSettlingNow ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Settle'}
                                                    </button>
                                                );
                                            }
                                            if (isDebtor) {
                                                // Debtor waits — they've paid but creditor hasn't confirmed yet
                                                return (
                                                    <div className="text-[10px] text-gray-500 italic max-w-[80px] leading-tight text-center">
                                                        Pending payment...
                                                    </div>
                                                );
                                            }
                                            // Third-party member sees nothing
                                            return <div className="px-3 py-2" />;
                                        })()}
                                    </div>

                                </div>

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
