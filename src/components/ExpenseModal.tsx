import React, { useState, useEffect } from 'react';
import { X, Receipt, Loader2, Repeat } from 'lucide-react';
import insforge from '../lib/db';
import { ExpenseService } from '../services/expenseService';
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import { useToast } from '../context/ToastContext';
import imageCompression from 'browser-image-compression';
import { dbQuery } from '../lib/db';
import { CATEGORIES } from '../constants/categories';

interface ExpenseModalProps {
    isOpen: boolean;
    onClose: () => void;
    groupId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editingExpense?: any;
    onSuccess?: () => void;
}



export default function ExpenseModal({ isOpen, onClose, groupId, editingExpense, onSuccess }: ExpenseModalProps) {
    const { user } = useAuth();
    const { members } = useGroup();
    const { success, error: showError } = useToast();

    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('General');
    const [note, setNote] = useState('');
    const [splitBetween, setSplitBetween] = useState<string[]>([]);
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurType, setRecurType] = useState<'weekly' | 'monthly'>('monthly');
    const [loadingState, setLoadingState] = useState<'idle' | 'compressing' | 'uploading' | 'saving'>('idle');

    useEffect(() => {
        if (isOpen) {
            if (editingExpense) {
                setAmount(editingExpense.amount.toString());
                setDescription(editingExpense.item_name);
                setCategory(editingExpense.category || 'General');
                setNote(editingExpense.note || '');
                setIsRecurring(editingExpense.is_recurring || false);
                setRecurType(editingExpense.recur_type || 'monthly');
                setReceiptFile(null);

                // Fetch splits for this expense to populate checkboxes
                const fetchSplits = async () => {
                    try {
                        const splits = await dbQuery('expense_splits', `expense_id=eq.${editingExpense.id}&select=user_id`);
                        if (splits && splits.length > 0) {
                            setSplitBetween((splits as unknown as { user_id: string }[]).map((s) => s.user_id));
                        } else {
                            // Fallback to all members if none found
                            setSplitBetween(members.map((m: { user_id: string }) => m.user_id));
                        }
                    } catch {
                        setSplitBetween(members.map((m: { user_id: string }) => m.user_id));
                    }
                };
                fetchSplits();
            } else {
                setAmount('');
                setDescription('');
                setCategory('General');
                setNote('');
                setReceiptFile(null);
                setIsRecurring(false);
                setRecurType('monthly');
                setSplitBetween(members.map((m: { user_id: string }) => m.user_id));
            }
        }
    }, [editingExpense, isOpen, members]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !groupId) return;

        setLoadingState('compressing');
        try {
            let receiptUrl = editingExpense?.receipt_url;

            // 1. Upload receipt if any
            if (receiptFile) {
                // Compress image before upload
                const options = {
                    maxSizeMB: 0.15,
                    maxWidthOrHeight: 1280,
                    useWebWorker: true
                };

                try {
                    const compressedFile = await imageCompression(receiptFile, options);

                    setLoadingState('uploading');
                    const { data, error: uploadErr } = await insforge.storage
                        .from('receipts')
                        .uploadAuto(compressedFile);

                    if (uploadErr) throw new Error('Failed to upload receipt');
                    if (data?.url) receiptUrl = data.url;
                } catch (compressError) {
                    console.error('Error compressing image:', compressError);
                    throw new Error('Failed to compress receipt image');
                }
            }

            setLoadingState('saving');
            const expenseData = {
                group_id: groupId,
                category,
                item_name: description,
                amount: parseFloat(amount),
                added_by: user.id,
                note,
                receipt_url: receiptUrl,
                is_recurring: isRecurring,
                recur_type: isRecurring ? recurType : null,
                splitBetween: splitBetween
            };

            if (editingExpense) {
                await ExpenseService.editExpense(editingExpense.id, expenseData);
                success('Expense updated');
            } else {
                await ExpenseService.addExpense(expenseData);
                success('Expense added');
            }

            onClose();
            if (onSuccess) {
                onSuccess();
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'Failed to save expense');
        } finally {
            setLoadingState('idle');
        }
    };

    const toggleSplitMember = (userId: string) => {
        if (splitBetween.includes(userId)) {
            if (splitBetween.length > 1) { // Prevent empty split
                setSplitBetween(prev => prev.filter(id => id !== userId));
            } else {
                showError('At least one member must be in the split');
            }
        } else {
            setSplitBetween(prev => [...prev, userId]);
        }
    };

    const splitPreview = splitBetween.length > 0 && amount
        ? (parseFloat(amount) / splitBetween.length).toFixed(2)
        : '0.00';

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-4 sm:p-0">
            <div className="app-panel w-full max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b border-[#1E1E1E]">
                    <h3 className="text-lg font-bold text-white">
                        {editingExpense ? 'Edit Expense' : 'Add Expense'}
                    </h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-white">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-4 overflow-y-auto">
                    <form id="expense-form" onSubmit={handleSubmit} className="app-divider">

                        {/* Amount */}
                        <div className="pb-5">
                            <label className="app-label mb-2 block">Amount</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <span className="text-primary sm:text-lg font-bold">₹</span>
                                </div>
                                <input
                                    autoFocus
                                    required
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                    className="dark-input block pl-8 pr-3 py-3 text-lg font-bold rounded-xl"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        {/* Category Select */}
                        <div className="py-5">
                            <label className="app-label mb-2 block">Category</label>
                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="dark-input rounded-xl px-4 py-3 appearance-none cursor-pointer"
                            >
                                {CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>

                        {/* Item Name */}
                        <div className="py-5">
                            <label className="app-label mb-2 block">What was it for?</label>
                            <input
                                required
                                type="text"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                className="dark-input block px-3 py-2 rounded-lg sm:text-sm"
                                placeholder="e.g. Groceries, Electricity Bill"
                            />
                        </div>

                        {/* Note */}
                        <div className="py-5">
                            <div className="flex justify-between items-center mb-1">
                                <label className="app-label">Note (Optional)</label>
                                <span className="text-xs text-muted-foreground">{note.length}/200</span>
                            </div>
                            <textarea
                                maxLength={200}
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                rows={2}
                                className="dark-input block px-3 py-2 rounded-lg sm:text-sm"
                                placeholder="Add any extra details..."
                            />
                        </div>

                        {/* Receipt Upload */}
                        <div className="py-5">
                            <label className="app-label mb-2 block">Receipt Photo</label>
                            <div className="mt-1 flex justify-center px-6 py-4 border border-white/10 border-dashed rounded-xl hover:bg-white/[0.04] transition-colors">
                                <div className="space-y-1 text-center">
                                    <Receipt className="mx-auto h-8 w-8 text-muted-foreground" />
                                    <div className="flex text-sm text-muted-foreground justify-center">
                                        <label className="relative cursor-pointer bg-transparent rounded-md font-medium text-primary hover:text-primary/80 focus-within:outline-none">
                                            <span>{receiptFile ? receiptFile.name : 'Upload a file'}</span>
                                            <input type="file" className="sr-only" accept="image/jpeg, image/png, image/webp" onChange={e => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    if (file.size > 5 * 1024 * 1024) {
                                                        showError('File exceeds 5MB limit');
                                                        e.target.value = '';
                                                    } else {
                                                        setReceiptFile(file);
                                                    }
                                                } else {
                                                    setReceiptFile(null);
                                                }
                                            }} />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Recurring Toggle */}
                        <div className="flex items-center justify-between py-5">
                            <div className="flex items-center">
                                <Repeat className="w-5 h-5 text-muted-foreground mr-2" />
                                <span className="text-sm font-medium text-white">Recurring Expense</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} className="sr-only peer" />
                                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                            </label>
                        </div>

                        {isRecurring && (
                            <div className="flex space-x-2 pb-5">
                                {['weekly', 'monthly'].map((type) => (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => setRecurType(type as 'weekly' | 'monthly')}
                                        className={`flex-1 py-2 px-3 text-sm rounded-lg transition-colors ${recurType === type ? 'bg-primary text-white border border-primary' : 'bg-white/[0.04] text-muted-foreground border border-white/10 hover:text-white'
                                            }`}
                                    >
                                        {type.charAt(0).toUpperCase() + type.slice(1)}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Split Selection */}
                        <div className="py-5">
                            <label className="app-label mb-2 block">Split With</label>
                            <div className="bg-white/[0.03] rounded-xl border border-white/10 divide-y divide-[#1E1E1E]">
                                {members.map((member: { user_id: string; users: { full_name?: string } }) => (
                                    <label key={member.user_id} className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/[0.04] transition-colors">
                                        <div className="flex items-center">
                                            <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold mr-3 shadow-inner">
                                                {member.users.full_name?.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="text-sm font-medium text-white">
                                                {member.user_id === user?.id ? 'You' : member.users.full_name}
                                            </span>
                                        </div>
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={splitBetween.includes(member.user_id)}
                                                onChange={() => toggleSplitMember(member.user_id)}
                                                className="w-5 h-5 text-primary bg-white/10 border-white/20 rounded focus:ring-primary focus:ring-2"
                                            />
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Live Preview */}
                        <div className="bg-primary/10 p-3 rounded-xl border border-primary/20 flex items-center justify-between mt-5">
                            <span className="text-sm text-primary font-medium">Split equally among {splitBetween.length} members</span>
                            <span className="font-bold text-primary">₹{splitPreview} each</span>
                        </div>

                    </form>
                </div>

                <div className="p-4 border-t border-[#1E1E1E] bg-white/[0.03]">
                    <button
                        type="submit"
                        form="expense-form"
                        disabled={loadingState !== 'idle' || !amount || !description}
                        className="accent-button w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary focus:ring-offset-background"
                    >
                        {loadingState !== 'idle' ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : null}
                        {loadingState === 'compressing' ? 'Compressing...'
                            : loadingState === 'uploading' ? 'Uploading...'
                                : loadingState === 'saving' ? 'Saving...'
                                    : (editingExpense ? 'Save Changes' : 'Add Expense')}
                    </button>
                </div>
            </div>
        </div>
    );
}
