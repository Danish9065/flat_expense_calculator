import React, { useState, useEffect } from 'react';
import insforge from '../lib/db';
import { dbQuery, dbInsert, dbUpdate, dbDelete } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useGroup } from '../context/GroupContext';
import { generateInviteKey } from '../utils/invite';
import { Key, Shield, RefreshCw, CheckCircle2, Clock, Trash2, Users, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import ConfirmModal from '../components/ConfirmModal';

export default function Admin() {
    const { user, role } = useAuth();
    const { groupId } = useGroup();
    const { success, error: showError } = useToast();

    const [keys, setKeys] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [assignToName, setAssignToName] = useState(''); // Added state for assigned_to text input
    const [users, setUsers] = useState<any[]>([]);
    const [userToDelete, setUserToDelete] = useState<any>(null);
    const [deleting, setDeleting] = useState(false);
    const [showDeleteAllExpenses, setShowDeleteAllExpenses] = useState(false);
    const [deletingExpenses, setDeletingExpenses] = useState(false);

    const handleDeleteAllExpenses = async () => {
        if (!groupId) return;
        setDeletingExpenses(true);
        try {
            await dbDelete('expenses', `group_id=eq.${groupId}`);
            await dbDelete('settlements', `group_id=eq.${groupId}`);
            success('All expenses and settlements deleted successfully!');
            setShowDeleteAllExpenses(false);
        } catch (err: any) {
            showError(err.message || 'Failed to delete expenses');
        } finally {
            setDeletingExpenses(false);
        }
    };


    const fetchUsers = async () => {
        try {
            const data = await dbQuery('users', 'select=id,full_name,role,created_at&order=created_at.asc');
            setUsers(data || []);
        } catch (err: any) {
            showError('Failed to load users');
        }
    };

    const fetchKeys = async () => {
        try {
            setLoading(true);
            const data = await dbQuery('invite_keys', 'select=*,users!invite_keys_used_by_fkey(full_name)&order=created_at.desc');
            setKeys(data || []);
        } catch (err: any) {
            showError('Failed to load invite keys');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (role === 'admin') {
            fetchKeys();
            fetchUsers();
        }
    }, [role]);

    const handleGenerateKey = async () => {
        if (!user) return;
        setGenerating(true);
        try {
            const newKey = generateInviteKey();

            const { error } = await insforge.database
                .from('invite_keys')
                .insert({
                    key_code: newKey,
                    created_by: user.id,
                    assigned_to: assignToName.trim() || null
                });

            if (error) throw new Error(error.message);

            success(`Generated new key: ${newKey}`);
            setAssignToName(''); // Clear input after success
            fetchKeys();
        } catch (err: any) {
            showError(err.message || 'Failed to generate key');
        } finally {
            setGenerating(false);
        }
    };

    const handleDeleteUser = async () => {
        if (!userToDelete) return;
        setDeleting(true);
        try {
            // Database is heavily configured with ON DELETE CASCADE / SET NULL
            // Simply deleting the user will securely auto-wipe all associated splits and settlements
            await dbDelete('users', `id=eq.${userToDelete.id}`);

            success(`${userToDelete.full_name} deleted successfully`);
            setUserToDelete(null);
            fetchUsers();
        } catch (err: any) {
            showError(err.message || 'Failed to delete user');
        } finally {
            setDeleting(false);
        }
    };

    if (role !== 'admin') {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center h-[80vh]">
                <Shield className="w-16 h-16 text-danger mb-4" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Access Denied</h2>
                <p className="text-gray-500 mt-2">You need administrator privileges to view this page.</p>
            </div>
        );
    }

    return (
        <div className="pb-24 pt-6 px-4 max-w-lg mx-auto min-h-screen space-y-6">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center">
                    <Shield className="w-6 h-6 mr-2 text-primary" />
                    Admin Panel
                </h1>
            </div>

            <div className="bg-card dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                        <Key className="w-5 h-5 mr-2 text-primary" />
                        Invite Keys
                    </h2>
                    <div className="flex w-full sm:w-auto gap-2">
                        <input
                            type="text"
                            placeholder="Assign to (optional)..."
                            value={assignToName}
                            onChange={(e) => setAssignToName(e.target.value)}
                            className="flex-1 sm:w-48 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-primary focus:border-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        />
                        <button
                            onClick={handleGenerateKey}
                            disabled={generating}
                            className="flex items-center px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                            {generating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Key className="w-4 h-4 mr-2" />}
                            New Key
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-8"><RefreshCw className="w-6 h-6 animate-spin text-gray-400" /></div>
                ) : keys.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No invite keys found.</div>
                ) : (
                    <div className="space-y-3">
                        {keys.map((key) => {
                            const usedByName = key.users?.full_name;
                            const isUsed = key.is_used;
                            const isExpired = key.expires_at && new Date(key.expires_at) < new Date();

                            return (
                                <div key={key.id} className={`p-4 rounded-xl border ${isUsed ? 'bg-gray-50 border-gray-100 dark:bg-gray-800/50 dark:border-gray-700' : 'bg-white border-primary/20 dark:bg-gray-800'}`}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <code className="font-mono text-lg font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                                                {key.key_code}
                                            </code>
                                            <p className="text-xs text-gray-500 mt-2">
                                                Created {format(new Date(key.created_at), 'MMM d, yyyy')}
                                            </p>
                                        </div>
                                        <div>
                                            {isUsed ? (
                                                <span className="flex items-center text-xs font-medium text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-md">
                                                    <CheckCircle2 className="w-3 h-3 mr-1" /> Used
                                                </span>
                                            ) : isExpired ? (
                                                <span className="flex items-center text-xs font-medium text-danger bg-danger/10 px-2 py-1 rounded-md">
                                                    <Clock className="w-3 h-3 mr-1" /> Expired
                                                </span>
                                            ) : (
                                                <span className="flex items-center text-xs font-medium text-success bg-success/10 px-2 py-1 rounded-md">
                                                    <CheckCircle2 className="w-3 h-3 mr-1" /> Active
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {isUsed && (
                                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50 text-sm flex items-center text-gray-600 dark:text-gray-400">
                                            Used by: <span className="font-medium text-gray-900 dark:text-gray-200 ml-1">{usedByName || 'Unknown'}</span>
                                        </div>
                                    )}
                                    {!isUsed && key.assigned_to && (
                                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50 text-sm flex items-center text-gray-600 dark:text-gray-400">
                                            Assigned to: <span className="font-medium text-gray-900 dark:text-gray-200 ml-1">{key.assigned_to}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Users Section */}
            <div className="mt-8">
                <div className="flex items-center gap-2 mb-4">
                    <Users className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Manage Users</h2>
                </div>
                <div className="space-y-2">
                    {users.map(u => (
                        <div key={u.id} className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-xl px-4 py-3 border border-gray-100 dark:border-gray-700">
                            <div>
                                <p className="font-medium text-gray-900 dark:text-white">{u.full_name}</p>
                                <p className="text-xs text-gray-400 capitalize">{u.role}</p>
                            </div>
                            {u.id !== user?.id && (
                                <button
                                    onClick={() => setUserToDelete(u)}
                                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    ))}
                    {users.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-4">No users found</p>
                    )}
                </div>
            </div>

            {/* Danger Zone Section */}
            <div className="mt-8">
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5 text-danger" />
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Danger Zone</h2>
                </div>
                <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-2xl p-5">
                    <div className="flex flex-col mb-4">
                        <h3 className="font-bold text-gray-900 dark:text-white mb-1">Delete All Expenses</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Permanently remove all expenses, splits, and settlements for this group. This will completely reset the balances.
                        </p>
                    </div>
                    <button
                        onClick={() => setShowDeleteAllExpenses(true)}
                        disabled={!groupId || deletingExpenses}
                        className="w-full flex justify-center items-center py-2.5 px-4 font-bold rounded-xl text-white bg-danger hover:bg-danger/90 disabled:opacity-50 transition-all shadow-sm"
                    >
                        {deletingExpenses ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5 mr-2" />}
                        {deletingExpenses ? 'Deleting...' : 'Wipe All Group Data'}
                    </button>
                </div>
            </div>

            <ConfirmModal
                isOpen={!!userToDelete}
                onClose={() => setUserToDelete(null)}
                onConfirm={handleDeleteUser}
                title="Delete User"
                confirmText="Delete"
                message={`Are you sure you want to permanently delete ${userToDelete?.full_name}? This will also remove them from the group.`}
            />

            <ConfirmModal
                isOpen={showDeleteAllExpenses}
                onClose={() => setShowDeleteAllExpenses(false)}
                onConfirm={handleDeleteAllExpenses}
                title="Delete All Expenses"
                confirmText="Wipe Data"
                message="Are you absolutely sure you want to delete ALL expenses, splits, and settlements for this group? This action cannot be undone and balances will be reset to zero."
            />
        </div>
    );
}