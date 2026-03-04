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
                await insforge.database.from('users').upsert({ id: user.id, email: user.email, full_name: user?.full_name || 'Admin', role: 'admin' }, { onConflict: 'id' }).select();
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
            // Find group by invite code
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const groupList: any = await dbQuery('groups', `invite_code=eq.${joinCode.toUpperCase()}&select=id`);
            const group = groupList?.[0];

            if (!group) throw new Error('Invalid invite code');

            // Ensure user exists in users table first (patch for early signups)
            try {
                await insforge.database.from('users').upsert({ id: user.id, email: user.email, full_name: user?.full_name || 'Member', role: 'member' }, { onConflict: 'id' }).select();
            } catch { /* safe to ignore, user might already exist */ }

            // Insert member
            await dbInsert('group_members', { group_id: group.id, user_id: user.id });

            success('Joined group successfully!');
            await switchGroup(group.id);
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const expenses: any = await dbQuery('expenses', `group_id=eq.${groupId}&select=*&order=created_at.desc`);

            if (!expenses || expenses.length === 0) {
                showError('No expenses to export');
                return;
            }

            // Build CSV
            const headers = ['Date', 'Item', 'Category', 'Amount', 'Added By (User ID)', 'Name', 'Email', 'Note'];
            const csvRows = [headers.join(',')];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expenses.forEach((e: any) => {
                const date = e.created_at ? format(new Date(e.created_at), 'yyyy-MM-dd HH:mm:ss') : '';
                const note = e.note ? `"${e.note.replace(/"/g, '""')}"` : '';
                const item = `"${e.item_name.replace(/"/g, '""')}"`;

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const memberInfo = members.find((m: any) => m.user_id === e.added_by)?.users;
                const name = memberInfo?.full_name ? `"${memberInfo.full_name.replace(/"/g, '""')}"` : 'Unknown';
                const email = memberInfo?.email ? `"${memberInfo.email.replace(/"/g, '""')}"` : 'Unknown';

                csvRows.push([
                    date,
                    item,
                    e.category,
                    e.amount,
                    e.added_by,
                    name,
                    email,
                    note
                ].join(','));
            });

            const csvContent = csvRows.join('\n');
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
                <Users className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">You're not in a group yet</h2>
                <p className="text-gray-500 dark:text-gray-400 mt-2 mb-6">Ask your admin for an invite code</p>
                <form onSubmit={handleJoinGroup} className="w-full max-w-sm space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invite Code</label>
                        <input
                            type="text" value={joinCode}
                            onChange={e => setJoinCode(e.target.value)}
                            placeholder="SPLIT-XXXX"
                            className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-primary focus:border-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center tracking-widest font-mono uppercase"
                        />
                    </div>
                    <button type="submit" disabled={joining || !joinCode.trim()}
                        className="w-full py-2.5 px-4 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                        {joining ? 'Joining...' : 'Join Group'}
                    </button>
                </form>
            </div>
        );
    }

    return (
        <div className="pb-24 pt-6 px-4 max-w-lg mx-auto min-h-screen space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Group Details</h1>
                {groups && groups.length > 1 && (
                    <select
                        value={groupId}
                        onChange={(e) => switchGroup(e.target.value)}
                        className="bg-gray-50 dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
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
                    <div className="bg-card dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 text-center">
                        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
                            Group Invite Code
                        </h2>
                        <div className="flex justify-center items-center space-x-3 mb-4">
                            <span className="text-4xl font-mono font-black text-primary tracking-widest bg-primary/5 px-4 py-2 rounded-xl">
                                {inviteCode}
                            </span>
                        </div>

                        <div className="flex justify-center space-x-3">
                            <button
                                onClick={copyToClipboard}
                                className="flex items-center px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors"
                            >
                                <Copy className="w-4 h-4 mr-2" /> Copy
                            </button>
                            {isAdmin && (
                                <button
                                    onClick={() => setConfirmRegenOpen(true)}
                                    disabled={regenerating}
                                    className="flex items-center px-4 py-2 bg-danger/10 hover:bg-danger/20 text-danger rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
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
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                                <Users className="w-5 h-5 mr-2 text-primary" />
                                Members ({members.length})
                            </h2>
                        </div>

                        <div className="bg-card dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
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
                                            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg overflow-hidden shrink-0">
                                                {mUser?.avatar_url ? (
                                                    <img src={mUser.avatar_url} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    fallbackInitial
                                                )}
                                            </div>
                                            <div>
                                                <p className="font-medium text-gray-900 dark:text-white">
                                                    {mUser?.full_name || 'Unknown Member'}
                                                </p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]">
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
                                                <span className="flex items-center text-xs font-medium text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-400 px-2 py-1 rounded-md">
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
                            className="w-full flex justify-center items-center py-3.5 px-4 border-2 border-primary text-primary hover:bg-primary hover:text-white rounded-xl shadow-sm text-sm font-bold focus:outline-none transition-colors disabled:opacity-50"
                        >
                            {exporting ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : <Download className="w-5 h-5 mr-2" />}
                            Export All Expenses to CSV
                        </button>
                    </div>
                </>
            )}

            {/* Join Another Group (Members Only) */}
            {!isAdmin && (
                <div className="bg-card dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 mt-8">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center mb-1">
                        Join Another Group
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Got an invite code for a different flat?</p>
                    <form onSubmit={handleJoinGroup} className="space-y-3">
                        <div>
                            <input
                                type="text" value={joinCode} required
                                onChange={e => setJoinCode(e.target.value)}
                                placeholder="SPLIT-XXXX"
                                className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-primary focus:border-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white tracking-widest font-mono uppercase"
                            />
                        </div>
                        <button type="submit" disabled={joining || !joinCode.trim()}
                            className="w-full py-2.5 px-4 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                            {joining ? 'Joining...' : 'Join Group'}
                        </button>
                    </form>
                </div>
            )}

            {/* Admin: Create New Group */}
            {isAdmin && (
                <div className="bg-card dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 mt-8">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center mb-1">
                        Create Another Group
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Manage multiple properties or flatmates</p>
                    <form onSubmit={handleCreateGroup} className="space-y-3">
                        <div>
                            <input
                                type="text" name="groupname" required
                                placeholder="New Group Name"
                                className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-primary focus:border-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            />
                        </div>
                        <button type="submit" disabled={joining}
                            className="w-full py-2.5 px-4 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
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
