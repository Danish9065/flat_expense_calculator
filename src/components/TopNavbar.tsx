import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { dbQuery } from '../lib/db';
import insforge from '../lib/db';
import { Link, useLocation } from 'react-router-dom';
import { Bell, LogOut, Receipt } from 'lucide-react';
import ActivityDrawer from './ActivityDrawer';

export default function TopNavbar() {
    const { user, role, signOut } = useAuth();
    const location = useLocation();
    const [drawerOpen, setDrawerOpen] = useState(false);
    // Example state for unread count, later wired to realtime
    const [unreadCount, setUnreadCount] = useState(0);

    const fetchNotificationsCount = async () => {
        if (!user) return;
        try {
            const data = await dbQuery('notifications', `user_id=eq.${user.id}&is_read=eq.false`);
            setUnreadCount(data ? data.length : 0);
        } catch (err) {
            console.error("Error fetching notifications:", err);
        }
    };

    useEffect(() => {
        if (!user) return;
        fetchNotificationsCount();

        // Standard polling interval to fetch notification counts instead of direct realtime SDK channel
        const intervalId = setInterval(() => {
            fetchNotificationsCount();
        }, 10000); // Poll every 10 seconds

        return () => {
            clearInterval(intervalId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    if (!user) return null;

    const navItems = [
        { label: 'Dashboard', path: '/dashboard' },
        { label: 'Balance', path: '/balance' },
        { label: 'Group', path: '/group' },
        { label: 'Settings', path: '/settings' },
    ];

    if (role === 'admin') {
        navItems.push({ label: 'Admin', path: '/admin' });
    }

    const fallbackInitial = user?.full_name?.charAt(0) || 'U';

    return (
        <>
            <nav className="flex bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 fixed top-0 w-full z-40 h-16 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
                    <div className="flex justify-between items-center h-full">

                        {/* Logo */}
                        <div className="flex-shrink-0 flex items-center">
                            <Link to="/dashboard" className="flex items-center space-x-2">
                                <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-bold">
                                    <Receipt className="w-5 h-5" />
                                </div>
                                <span className="text-xl font-extrabold text-primary tracking-tight">SplitMate</span>
                            </Link>
                        </div>

                        {/* Nav Links */}
                        <div className="hidden md:flex items-center space-x-8">
                            {navItems.map((item) => {
                                const isActive = location.pathname === item.path;
                                return (
                                    <Link
                                        key={item.path}
                                        to={item.path}
                                        className={`text-sm font-semibold transition-colors ${isActive
                                            ? 'text-primary border-b-2 border-primary py-5'
                                            : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                                            }`}
                                    >
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </div>

                        {/* Profile & Bell */}
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={() => setDrawerOpen(true)}
                                className="relative p-2 text-gray-400 hover:text-gray-500 transition-colors"
                            >
                                <Bell className="w-5 h-5" />
                                {unreadCount > 0 && (
                                    <span className="absolute top-1.5 right-1.5 block h-2 w-2 rounded-full bg-danger ring-2 ring-white dark:ring-gray-800" />
                                )}
                            </button>

                            <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />

                            <div className="flex items-center space-x-3">
                                <div className="hidden lg:flex flex-col text-right">
                                    <span className="text-sm font-bold text-gray-900 dark:text-white leading-tight">
                                        {user.full_name?.split(' ')[0] || 'Member'}
                                    </span>
                                    <span className="text-xs text-gray-500 font-medium">
                                        {role === 'admin' ? 'Admin' : 'Member'}
                                    </span>
                                </div>
                                {user.avatar_url ? (
                                    <img src={user.avatar_url} alt="" className="w-9 h-9 rounded-full ml-2 border-2 border-white dark:border-gray-800 shadow-sm" />
                                ) : (
                                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold ml-2 border-2 border-white dark:border-gray-800 shadow-sm">
                                        {fallbackInitial}
                                    </div>
                                )}

                                <button
                                    onClick={signOut}
                                    className="p-1.5 text-gray-400 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors ml-2"
                                    title="Sign out"
                                >
                                    <LogOut className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Attach Activity Drawer, opens via state */}
            <ActivityDrawer
                isOpen={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                onUnreadChange={setUnreadCount}
            />
        </>
    );
}
