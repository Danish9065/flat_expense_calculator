import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, History, Coffee, Activity, Trash2, Check, Banknote } from 'lucide-react';
import { useGroup } from '../context/GroupContext';
import { useAuth } from '../context/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { dbQuery, dbUpdate, dbDelete } from '../lib/db';

interface ActivityDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onUnreadChange: (count: number) => void;
}

interface ActivityEvent {
    id: string;
    type: string;
    message: string;
    actor_id: string;
    group_id: string;
    created_at: string;
    is_read: boolean;
    groups?: { name: string } | null;
}

export default function ActivityDrawer({ isOpen, onClose, onUnreadChange }: ActivityDrawerProps) {
    const { groupId, members } = useGroup();
    const { user } = useAuth();
    const [activities, setActivities] = useState<ActivityEvent[]>([]);

    const fetchFeed = async () => {
        if (!user) return;
        try {
            const data = await dbQuery('notifications', `select=*,groups(name)&user_id=eq.${user.id}&order=created_at.desc`);
            if (data) setActivities(data as ActivityEvent[]);
        } catch (err) {
            console.error("Failed to load feed", err);
        }
    };

    const markAsRead = async () => {
        if (!user) return;
        try {
            await dbUpdate('notifications', `user_id=eq.${user.id}&is_read=eq.false`, { is_read: true });
            onUnreadChange(0);
        } catch (err) {
            console.error("Failed to mark read", err);
        }
    };

    const deleteNotification = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await dbDelete('notifications', `id=eq.${id}`);
            setActivities(prev => prev.filter(act => act.id !== id));
        } catch (err) {
            console.error("Failed to delete notification", err);
        }
    }

    // Subscribe and Initial Load
    useEffect(() => {
        if (!user) return;
        fetchFeed();

        // Standard polling interval down to 10 seconds for real-time emulation
        const intervalId = setInterval(() => {
            fetchFeed();
        }, 10000);

        return () => {
            clearInterval(intervalId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    // Reset unread config when opened
    useEffect(() => {
        if (isOpen) {
            markAsRead();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const getMemberName = (id: string) => {
        if (!id) return 'Someone';
        if (id === user?.id) return 'You';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return members.find((m: any) => m.user_id === id)?.users?.full_name?.split(' ')[0] || 'Someone';
    };

    return (
        <>
            {/* Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 transition-opacity"
                    onClick={onClose}
                />
            )}

            {/* Drawer */}
            <div
                className={`fixed top-0 right-0 h-full w-full sm:w-80 bg-white dark:bg-gray-900 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                <div className="h-full flex flex-col">
                    {/* Header */}
                    <div className="px-4 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/20">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                            <Activity className="w-5 h-5 mr-2 text-primary" />
                            Live Feed
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 -mr-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Feed List */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {activities.length === 0 ? (
                            <div className="text-center py-12 px-4">
                                <Coffee className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
                                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">It's quiet in here.</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Actions in your group will appear here in real-time.</p>
                            </div>
                        ) : (
                            activities.map((act) => {
                                let colorClass = '';
                                let icon = <History className="w-4 h-4 text-gray-400" />;

                                switch (act.type) {
                                    case 'INSERT_expense':
                                        colorClass = 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400';
                                        icon = <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />;
                                        break;
                                    case 'UPDATE_expense':
                                        colorClass = 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400';
                                        icon = <Check className="w-4 h-4 text-amber-600 dark:text-amber-400" />;
                                        break;
                                    case 'DELETE_expense':
                                        colorClass = 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400';
                                        icon = <X className="w-4 h-4 text-red-600 dark:text-red-400" />;
                                        break;
                                    case 'SETTLEMENT':
                                        colorClass = 'text-primary bg-primary/10 dark:text-primary';
                                        icon = <Banknote className="w-4 h-4 text-primary" />;
                                        break;
                                    default:
                                        colorClass = 'text-gray-600 bg-gray-50 dark:bg-gray-800 dark:text-gray-400';
                                }

                                return (
                                    <div key={act.id} className="flex space-x-3 items-start relative group">
                                        {/* Timeline Line (decorative) */}
                                        <div className="absolute left-4 top-8 -bottom-4 w-px bg-gray-100 dark:bg-gray-800 z-0 drop-shadow-sm"></div>

                                        <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 border-white dark:border-gray-900 shadow-sm ${colorClass}`}>
                                            {icon}
                                        </div>

                                        <div className={`flex-1 bg-white dark:bg-gray-800/50 rounded-xl p-3 border shadow-sm transition-colors relative ${act.is_read ? 'border-gray-100 dark:border-gray-800' : 'border-primary/30 dark:border-primary/50 bg-primary/5'}`}>

                                            {!act.is_read && (
                                                <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                                            )}

                                            <p className="text-sm text-gray-900 dark:text-gray-200 pr-5">
                                                {act.message}
                                            </p>
                                            {act.groups?.name && (
                                                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 flex items-center gap-1">
                                                    <span>📁</span>
                                                    <span>{act.groups.name}</span>
                                                </p>
                                            )}
                                            <div className="flex items-center justify-between mt-2">
                                                <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                                    {formatDistanceToNow(new Date(act.created_at), { addSuffix: true })}
                                                </p>
                                                <button onClick={(e) => deleteNotification(act.id, e)} className="text-gray-400 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
