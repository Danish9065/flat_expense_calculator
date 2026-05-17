/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    addToast: (message: string, type: ToastType) => void;
    success: (message: string) => void;
    error: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((message: string, type: ToastType) => {
        const id = Math.random().toString(36).substr(2, 9);
        setToasts((prev) => [...prev, { id, message, type }]);

        setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== id));
        }, 3000);
    }, []);

    const success = useCallback((msg: string) => addToast(msg, 'success'), [addToast]);
    const error = useCallback((msg: string) => addToast(msg, 'error'), [addToast]);
    const warning = useCallback((msg: string) => addToast(msg, 'warning'), [addToast]);
    const info = useCallback((msg: string) => addToast(msg, 'info'), [addToast]);

    const removeToast = (id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    };

    return (
        <ToastContext.Provider value={{ addToast, success, error, warning, info }}>
            {children}
            <div className="fixed top-4 right-4 z-50 flex flex-col space-y-2 pointer-events-none w-full max-w-sm px-4 sm:px-0">
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className={cn(
                            "pointer-events-auto flex w-full items-center justify-between space-x-4 overflow-hidden rounded-2xl border bg-[#0D0D0D] p-4 pr-6 shadow-[0_18px_50px_rgba(0,0,0,0.4)] transition-all",
                            toast.type === 'success' && "border-green-500/25 text-green-100",
                            toast.type === 'error' && "border-red-500/25 text-red-100",
                            toast.type === 'warning' && "border-amber-500/25 text-amber-100",
                            toast.type === 'info' && "border-blue-500/25 text-blue-100"
                        )}
                    >
                        <div className="flex items-center space-x-3">
                            {toast.type === 'success' && <CheckCircle2 className="h-5 w-5 text-green-400" />}
                            {toast.type === 'error' && <XCircle className="h-5 w-5 text-red-400" />}
                            {toast.type === 'warning' && <AlertTriangle className="h-5 w-5 text-amber-400" />}
                            {toast.type === 'info' && <Info className="h-5 w-5 text-blue-400" />}
                            <span className="text-sm font-medium">{toast.message}</span>
                        </div>
                        <button
                            onClick={() => removeToast(toast.id)}
                            className="text-muted-foreground hover:text-white focus:outline-none focus:ring-2 focus:ring-primary rounded-md"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) throw new Error("useToast must be used within ToastProvider");
    return context;
};
