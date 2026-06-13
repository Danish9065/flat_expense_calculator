import React, { useState, useEffect, useCallback } from 'react';
import insforge from '../lib/db';
import { dbQuery, dbDelete } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useGroup } from '../context/GroupContext';
import { generateInviteKey } from '../utils/invite';
import { Key, Shield, RefreshCw, CheckCircle2, Clock, Trash2, Users, AlertTriangle, UserMinus } from 'lucide-react';
import { format } from 'date-fns';
import ConfirmModal from '../components/ConfirmModal';
import { notifyGroupDataChanged } from '../hooks/useRealtimeSync';
import { SettlementService } from '../services/settlementService';

interface InviteKeyRow {
    id: string;
    key_code: string;
    is_used: boolean;
    expires_at?: string | null;
    created_at: string;
    assigned_to?: string | null;
    users?: { full_name?: string } | null;
}

interface AdminUserRow {
    id: string;
    full_name?: string;
    role?: string;
    created_at?: string;
}

export default function Admin() {
    const { user, role } = useAuth();
    const { groupId, refreshGroup, members } = useGroup();
    const { success, error: showError } = useToast();

    const [keys, setKeys] = useState<InviteKeyRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [assignToName, setAssignToName] = useState(''); // Added state for assigned_to text input
    const [users, setUsers] = useState<AdminUserRow[]>([]);
    const [userToDelete, setUserToDelete] = useState<AdminUserRow | null>(null);
    const [userToRemove, setUserToRemove] = useState<AdminUserRow | null>(null);
    const [removeWarning, setRemoveWarning] = useState<string>('');
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
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Failed to delete expenses');
        } finally {
            setDeletingExpenses(false);
        }
    };


    const fetchUsers = useCallback(async () => {
        try {
            const data = await dbQuery('users', 'select=id,full_name,role,created_at&order=created_at.asc');
            setUsers((data || []) as AdminUserRow[]);
        } catch {
            showError('Failed to load users');
        }
    }, [showError]);

    const fetchKeys = useCallback(async () => {
        try {
            setLoading(true);
            const data = await dbQuery('invite_keys', 'select=*,users!invite_keys_used_by_fkey(full_name)&order=created_at.desc');
            setKeys((data || []) as InviteKeyRow[]);
        } catch {
            showError('Failed to load invite keys');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        if (role === 'admin') {
            fetchKeys();
            fetchUsers();
        }
    }, [role, fetchKeys, fetchUsers]);

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
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Failed to generate key');
        } finally {
            setGenerating(false);
        }
    };

    const handleDeleteUser = async () => {
        if (!userToDelete) return;
        try {
            // Database is heavily configured with ON DELETE CASCADE / SET NULL
            // Simply deleting the user will securely auto-wipe all associated splits and settlements
            await dbDelete('users', `id=eq.${userToDelete.id}`);

            success(`${userToDelete.full_name} deleted successfully`);
            setUserToDelete(null);
            fetchUsers();
            
            // Refresh group context and notify other clients so the user is instantly removed from UI
            if (refreshGroup) {
                await refreshGroup();
            }
            if (groupId) {
                await notifyGroupDataChanged(groupId);
            }
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Failed to delete user');
        }
    };

    const checkAndPromptRemove = async (u: AdminUserRow) => {
        try {
            const calcSettlements = await SettlementService.calculateGroupSettlements(groupId || '', members, 'All');
            let owes = 0;
            let owed = 0;
            calcSettlements.forEach(s => {
                if (s.from === u.id) owes += s.amount;
                if (s.to === u.id) owed += s.amount;
            });

            if (owes > 0 || owed > 0) {
                let msg = `${u.full_name} `;
                if (owes > 0 && owed > 0) msg += `still owes ₹${owes.toFixed(2)} and is owed ₹${owed.toFixed(2)}. `;
                else if (owes > 0) msg += `still owes ₹${owes.toFixed(2)}. `;
                else msg += `is still owed ₹${owed.toFixed(2)}. `;
                msg += "Removing them will preserve this debt as 'Pending Settlement' in the Balances tab. Continue?";
                setRemoveWarning(msg);
            } else {
                setRemoveWarning(`Are you sure you want to remove ${u.full_name} from this group? Their past expenses will remain but they will lose access.`);
            }
            setUserToRemove(u);
        } catch (err) {
            showError('Failed to check balances');
        }
    };

    const handleRemoveFromGroup = async () => {
        if (!userToRemove || !groupId) return;
        try {
            await dbDelete('group_members', `group_id=eq.${groupId}&user_id=eq.${userToRemove.id}`);
            success(`${userToRemove.full_name} removed from the group successfully`);
            setUserToRemove(null);
            fetchUsers();
            
            if (refreshGroup) await refreshGroup();
            await notifyGroupDataChanged(groupId);
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Failed to remove user from group');
        }
    };

    if (role !== 'admin') {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center h-[80vh]">
                <Shield className="w-16 h-16 text-danger mb-4" />
                <h2 className="text-xl font-bold text-white">Access Denied</h2>
                <p className="text-muted-foreground mt-2">You need administrator privileges to view this page.</p>
            </div>
        );
    }

    return (
        <div className="app-section pb-28 min-h-screen space-y-8">
            <div className="text-center mb-8">
                <p className="app-label mb-3">Secure management</p>
                <h1 className="app-title flex items-center justify-center">
                    <Shield className="w-6 h-6 mr-2 text-primary" />
                    Admin Panel
                </h1>
            </div>

            <div className="app-panel p-6 lg:p-8">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                    <h2 className="text-lg font-bold text-white flex items-center">
                        <Key className="w-5 h-5 mr-2 text-primary" />
                        Invite Keys
                    </h2>
                    <div className="flex w-full sm:w-auto gap-2">
                        <input
                            type="text"
                            placeholder="Assign to (optional)..."
                            value={assignToName}
                            onChange={(e) => setAssignToName(e.target.value)}
                            className="dark-input flex-1 sm:w-48 px-3 py-2 text-sm rounded-lg"
                        />
                        <button
                            onClick={handleGenerateKey}
                            disabled={generating}
                            className="accent-button flex items-center px-4 py-2 text-sm font-bold rounded-lg whitespace-nowrap"
                        >
                            {generating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Key className="w-4 h-4 mr-2" />}
                            New Key
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-8"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : keys.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">No invite keys found.</div>
                ) : (
                    <div className="space-y-3">
                        {keys.map((key) => {
                            const usedByName = key.users?.full_name;
                            const isUsed = key.is_used;
                            const isExpired = key.expires_at && new Date(key.expires_at) < new Date();

                            return (
                                <div key={key.id} className={`p-4 rounded-2xl border ${isUsed ? 'bg-white/[0.03] border-white/10' : 'bg-primary/10 border-primary/25'}`}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <code className="font-mono text-lg font-bold text-white bg-white/10 px-2 py-1 rounded">
                                                {key.key_code}
                                            </code>
                                            <p className="text-xs text-muted-foreground mt-2">
                                                Created {format(new Date(key.created_at), 'MMM d, yyyy')}
                                            </p>
                                        </div>
                                        <div>
                                            {isUsed ? (
                                                <span className="flex items-center text-xs font-medium text-muted-foreground bg-white/[0.06] px-2 py-1 rounded-md">
                                                    <CheckCircle2 className="w-3 h-3 mr-1" /> Used
                                                </span>
                                            ) : isExpired ? (
                                                <span className="flex items-center text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-md">
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
                                        <div className="mt-3 pt-3 border-t border-[#1E1E1E] text-sm flex items-center text-muted-foreground">
                                            Used by: <span className="font-medium text-white ml-1">{usedByName || 'Unknown'}</span>
                                        </div>
                                    )}
                                    {!isUsed && key.assigned_to && (
                                        <div className="mt-3 pt-3 border-t border-[#1E1E1E] text-sm flex items-center text-muted-foreground">
                                            Assigned to: <span className="font-medium text-white ml-1">{key.assigned_to}</span>
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
                    <h2 className="text-lg font-bold text-white">Manage Users</h2>
                </div>
                <div className="space-y-2">
                    {users.map(u => (
                        <div key={u.id} className="flex items-center justify-between bg-card rounded-2xl px-4 py-3 border border-white/10">
                            <div>
                                <p className="font-medium text-white">{u.full_name}</p>
                                <p className="text-xs text-muted-foreground capitalize">{u.role}</p>
                            </div>
                            {u.id !== user?.id && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => checkAndPromptRemove(u)}
                                        className="p-2 text-warning hover:text-warning/80 hover:bg-warning/10 rounded-lg transition-colors"
                                        title="Remove from Group"
                                    >
                                        <UserMinus className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => setUserToDelete(u)}
                                        className="p-2 text-primary hover:text-primary/80 hover:bg-primary/10 rounded-lg transition-colors"
                                        title="Delete Entire Account"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                    {users.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">No users found</p>
                    )}
                </div>
            </div>

            {/* Danger Zone Section */}
            <div className="mt-8">
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5 text-danger" />
                    <h2 className="text-lg font-bold text-white">Danger Zone</h2>
                </div>
                <div className="bg-primary/10 border border-primary/25 rounded-2xl p-5">
                    <div className="flex flex-col mb-4">
                        <h3 className="font-bold text-white mb-1">Delete All Expenses</h3>
                        <p className="app-subtitle">
                            Permanently remove all expenses, splits, and settlements for this group. This will completely reset the balances.
                        </p>
                    </div>
                    <button
                        onClick={() => setShowDeleteAllExpenses(true)}
                        disabled={!groupId || deletingExpenses}
                        className="danger-button w-full flex justify-center items-center py-2.5 px-4 font-bold rounded-xl transition-all shadow-sm"
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
                isDestructive={true}
            />

            <ConfirmModal
                isOpen={!!userToRemove}
                onClose={() => setUserToRemove(null)}
                onConfirm={handleRemoveFromGroup}
                title="Remove User from Group"
                message={removeWarning}
                confirmText="Remove from Group"
                isDestructive={true}
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
