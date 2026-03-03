import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { Home, PieChart, Users, Settings, Shield } from 'lucide-react';

export default function BottomNav() {
    const { user, role } = useAuth();
    const location = useLocation();

    if (!user) return null;

    const navItems = [
        { label: 'Dashboard', path: '/dashboard', icon: Home },
        { label: 'Balance', path: '/balance', icon: PieChart },
        { label: 'Group', path: '/group', icon: Users },
        { label: 'Settings', path: '/settings', icon: Settings },
    ];

    if (role === 'admin') {
        navItems.push({ label: 'Admin', path: '/admin', icon: Shield });
    }

    return (
        <div className="fixed bottom-0 w-full bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 md:hidden z-40 pb-safe">
            <div className="flex justify-around items-center h-16">
                {navItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    const Icon = item.icon;

                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`flex flex-col items-center justify-center w-full h-full space-y-1 relative ${isActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                                }`}
                        >
                            <Icon className={`w-6 h-6 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
                            <span className={`text-[10px] font-medium ${isActive ? 'font-bold' : ''}`}>
                                {item.label}
                            </span>
                            {isActive && (
                                <div className="absolute top-1 right-1/4 w-1.5 h-1.5 bg-primary rounded-full shadow-[0_0_4px_rgba(108,99,255,0.5)]" />
                            )}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
