import React, { useState, useEffect } from 'react';
import insforge from '../lib/db';
import { dbQuery, dbDelete } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import { SettlementService } from '../services/settlementService';
import { format, isThisMonth } from 'date-fns';
import { Plus, Home, Utensils, Edit2, Trash2, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, Receipt, ShoppingCart, Zap, Building } from 'lucide-react';
import ExpenseModal from '../components/ExpenseModal';
import { useToast } from '../context/ToastContext';
import ConfirmModal from '../components/ConfirmModal';

export const CATEGORY_MAP: Record<string, { icon: any, colorClass: string }> = {
    'Home': { icon: Home, colorClass: 'bg-primary/10 text-primary' },
    'Kitchen': { icon: Utensils, colorClass: 'bg-warning/10 text-warning' },
    'Groceries': { icon: ShoppingCart, colorClass: 'bg-success/10 text-success' },
    'Utilities': { icon: Zap, colorClass: 'bg-cyan-500/10 text-cyan-500' },
    'Rent': { icon: Building, colorClass: 'bg-purple-500/10 text-purple-500' },
    'General': { icon: Receipt, colorClass: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300' }
};

export default function Dashboard() {
    const { user } = useAuth();
    const { currentGroup, members, groupId } = useGroup();
    const { success, error: showError } = useToast();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [expenses, setExpenses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterMode, setFilterMode] = useState<string>('all');

    const [modalOpen, setModalOpen] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [editingExpense, setEditingExpense] = useState<any>(null);

    const [balances, setBalances] = useState({ totalPaid: 0, totalOwed: 0, netBalance: 0 });

    // Greeting
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = user?.full_name?.split(' ')[0] || 'Member';

    const fetchInitialData = async () => {
        if (!groupId || !user) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            // Fetch expenses
            const expData = await dbQuery('expenses', `group_id=eq.${groupId}&order=created_at.desc&select=*,users(full_name),expense_splits(user_id,amount_owed)`);

            if (expData) {
                setExpenses(expData);
            }

            // Fetch Balances
            const bals = await SettlementService.calculateBalance(groupId, user.id);
            setBalances(bals);
        } catch (err) {
            console.error('Failed to load dashboard data', err);
        } finally {
            setLoading(false);
        }
    };

    // Realtime & Fetch Data setup
    useEffect(() => {
        fetchInitialData();
    }, [groupId, user]);

    const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);

    const handleDelete = async () => {
        if (!expenseToDelete) return;
        try {
            // Target the specific expense to see if it has a receipt
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const deletingExpense = expenses.find((e: any) => e.id === expenseToDelete);

            if (deletingExpense?.receipt_url) {
                // The URL is usually structured as: .../storage/v1/object/public/receipts/{filename}
                // We need to extract just the {filename} string
                const urlParts = deletingExpense.receipt_url.split('/');
                const fileName = decodeURIComponent(urlParts[urlParts.length - 1]);

                if (fileName) {
                    await insforge.storage
                        .from('receipts')
                        // @ts-ignore
                        .remove([fileName] as unknown as string);
                }
            }

            await dbDelete('expenses', `id=eq.${expenseToDelete}`);
            success('Expense deleted');
            await fetchInitialData();
        } catch {
            showError('Failed to delete expense');
        } finally {
            setExpenseToDelete(null);
        }
    };

    const getMemberName = (id: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = members.find((mem: any) => mem.user_id === id);
        return m?.users?.full_name || 'Someone';
    };

    // Stats calculation
    const currentMonthExpenses = expenses.filter(e => e.created_at && isThisMonth(new Date(e.created_at)));
    const totalThisMonth = currentMonthExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    // Exact Share Calculation
    let exactYourShare = 0;


    currentMonthExpenses.forEach(expense => {
        // Find the split for the current logged-in user
        const userSplit = expense.expense_splits?.find((s: any) => s.user_id === user?.id);
        const splitAmount = userSplit && userSplit.amount_owed ? Number(userSplit.amount_owed) : 0;

        exactYourShare += splitAmount;

        // Log the exact cut for mathematical auditing

    });



    const filteredExpenses = expenses.filter(e => filterMode === 'all' || e.category === filterMode);

    return (
        <div className="pb-24 pt-6 px-4 max-w-lg mx-auto min-h-screen">

            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
                    {greeting}, {name}
                </h1>
                {currentGroup && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                        {currentGroup.name}
                    </p>
                )}
            </div>

            {/* Summary Row */}
            <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-card dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total This Month</p>
                    <p className="text-xl font-bold">₹{totalThisMonth.toFixed(0)}</p>
                    <p className="text-xs text-gray-400 mt-1">Your share: ₹{exactYourShare.toFixed(0)}</p>
                </div>
                <div className={`p-4 rounded-2xl shadow-sm border ${balances.netBalance >= 0
                    ? 'bg-success/10 border-success/20 dark:bg-success/5'
                    : 'bg-danger/10 border-danger/20 dark:bg-danger/5'
                    }`}>
                    <p className={`text-xs mb-1 ${balances.netBalance >= 0 ? 'text-success' : 'text-danger'}`}>
                        Net Balance
                    </p>
                    <div className="flex items-center">
                        {balances.netBalance >= 0 ? <ArrowUpRight className="w-5 h-5 text-success mr-1" /> : <ArrowDownRight className="w-5 h-5 text-danger mr-1" />}
                        <p className={`text-xl font-bold ${balances.netBalance >= 0 ? 'text-success' : 'text-danger'}`}>
                            ₹{Math.abs(balances.netBalance).toFixed(0)}
                        </p>
                    </div>
                    <p className={`text-xs mt-1 ${balances.netBalance >= 0 ? 'text-success/80' : 'text-danger/80'}`}>
                        {balances.netBalance >= 0 ? 'Others owe you' : 'You owe others'}
                    </p>
                </div>
            </div>

            {/* Category Tabs */}
            <div className="flex space-x-2 mb-6 overflow-x-auto no-scrollbar pb-1">
                <button
                    onClick={() => setFilterMode('all')}
                    className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterMode === 'all' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50'
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
                            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex items-center ${filterMode === cat ? 'bg-primary text-white shadow-md' : 'bg-white text-gray-600 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50'
                                }`}
                        >
                            <Icon className="w-4 h-4 mr-1.5" /> {cat}
                        </button>
                    )
                })}
            </div>

            {/* Expense List */}
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Recent Activity</h2>

            {loading && expenses.length === 0 ? (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="animate-pulse flex h-20 bg-gray-200 dark:bg-gray-800 rounded-2xl"></div>
                    ))}
                </div>
            ) : filteredExpenses.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 border-dashed">
                    <p className="text-gray-500 dark:text-gray-400 font-medium">No expenses yet</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Tap the + button to add one</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredExpenses.map((expense) => (
                        <ExpenseCard
                            key={expense.id}
                            expense={expense}
                            memberName={getMemberName(expense.added_by)}
                            splitNames={expense.expense_splits?.map((s: any) => getMemberName(s.user_id)).join(', ')}
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
                    className="fixed bottom-20 right-6 sm:bottom-8 sm:right-8 w-14 h-14 bg-primary text-white rounded-full shadow-xl flex items-center justify-center hover:bg-primary/90 hover:scale-105 active:scale-95 transition-all z-40"
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
                    onSuccess={fetchInitialData}
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ExpenseCard({ expense, memberName, splitNames, onEdit, onDelete, isOwner }: any) {
    const parsedDate = expense.created_at ? new Date(expense.created_at) : new Date();
    const [expanded, setExpanded] = useState(false);

    const paidText = splitNames ? `Paid by ${memberName} for ${splitNames}` : memberName;

    return (
        <div className="relative overflow-hidden rounded-2xl bg-card dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 transition-all hover:shadow-md">
            <div
                className="w-full bg-card dark:bg-gray-800 p-4 flex flex-col justify-center cursor-pointer"
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
                            <h3 className="font-bold text-gray-900 dark:text-white truncate">{expense.item_name}</h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 whitespace-normal leading-relaxed" title={`${paidText} • ${format(parsedDate, 'MMM d, yyyy • h:mm a')}`}>
                                {paidText} <br className="hidden sm:block" />
                                <span className="opacity-75">• {format(parsedDate, 'MMM d, yyyy • h:mm a')}</span>
                            </p>
                        </div>
                    </div>
                    <div className="flex-shrink-0 flex items-center space-x-3">
                        <span className="font-extrabold text-gray-900 dark:text-white text-lg">₹{Number(expense.amount).toFixed(0)}</span>
                        {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                    </div>
                </div>

                {expanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 animate-in fade-in slide-in-from-top-2">
                        {expense.note ? (
                            <div className="mb-3">
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider mb-1">Description</p>
                                <p className="text-sm text-gray-800 dark:text-gray-200">{expense.note}</p>
                            </div>
                        ) : (
                            <div className="mb-3">
                                <p className="text-xs text-gray-500 dark:text-gray-400 italic">No description provided.</p>
                            </div>
                        )}

                        {expense.receipt_url && (
                            <div className="mb-3">
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider mb-1">Bill / Receipt</p>
                                <a href={expense.receipt_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center w-fit">
                                    View Attachment <ArrowUpRight className="w-3 h-3 ml-1" />
                                </a>
                            </div>
                        )}

                        {isOwner && (
                            <div className="flex justify-end space-x-4 mt-2 pt-3 border-t border-gray-100 dark:border-gray-700">
                                <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="flex items-center text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
                                    <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="flex items-center text-xs font-medium text-danger hover:underline">
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
