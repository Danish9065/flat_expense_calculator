import React, { useState, useEffect, useCallback } from 'react';
import { dbQuery, dbDelete } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import { SettlementService } from '../services/settlementService';
import { format, isThisMonth } from 'date-fns';
import { Plus, Edit2, Trash2, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import ExpenseModal from '../components/ExpenseModal';
import { useToast } from '../context/ToastContext';
import ConfirmModal from '../components/ConfirmModal';
import { CATEGORY_MAP } from '../constants/categories';
import { useRealtimeSync, notifyGroupDataChanged } from '../hooks/useRealtimeSync';
import SecureStorageLink from '../components/SecureStorageLink';
import SecureStorageImage from '../components/SecureStorageImage';
import { deleteStorageReference } from '../lib/storage';

interface ExpenseSplitRow {
    user_id: string;
    amount_owed?: string | number;
    users?: {
        full_name?: string;
    };
}

interface ExpenseRow {
    id: string;
    added_by: string;
    amount: string | number;
    category?: string;
    item_name: string;
    note?: string | null;
    receipt_url?: string | null;
    created_at?: string;
    expense_splits?: ExpenseSplitRow[];
    users?: {
        full_name?: string;
    };
}

interface GroupMemberRow {
    user_id: string;
    users?: {
        full_name?: string;
    };
}

interface ExpenseCardProps {
    expense: ExpenseRow;
    memberName: string;
    splitNames: string;
    onEdit: () => void;
    onDelete: () => void;
    isOwner: boolean;
}

export default function Dashboard() {
    const { user } = useAuth();
    const { currentGroup, members, groupId, loading: groupLoading, error: groupError, refreshGroup } = useGroup();
    const { success, error: showError } = useToast();

    const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [filterMode, setFilterMode] = useState<string>('all');

    const [modalOpen, setModalOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null);

    const [balances, setBalances] = useState({ totalPaid: 0, totalOwed: 0, netBalance: 0 });

    // Greeting
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = user?.full_name?.split(' ')[0] || 'Member';

    const fetchInitialData = useCallback(async (silent = false) => {
        if (!groupId || !user) {
            setLoading(false);
            return;
        }

        if (silent) {
            setIsRefreshing(true);
        } else {
            setLoading(true);
        }

        try {
            // Fetch expenses
            const expData = await dbQuery('expenses', `group_id=eq.${groupId}&order=created_at.desc&select=*,users(full_name),expense_splits(user_id,amount_owed,users(full_name))`);

            if (expData) {
                setExpenses(expData as ExpenseRow[]);
            }

            // Fetch Balances
            const bals = await SettlementService.calculateBalance(groupId, user.id);
            setBalances(bals);
        } catch (err) {
            console.error('Failed to load dashboard data', err);
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    }, [groupId, user]);

    // Fix 4: re-fetch on group/user switch
    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    // Fix 1: InsForge Realtime — silent re-fetch when any group member writes data
    useRealtimeSync(groupId, () => fetchInitialData(true));

    // Re-fetch balance whenever Balance.tsx fires a settle-complete event
    useEffect(() => {
        const onSettle = () => {
            if (groupId && user) {
                SettlementService.calculateBalance(groupId, user.id)
                    .then(bals => setBalances(bals))
                    .catch(err => console.error('Failed to refresh balance after settle', err));
            }
        };
        window.addEventListener('settle-complete', onSettle);
        return () => window.removeEventListener('settle-complete', onSettle);
    }, [groupId, user]);

    const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);

    const handleDelete = async () => {
        if (!expenseToDelete) return;
        try {
            // Target the specific expense to see if it has a receipt
            const deletingExpense = expenses.find((e) => e.id === expenseToDelete);

            if (deletingExpense?.receipt_url) {
                await deleteStorageReference(deletingExpense.receipt_url);
            }

            await dbDelete('expenses', `id=eq.${expenseToDelete}`);
            success('Expense deleted');
            await fetchInitialData(true);
            if (groupId) void notifyGroupDataChanged(groupId);
        } catch {
            showError('Failed to delete expense');
        } finally {
            setExpenseToDelete(null);
        }
    };

    const getMemberName = (id: string, fallbackName?: string) => {
        const m = (members as GroupMemberRow[]).find((mem) => mem.user_id === id);
        if (m?.users?.full_name) return m.users.full_name;
        if (fallbackName) return `${fallbackName} (Removed)`;
        return 'Unknown User (Removed)';
    };

    // Resolve split_between user IDs to display names.
    // If all group members are included, returns "All".
    const resolveSplitNames = (expense: ExpenseRow): string => {
        const splitEntries: ExpenseSplitRow[] = expense.expense_splits || [];
        if (splitEntries.length === 0) return '';
        // Compare with total group members count
        if (splitEntries.length >= members.length && members.length > 0) {
            // Check if all active members are in the split
            const allActiveIncluded = members.every(m => splitEntries.some(s => s.user_id === m.user_id));
            if (allActiveIncluded && splitEntries.length === members.length) return 'All';
        }
        return splitEntries.map((s) => getMemberName(s.user_id, s.users?.full_name)).join(', ');
    };

    // Stats calculation
    const currentMonthExpenses = expenses.filter(e => e.created_at && isThisMonth(new Date(e.created_at)));
    const totalThisMonth = currentMonthExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    // Exact Share Calculation
    let exactYourShare = 0;


    currentMonthExpenses.forEach(expense => {
        // Find the split for the current logged-in user
        const userSplit = expense.expense_splits?.find((s) => s.user_id === user?.id);
        const splitAmount = userSplit && userSplit.amount_owed ? Number(userSplit.amount_owed) : 0;

        exactYourShare += splitAmount;

        // Log the exact cut for mathematical auditing

    });



    const filteredExpenses = expenses.filter(e => filterMode === 'all' || e.category === filterMode);

    if (groupLoading) {
        return <div className="grid min-h-[70vh] place-items-center"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    if (groupError && !groupId) {
        return (
            <div className="grid min-h-[70vh] place-items-center px-6 text-center">
                <div className="app-panel max-w-md p-6">
                    <h1 className="text-lg font-bold text-white">We couldn't load your groups</h1>
                    <p className="mt-2 text-sm text-muted-foreground">Your data is safe. Check your connection and try again.</p>
                    <button type="button" onClick={() => void refreshGroup()} className="accent-button mt-5 min-h-11 rounded-xl px-5 font-bold">Try again</button>
                </div>
            </div>
        );
    }

    return (
        <div className="app-section pb-28 min-h-screen">

            {/* Header */}
            <div className="mb-8 text-center">
                <p className="app-label mb-3">SplitMate Dashboard</p>
                <h1 className="app-title">
                    {greeting}, {name}
                </h1>
                {currentGroup && (
                    <p className="app-subtitle mt-3">
                        {currentGroup.name}
                    </p>
                )}
            </div>

            {/* Summary Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 mb-8 app-panel overflow-hidden">
                <div className="bg-card p-6 lg:p-8 border-b md:border-b-0 md:border-r border-[#1E1E1E]">
                    <p className="app-label mb-3">Total This Month</p>
                    <p className="text-4xl font-bold text-white">₹{totalThisMonth.toFixed(2)}</p>
                    <p className="text-sm text-muted-foreground mt-3">Your share: <span className="text-primary font-semibold">₹{exactYourShare.toFixed(2)}</span></p>
                </div>
                <div className={`p-6 lg:p-8 ${balances.netBalance >= 0
                    ? 'bg-green-500/10'
                    : 'bg-primary/10'
                    }`}>
                    <p className={`app-label mb-3 ${balances.netBalance >= 0 ? '!text-green-300' : '!text-primary'}`}>
                        Net Balance
                    </p>
                    <div className="flex items-center">
                        {balances.netBalance >= 0 ? <ArrowUpRight className="w-7 h-7 text-green-300 mr-2" /> : <ArrowDownRight className="w-7 h-7 text-primary mr-2" />}
                        <p className={`text-4xl font-bold ${balances.netBalance >= 0 ? 'text-green-300' : 'text-primary'}`}>
                            ₹{Math.abs(balances.netBalance).toFixed(2)}
                        </p>
                    </div>
                    <p className={`text-sm mt-3 ${balances.netBalance >= 0 ? 'text-green-200/80' : 'text-primary/80'}`}>
                        {balances.netBalance >= 0 ? 'Others owe you' : 'You owe others'}
                    </p>
                </div>
            </div>

            {/* Category Tabs */}
            <div className="flex space-x-2 mb-6 overflow-x-auto no-scrollbar pb-1">
                <button
                    onClick={() => setFilterMode('all')}
                    className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterMode === 'all' ? 'bg-primary text-white shadow-[0_0_24px_rgba(255,86,86,0.22)]' : 'bg-white/[0.04] text-muted-foreground border border-white/10 hover:bg-white/[0.08] hover:text-white'
                        }`}
                >
                    All Expenses
                </button>
                {Object.keys(CATEGORY_MAP).map(cat => {
                    const Icon = CATEGORY_MAP[cat].icon;
                    return (
                        <button
                            key={cat}
                            onClick={() => setFilterMode(cat)}
                            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex items-center ${filterMode === cat ? 'bg-primary text-white shadow-[0_0_24px_rgba(255,86,86,0.22)]' : 'bg-white/[0.04] text-muted-foreground border border-white/10 hover:bg-white/[0.08] hover:text-white'
                                }`}
                        >
                            <Icon className="w-4 h-4 mr-1.5" /> {cat}
                        </button>
                    )
                })}
            </div>

            {/* Expense List */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white">Recent Activity</h2>
                {isRefreshing && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground animate-pulse">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Updating...
                    </span>
                )}
            </div>

            {loading && expenses.length === 0 ? (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="animate-pulse flex h-20 bg-white/[0.06] rounded-2xl"></div>
                    ))}
                </div>
            ) : filteredExpenses.length === 0 ? (
                <div className="text-center py-12 app-panel border-dashed">
                    <p className="text-muted-foreground font-medium">No expenses yet</p>
                    <p className="text-sm text-white/35 mt-1">Tap the + button to add one</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredExpenses.map((expense) => (
                        <ExpenseCard
                            key={expense.id}
                            expense={expense}
                            memberName={getMemberName(expense.added_by, expense.users?.full_name)}
                            splitNames={resolveSplitNames(expense)}
                            onEdit={() => { setEditingExpense(expense); setModalOpen(true); }}
                            onDelete={() => setExpenseToDelete(expense.id)}
                            isOwner={user?.id === expense.added_by}
                        />
                    ))}
                </div>
            )}

            {/* Floating Add Button */}
            {groupId && (
                <button
                    onClick={() => { setEditingExpense(null); setModalOpen(true); }}
                    className="fixed bottom-20 right-6 sm:bottom-8 sm:right-8 w-14 h-14 bg-primary text-white rounded-full shadow-[0_16px_40px_rgba(255,86,86,0.35)] flex items-center justify-center hover:bg-primary/90 hover:scale-105 active:scale-95 transition-all z-40"
                >
                    <Plus className="w-6 h-6" />
                </button>
            )}

            {/* Modals */}
            {groupId && (
                <ExpenseModal
                    isOpen={modalOpen}
                    onClose={() => setModalOpen(false)}
                    groupId={groupId}
                    editingExpense={editingExpense}
                    onSuccess={async () => {
                        await fetchInitialData(true);
                        if (groupId) void notifyGroupDataChanged(groupId);
                    }}
                />
            )}

            <ConfirmModal
                isOpen={!!expenseToDelete}
                onClose={() => setExpenseToDelete(null)}
                onConfirm={handleDelete}
                title="Delete Expense"
                message="Are you sure you want to permanently delete this expense? This action cannot be undone and splits will be recalculated."
                confirmText="Delete"
            />
        </div>
    );
}

// Internal component for Expense Item
function ExpenseCard({ expense, memberName, splitNames, onEdit, onDelete, isOwner }: ExpenseCardProps) {
    const parsedDate = expense.created_at ? new Date(expense.created_at) : new Date();
    const [expanded, setExpanded] = useState(false);

    const paidText = splitNames ? `Paid by ${memberName} for ${splitNames}` : memberName;

    return (
        <div className="relative overflow-hidden app-panel transition-all hover:border-white/20">
            <div
                className="w-full bg-card p-4 md:p-5 flex flex-col justify-center cursor-pointer"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4 overflow-hidden">
                        {(() => {
                            const mapEntry = CATEGORY_MAP[expense.category] || CATEGORY_MAP['General'];
                            const Icon = mapEntry.icon;
                            return (
                                <div className={`p-3 rounded-full flex-shrink-0 ${mapEntry.colorClass}`}>
                                    <Icon className="w-6 h-6" />
                                </div>
                            );
                        })()}
                        <div className="pr-2">
                            <h3 className="font-bold text-white truncate">{expense.item_name}</h3>
                            <p className="text-xs text-muted-foreground mt-1 whitespace-normal leading-relaxed" title={`${paidText} • ${format(parsedDate, 'MMM d, yyyy • h:mm a')}`}>
                                {paidText} <br className="hidden sm:block" />
                                <span className="opacity-75">• {format(parsedDate, 'MMM d, yyyy • h:mm a')}</span>
                            </p>
                        </div>
                    </div>
                    <div className="flex-shrink-0 flex items-center space-x-3">
                        <span className="font-extrabold text-white text-lg">₹{Number(expense.amount).toFixed(0)}</span>
                        {expanded ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
                    </div>
                </div>

                {expanded && (
                    <div className="mt-4 pt-4 border-t border-[#1E1E1E] animate-in fade-in slide-in-from-top-2">
                        {expense.note ? (
                            <div className="mb-3">
                                <p className="app-label mb-1">Description</p>
                                <p className="text-sm text-white/85">{expense.note}</p>
                            </div>
                        ) : (
                            <div className="mb-3">
                                <p className="text-xs text-muted-foreground italic">No description provided.</p>
                            </div>
                        )}

                        {expense.receipt_url && (
                            <div className="mb-3">
                                <p className="app-label mb-1">Bill / Receipt</p>
                                <SecureStorageImage
                                    source={expense.receipt_url}
                                    alt={`Receipt for ${expense.item_name}`}
                                    className="mb-2 max-h-72 w-full rounded-xl border border-white/10 bg-black/20 object-contain"
                                />
                                <SecureStorageLink reference={expense.receipt_url} />
                            </div>
                        )}

                        {isOwner && (
                            <div className="flex justify-end space-x-4 mt-2 pt-3 border-t border-[#1E1E1E]">
                                <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="flex items-center text-xs font-medium text-white/80 hover:text-white">
                                    <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="flex items-center text-xs font-medium text-primary hover:text-primary/80">
                                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
