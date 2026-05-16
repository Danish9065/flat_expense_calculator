import React, { useState } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void> | void;
    title: string;
    message: string;
    confirmText?: string;
    requireWordOption?: string; // If set, user must type this word to enable confirm button
}

export default function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    requireWordOption,
}: ConfirmModalProps) {
    const [typedWord, setTypedWord] = useState('');
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    const isConfirmDisabled = requireWordOption
        ? typedWord !== requireWordOption
        : false;

    const handleConfirm = async () => {
        setLoading(true);
        try {
            await onConfirm();
        } finally {
            setLoading(false);
            setTypedWord(''); // Reset for next time
        }
    };

    const handleClose = () => {
        if (!loading) {
            setTypedWord('');
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
                onClick={handleClose}
            />

            {/* Modal Content */}
            <div className="app-panel w-full max-w-sm relative z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6">
                    <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center mb-4">
                        <AlertTriangle className="w-6 h-6" />
                    </div>

                    <h3 className="text-xl font-bold text-white mb-2">
                        {title}
                    </h3>
                    <p className="app-subtitle mb-6">
                        {message}
                    </p>

                    {requireWordOption && (
                        <div className="mb-6">
                            <label className="block text-xs font-medium text-muted-foreground mb-2">
                                Type <span className="font-bold font-mono bg-white/10 px-1 py-0.5 rounded text-white">{requireWordOption}</span> to confirm.
                            </label>
                            <input
                                type="text"
                                value={typedWord}
                                onChange={(e) => setTypedWord(e.target.value)}
                                placeholder={requireWordOption}
                                className="dark-input px-3 py-2 rounded-lg sm:text-sm font-mono"
                            />
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            onClick={handleClose}
                            disabled={loading}
                            className="ghost-button flex-1 px-4 py-2.5 rounded-xl font-semibold text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={isConfirmDisabled || loading}
                            className="danger-button flex-1 flex justify-center items-center px-4 py-2.5 rounded-xl font-bold text-sm focus:ring-2 focus:ring-offset-2 focus:ring-danger focus:ring-offset-background"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmText}
                        </button>
                    </div>
                </div>

                {/* Close X (top absolute) */}
                <button
                    onClick={handleClose}
                    disabled={loading}
                    className="absolute top-4 right-4 text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
