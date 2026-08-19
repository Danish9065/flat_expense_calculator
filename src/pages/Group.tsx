import React, { useState } from 'react';
import insforge from '../lib/db';
import { dbQuery, dbInsert, dbUpdate } from '../lib/db';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import { useToast } from '../context/ToastContext';
import ConfirmModal from '../components/ConfirmModal';
import { Copy, RefreshCw, Download, Users, Shield, User as UserIcon } from 'lucide-react';
import { format } from 'date-fns';
import SecureStorageImage from '../components/SecureStorageImage';

export default function GroupPage() {
    const { role, user } = useAuth();
    const { groupId, groupName, inviteCode, members, groups, switchGroup, refreshGroup } = useGroup();
    const { success, error: showError } = useToast();
    const [regenerating, setRegenerating] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const [joining, setJoining] = useState(false);

    const isAdmin = role === 'admin';


    const handleCreateGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setJoining(true);
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const groupName = (e.target as any).groupname.value.trim();
            if (!groupName) throw new Error('Group name required');
            const invCode = 'SPLIT-' + Math.random().toString(36).substring(2, 6).toUpperCase();
            // Insert group
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const newGroups: any = await dbInsert('groups', { name: groupName, invite_code: invCode, created_by: user.id });
            const newGroup = Array.isArray(newGroups) ? newGroups[0] : newGroups;
            if (!newGroup?.id) throw new Error('Failed to create group');
            // Add admin as member
            try {
                await insforge.database.from('users').upsert({ id: user.id, email: user.email, full_name: user?.full_name || 'Member' }, { onConflict: 'id' }).select();
            } catch { /* safe to ignore, user might already exist */ }

            await dbInsert('group_members', { group_id: newGroup.id, user_id: user.id });
            success('Group created successfully!');
            if (refreshGroup) await refreshGroup();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'Failed to create group');
        } finally {
            setJoining(false);
        }
    };

    const handleJoinGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!joinCode.trim() || !user) return;
        setJoining(true);
        try {
            // Ensure user exists in users table first (patch for early signups)
            try {
                await insforge.database.from('users').upsert({ id: user.id, email: user.email, full_name: user?.full_name || 'Member' }, { onConflict: 'id' }).select();
            } catch { /* safe to ignore, user might already exist */ }

            const { data: joinedGroupId, error: joinError } = await insforge.database.rpc('join_group_by_invite_code', {
                invite_code_param: joinCode.trim().toUpperCase(),
            });
            if (joinError || !joinedGroupId) throw new Error(joinError?.message || 'Invalid invite code');

            success('Joined group successfully!');
            await switchGroup(String(joinedGroupId));
            setJoinCode('');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'Failed to join group');
        } finally {
            setJoining(false);
        }
    };

    const copyToClipboard = () => {
        if (!inviteCode) return;
        navigator.clipboard.writeText(inviteCode);
        success('Invite code copied to clipboard!');
    };

    const handleRegenerateCode = async () => {
        setRegenerating(true);
        try {
            const newCode = Math.random().toString(36).substring(2, 10).toUpperCase();
            await dbUpdate('groups', `id=eq.${groupId}`, { invite_code: newCode });
            await refreshGroup();
            success('Invite code regenerated successfully');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'Error regenerating code');
        } finally {
            setRegenerating(false);
            setConfirmRegenOpen(false);
        }
    };

    const exportToCSV = async () => {
        if (!groupId) return;
        setExporting(true);
        try {
            // Fetch expenses with paid_by user info AND split info (including amount_owed)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const expenses: any = await dbQuery(
                'expenses',
                `group_id=eq.${groupId}&order=created_at.desc&select=*,users(full_name),expense_splits(user_id,amount_owed)`
            );

            if (!expenses || expenses.length === 0) {
                showError('No expenses to export');
                return;
            }

            const totalMemberCount = members.length;

            // Helper: resolve a user_id to full_name via the members context
            const resolveNameById = (userId: string): string => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const m = members.find((mem: any) => mem.user_id === userId);
                return m?.users?.full_name || userId;
            };

            // Build CSV
            const headers = ['Date', 'Item', 'Category', 'Amount', 'Paid By', 'For (Members)', 'Each Share', 'Note'];
            const csvRows = [headers.join(',')];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expenses.forEach((e: any) => {
                const date = e.created_at ? format(new Date(e.created_at), 'yyyy-MM-dd HH:mm:ss') : '';
                const note = e.note ? `"${e.note.replace(/"/g, '""')}"` : '';
                const item = `"${e.item_name.replace(/"/g, '""')}"`;

                // Paid By: prefer joined users.full_name (from added_by FK), fallback to member lookup
                const paidByName: string =
                    e.users?.full_name || resolveNameById(e.added_by) || 'Unknown';
                const paidByCell = `"${paidByName.replace(/"/g, '""')}"`;

                // For (Members): resolve split entries to names
                const splitEntries: { user_id: string; amount_owed: number }[] = e.expense_splits || [];
                let forCell: string;
                if (splitEntries.length === 0 || splitEntries.length >= totalMemberCount) {
                    forCell = 'All Members';
                } else {
                    const splitNames = splitEntries.map((s) => resolveNameById(s.user_id)).join('; ');
                    forCell = `"${splitNames.replace(/"/g, '""')}"`;
                }

                // Each Share: if all splits have the same amount → single value; otherwise name:amount pairs
                let shareCell: string;
                if (splitEntries.length === 0) {
                    shareCell = '';
                } else {
                    const amounts = splitEntries.map((s) => Number(s.amount_owed));
                    const allEqual = amounts.every((a) => a === amounts[0]);
                    if (allEqual) {
                        shareCell = `₹${amounts[0].toFixed(2)}`;
                    } else {
                        const parts = splitEntries.map(
                            (s) => `${resolveNameById(s.user_id)}:₹${Number(s.amount_owed).toFixed(2)}`
                        ).join('; ');
                        shareCell = `"${parts}"`;
                    }
                }

                const row = [
                    date,
                    item,
                    e.category,
                    e.amount,
                    paidByCell,
                    forCell,
                    shareCell,
                    note
                ];

                csvRows.push(row.join(','));
            });

            // ── Settlement rows ────────────────────────────────────────────
            // Fetch all settlements for this group (most recent first).
            // The table has no status column — every row is an implicit confirmed settlement.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const settlements: any = await dbQuery(
                'settlements',
                `group_id=eq.${groupId}&order=settled_at.desc&select=*`
            );

            const settlementRows: string[] = [];
            if (settlements && settlements.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                settlements.forEach((s: any) => {
                    const date = s.settled_at
                        ? format(new Date(s.settled_at), 'yyyy-MM-dd HH:mm:ss')
                        : '';
                    const item = '"Settlement Payment"';
                    const category = 'Settlement';
                    const amount = Number(s.amount).toFixed(2);
                    const paidBy = `"${resolveNameById(s.paid_by).replace(/"/g, '""')}"`;
                    const forMember = `"${resolveNameById(s.paid_to).replace(/"/g, '""')}"`;
                    const eachShare = Number(s.amount).toFixed(2);
                    const note = '"Settled ✓"';

                    settlementRows.push([date, item, category, amount, paidBy, forMember, eachShare, note].join(','));
                });
            }

            // Build final CSV: settlement rows (newest first) then expense rows
            const allDataRows = [...settlementRows, ...csvRows.slice(1)];
            const finalCsvRows = [csvRows[0], ...allDataRows];

            // Debug: log the first data row so you can verify values in the browser console
            if (finalCsvRows.length > 1) {
                console.log('[CSV Export] Headers:', finalCsvRows[0]);
                console.log('[CSV Export] First row:', finalCsvRows[1]);
            }

            const csvContent = finalCsvRows.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${groupName.replace(/\s+/g, '_')}_expenses.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            success('Export downloaded successfully');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'Export failed');
        } finally {
            setExporting(false);
        }
    };

    if (!groupId && !isAdmin) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-center min-h-screen">
                <Users className="w-16 h-16 text-white/15 mb-4" />
                <h2 className="text-xl font-bold text-white">You're not in a group yet</h2>
                <p className="text-muted-foreground mt-2 mb-6">Ask your admin for an invite code</p>
                <form onSubmit={handleJoinGroup} className="w-full max-w-sm space-y-3">
                    <div>
                        <label className="app-label mb-2 block">Invite Code</label>
                        <input
                            type="text" value={joinCode}
                            onChange={e => setJoinCode(e.target.value)}
                            placeholder="SPLIT-XXXX"
                            className="dark-input px-4 py-2 rounded-xl text-center tracking-widest font-mono uppercase"
                        />
                    </div>
                    <button type="submit" disabled={joining || !joinCode.trim()}
                        className="accent-button w-full py-2.5 px-4 rounded-xl font-medium">
                        {joining ? 'Joining...' : 'Join Group'}
                    </button>
                </form>
            </div>
        );
    }

    return (
        <div className="app-section pb-28 min-h-screen space-y-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 text-center md:text-left mb-2">
                <div>
                    <p className="app-label mb-3">Flat and members</p>
                    <h1 className="app-title">Group Details</h1>
                </div>
                {groups && groups.length > 1 && (
                    <select
                        value={groupId}
                        onChange={(e) => switchGroup(e.target.value)}
                        className="dark-input text-sm font-medium rounded-lg px-3 py-2 focus:outline-none"
                    >
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {groups.map((g: any) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                )}
            </div>

            {groupId && (
                <>
                    {/* Invite Code Section */}
                    <div className="app-panel p-6 lg:p-8 text-center">
                        <h2 className="app-label mb-3">
                            Group Invite Code
                        </h2>
                        <div className="flex justify-center items-center space-x-3 mb-4">
                            <span className="text-4xl font-mono font-black text-primary tracking-widest bg-primary/10 px-4 py-2 rounded-xl border border-primary/20">
                                {inviteCode}
                            </span>
                        </div>

                        <div className="flex justify-center space-x-3">
                            <button
                                onClick={copyToClipboard}
                                className="ghost-button flex items-center px-4 py-2 rounded-lg text-sm font-medium"
                            >
                                <Copy className="w-4 h-4 mr-2" /> Copy
                            </button>
                            {isAdmin && (
                                <button
                                    onClick={() => setConfirmRegenOpen(true)}
                                    disabled={regenerating}
                                    className="flex items-center px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-sm font-medium transition-colors disabled:opacity-50 border border-primary/20"
                                >
                                    <RefreshCw className={`w-4 h-4 mr-2 ${regenerating ? 'animate-spin' : ''}`} />
                                    Reset
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Group Members */}
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-white flex items-center">
                                <Users className="w-5 h-5 mr-2 text-primary" />
                                Members ({members.length})
                            </h2>
                        </div>

                        <div className="app-panel overflow-hidden divide-y divide-[#1E1E1E]">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {members.map((member: any) => {
                                const mUser = member.users;
                                const fallbackInitial = mUser?.full_name?.charAt(0) || 'U';
                                // Since role isn't accessible via the join sometimes due to RLS, checking role locally requires an admin RPC. We will just use the available data or assume member.
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ }
                                const isMemberAdmin = mUser ? (mUser as any).role === 'admin' : false;

                                return (
                                    <div key={member.user_id} className="p-4 flex items-center justify-between">
                                        <div className="flex items-center space-x-3">
                                            <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-lg overflow-hidden shrink-0">
                                                {mUser?.avatar_url ? (
                                                    <SecureStorageImage source={mUser.avatar_url} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    fallbackInitial
                                                )}
                                            </div>
                                            <div>
                                                <p className="font-medium text-white">
                                                    {mUser?.full_name || 'Unknown Member'}
                                                </p>
                                                <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                                                    {mUser?.email || `ID: ${member.user_id.substring(0, 8)}...`}
                                                </p>
                                            </div>
                                        </div>
                                        <div>
                                            {isMemberAdmin ? (
                                                <span className="flex items-center text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 px-2 py-1 rounded-md">
                                                    <Shield className="w-3 h-3 mr-1" /> Admin
                                                </span>
                                            ) : (
                                                <span className="flex items-center text-xs font-medium text-muted-foreground bg-white/[0.06] px-2 py-1 rounded-md">
                                                    <UserIcon className="w-3 h-3 mr-1" /> Member
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Export */}
                    <div>
                        <button
                            onClick={exportToCSV}
                            disabled={exporting}
                            className="w-full flex justify-center items-center py-3.5 px-4 border border-primary/40 text-primary hover:bg-primary hover:text-white rounded-xl shadow-sm text-sm font-bold focus:outline-none transition-colors disabled:opacity-50"
                        >
                            {exporting ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : <Download className="w-5 h-5 mr-2" />}
                            Export All Expenses to CSV
                        </button>
                    </div>
                </>
            )}

            {/* Join Another Group (Members Only) */}
            {!isAdmin && (
                <div className="app-panel p-6 mt-8">
                    <h2 className="text-lg font-bold text-white flex items-center mb-1">
                        Join Another Group
                    </h2>
                    <p className="app-subtitle mb-4">Got an invite code for a different flat?</p>
                    <form onSubmit={handleJoinGroup} className="space-y-3">
                        <div>
                            <input
                                type="text" value={joinCode} required
                                onChange={e => setJoinCode(e.target.value)}
                                placeholder="SPLIT-XXXX"
                                className="dark-input px-4 py-2 rounded-xl tracking-widest font-mono uppercase"
                            />
                        </div>
                        <button type="submit" disabled={joining || !joinCode.trim()}
                            className="accent-button w-full py-2.5 px-4 rounded-xl font-medium">
                            {joining ? 'Joining...' : 'Join Group'}
                        </button>
                    </form>
                </div>
            )}

            {/* Admin: Create New Group */}
            {isAdmin && (
                <div className="app-panel p-6 mt-8">
                    <h2 className="text-lg font-bold text-white flex items-center mb-1">
                        Create Another Group
                    </h2>
                    <p className="app-subtitle mb-4">Manage multiple properties or flatmates</p>
                    <form onSubmit={handleCreateGroup} className="space-y-3">
                        <div>
                            <input
                                type="text" name="groupname" required
                                placeholder="New Group Name"
                                className="dark-input px-4 py-2 rounded-xl"
                            />
                        </div>
                        <button type="submit" disabled={joining}
                            className="accent-button w-full py-2.5 px-4 rounded-xl font-medium">
                            {joining ? 'Creating...' : 'Create New Group'}
                        </button>
                    </form>
                </div>
            )}

            <ConfirmModal
                isOpen={confirmRegenOpen}
                onClose={() => setConfirmRegenOpen(false)}
                onConfirm={handleRegenerateCode}
                title="Regenerate Invite Code"
                message="Are you sure you want to change the group's invite code? Old invite links combining your URL and the previous code will stop working immediately."
                confirmText="Regenerate"
                requireWordOption="RESET"
            />
        </div>
    );
}
