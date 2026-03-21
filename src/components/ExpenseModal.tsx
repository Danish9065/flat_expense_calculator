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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4 sm:p-0">
            <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b border-gray-100 dark:border-gray-700">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        {editingExpense ? 'Edit Expense' : 'Add Expense'}
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-4 overflow-y-auto">
                    <form id="expense-form" onSubmit={handleSubmit} className="space-y-5">

                        {/* Amount */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <span className="text-gray-500 sm:text-lg">₹</span>
                                </div>
                                <input
                                    autoFocus
                                    required
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                    className="block w-full pl-8 pr-3 py-3 text-lg font-bold border border-gray-300 rounded-xl focus:ring-primary focus:border-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        {/* Category Select */}
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Category</label>
                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="w-full bg-gray-50 dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 text-gray-900 dark:text-white rounded-xl px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
                            >
                                {CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>

                        {/* Item Name */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">What was it for?</label>
                            <input
                                required
                                type="text"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary focus:border-primary sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                placeholder="e.g. Groceries, Electricity Bill"
                            />
                        </div>

                        {/* Note */}
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Note (Optional)</label>
                                <span className="text-xs text-gray-500">{note.length}/200</span>
                            </div>
                            <textarea
                                maxLength={200}
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                rows={2}
                                className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary focus:border-primary sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                placeholder="Add any extra details..."
                            />
                        </div>

                        {/* Receipt Upload */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Receipt Photo</label>
                            <div className="mt-1 flex justify-center px-6 py-4 border-2 border-gray-300 border-dashed rounded-lg dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                <div className="space-y-1 text-center">
                                    <Receipt className="mx-auto h-8 w-8 text-gray-400" />
                                    <div className="flex text-sm text-gray-600 dark:text-gray-400 justify-center">
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
                        <div className="flex items-center justify-between py-2 border-t border-gray-100 dark:border-gray-700">
                            <div className="flex items-center">
                                <Repeat className="w-5 h-5 text-gray-400 mr-2" />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Recurring Expense</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} className="sr-only peer" />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                            </label>
                        </div>

                        {isRecurring && (
                            <div className="flex space-x-2 mt-2">
                                {['weekly', 'monthly'].map((type) => (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => setRecurType(type as 'weekly' | 'monthly')}
                                        className={`flex-1 py-1 px-3 text-sm rounded-md transition-colors ${recurType === type ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-gray-50 text-gray-600 border border-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300'
                                            }`}
                                    >
                                        {type.charAt(0).toUpperCase() + type.slice(1)}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Split Selection */}
                        <div className="pt-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Split With</label>
                            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                                {members.map((member: { user_id: string; users: { full_name?: string } }) => (
                                    <label key={member.user_id} className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                        <div className="flex items-center">
                                            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold mr-3 shadow-inner">
                                                {member.users.full_name?.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                {member.user_id === user?.id ? 'You' : member.users.full_name}
                                            </span>
                                        </div>
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={splitBetween.includes(member.user_id)}
                                                onChange={() => toggleSplitMember(member.user_id)}
                                                className="w-5 h-5 text-primary bg-gray-100 border-gray-300 rounded focus:ring-primary dark:focus:ring-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                            />
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Live Preview */}
                        <div className="bg-primary/5 dark:bg-primary/10 p-3 rounded-lg border border-primary/10 flex items-center justify-between">
                            <span className="text-sm text-primary font-medium">Split equally among {splitBetween.length} members</span>
                            <span className="font-bold text-primary">₹{splitPreview} each</span>
                        </div>

                    </form>
                </div>

                <div className="p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <button
                        type="submit"
                        form="expense-form"
                        disabled={loadingState !== 'idle' || !amount || !description}
                        className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
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
