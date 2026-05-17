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
    useGroup();
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

    return (
        <>
            {/* Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 transition-opacity"
                    onClick={onClose}
                />
            )}

            {/* Drawer */}
            <div
                className={`fixed top-0 right-0 h-full w-full sm:w-96 bg-[#0D0D0D] border-l border-white/10 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                <div className="h-full flex flex-col">
                    {/* Header */}
                    <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center bg-white/[0.03]">
                        <h2 className="text-lg font-bold text-white flex items-center">
                            <Activity className="w-5 h-5 mr-2 text-primary" />
                            Live Feed
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 -mr-2 text-muted-foreground hover:bg-white/[0.06] hover:text-white rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Feed List */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {activities.length === 0 ? (
                            <div className="text-center py-12 px-4">
                                <Coffee className="w-12 h-12 text-white/15 mx-auto mb-3" />
                                <p className="text-sm font-medium text-muted-foreground">It's quiet in here.</p>
                                <p className="text-xs text-white/35 mt-1">Actions in your group will appear here in real-time.</p>
                            </div>
                        ) : (
                            activities.map((act) => {
                                let colorClass = '';
                                let icon = <History className="w-4 h-4 text-muted-foreground" />;

                                switch (act.type) {
                                    case 'INSERT_expense':
                                        colorClass = 'text-green-300 bg-green-500/10';
                                        icon = <CheckCircle2 className="w-4 h-4 text-green-300" />;
                                        break;
                                    case 'UPDATE_expense':
                                        colorClass = 'text-amber-300 bg-amber-500/10';
                                        icon = <Check className="w-4 h-4 text-amber-300" />;
                                        break;
                                    case 'DELETE_expense':
                                        colorClass = 'text-red-300 bg-red-500/10';
                                        icon = <X className="w-4 h-4 text-red-300" />;
                                        break;
                                    case 'SETTLEMENT':
                                        colorClass = 'text-primary bg-primary/10';
                                        icon = <Banknote className="w-4 h-4 text-primary" />;
                                        break;
                                    default:
                                        colorClass = 'text-muted-foreground bg-white/[0.04]';
                                }

                                return (
                                    <div key={act.id} className="flex space-x-3 items-start relative group">
                                        {/* Timeline Line (decorative) */}
                                        <div className="absolute left-4 top-8 -bottom-4 w-px bg-white/10 z-0 drop-shadow-sm"></div>

                                        <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 border border-white/10 shadow-sm ${colorClass}`}>
                                            {icon}
                                        </div>

                                        <div className={`flex-1 rounded-2xl p-3 border shadow-sm transition-colors relative ${act.is_read ? 'bg-white/[0.04] border-white/10' : 'bg-primary/10 border-primary/40'}`}>

                                            {!act.is_read && (
                                                <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                                            )}

                                            <p className="text-sm text-white pr-5">
                                                {act.message}
                                            </p>
                                            {act.groups?.name && (
                                                <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                                                    <span>📁</span>
                                                    <span>{act.groups.name}</span>
                                                </p>
                                            )}
                                            <div className="flex items-center justify-between mt-2">
                                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                                                    {formatDistanceToNow(new Date(act.created_at), { addSuffix: true })}
                                                </p>
                                                <button onClick={(e) => deleteNotification(act.id, e)} className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white/[0.06] rounded-md">
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
