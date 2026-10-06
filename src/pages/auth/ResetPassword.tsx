import React, { useState, useEffect } from 'react';
import { supabaseClient } from '../../lib/db';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
    clearPasswordRecoverySession,
    hasActivePasswordRecoverySession,
    hasPasswordRecoveryParams,
    markPasswordRecoverySession,
} from '../../lib/passwordRecovery';

type RecoveryState = 'checking' | 'ready' | 'invalid';

export default function ResetPassword() {
    const navigate = useNavigate();
    const { success, error: showError } = useToast();

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking');

    useEffect(() => {
        let active = true;
        const openedFromRecoveryLink = hasPasswordRecoveryParams(window.location);
        const authCode = new URLSearchParams(window.location.search).get('code');
        if (openedFromRecoveryLink) markPasswordRecoverySession();

        const { data: listener } = supabaseClient.auth.onAuthStateChange((event, session) => {
            if (!active || event !== 'PASSWORD_RECOVERY' || !session) return;
            markPasswordRecoverySession();
            setRecoveryState('ready');
        });

        const prepareRecoverySession = async () => {
            let { data, error } = await supabaseClient.auth.getSession();

            if (!data.session && authCode) {
                const exchangeResult = await supabaseClient.auth.exchangeCodeForSession(authCode);
                error = exchangeResult.error;
                data = { session: exchangeResult.data.session };
            }

            if (!active) return;
            if (!error && data.session && (openedFromRecoveryLink || hasActivePasswordRecoverySession())) {
                setRecoveryState('ready');
                return;
            }
            setRecoveryState('invalid');
        };

        void prepareRecoverySession();
        return () => {
            active = false;
            listener.subscription.unsubscribe();
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (newPassword.length < 6) {
            showError('Password must be at least 6 characters.');
            return;
        }

        if (newPassword !== confirmPassword) {
            showError('Passwords do not match.');
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

            if (error) throw new Error(error.message || 'Failed to reset password');

            success('Password reset successfully! Please log in.');
            clearPasswordRecoverySession();
            await supabaseClient.auth.signOut({ scope: 'local' });
            navigate('/login', { replace: true });
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    if (recoveryState === 'checking') {
        return (
            <div className="auth-shell">
                <div className="auth-card-wrap">
                    <div className="auth-card flex items-center justify-center gap-3 text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        Verifying your secure reset link…
                    </div>
                </div>
            </div>
        );
    }

    if (recoveryState === 'invalid') {
        return (
            <div className="auth-shell">
                <div className="auth-header">
                    <div className="auth-mark"><Lock className="h-7 w-7" /></div>
                    <h2 className="auth-heading">Reset link expired</h2>
                    <p className="auth-copy">This password reset link is invalid or has expired.</p>
                </div>
                <div className="auth-card-wrap">
                    <div className="auth-card space-y-4 text-center">
                        <Link to="/forgot-password" className="auth-submit">Request a new reset link</Link>
                        <Link to="/login" className="auth-secondary-action">Back to login</Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-shell">
            <div className="auth-header">
                <div className="auth-mark">
                    <Lock className="h-7 w-7" />
                </div>
                <h2 className="auth-heading">
                    Set new password
                </h2>
                <p className="auth-copy">Choose a new password for your verified account.</p>
            </div>

            <div className="auth-card-wrap">
                <div className="auth-card">
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        {/* New Password */}
                        <div>
                            <label className="auth-label" htmlFor="new-password">
                                New Password
                            </label>
                            <div className="mt-2 relative">
                                <div className="auth-field-icon">
                                    <Lock className="h-5 w-5" />
                                </div>
                                <input
                                    id="new-password"
                                    required
                                    type={showNew ? 'text' : 'password'}
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    className="auth-field pr-10"
                                    placeholder="Minimum 6 characters"
                                    autoComplete="new-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNew(v => !v)}
                                    className="auth-icon-button"
                                >
                                    {showNew ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                        </div>

                        {/* Confirm Password */}
                        <div>
                            <label className="auth-label" htmlFor="confirm-new-password">
                                Confirm Password
                            </label>
                            <div className="mt-2 relative">
                                <div className="auth-field-icon">
                                    <Lock className="h-5 w-5" />
                                </div>
                                <input
                                    id="confirm-new-password"
                                    required
                                    type={showConfirm ? 'text' : 'password'}
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    className="auth-field pr-10"
                                    placeholder="Repeat your password"
                                    autoComplete="new-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirm(v => !v)}
                                    className="auth-icon-button"
                                >
                                    {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                            {confirmPassword && newPassword !== confirmPassword && (
                                <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
                            )}
                        </div>

                        <div>
                            <button
                            type="submit"
                            disabled={loading || !newPassword || !confirmPassword}
                                className="auth-submit"
                            >
                                {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Reset Password'}
                            </button>
                        </div>
                    </form>

                    <div className="mt-6">
                        <Link to="/login" className="auth-secondary-action">
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to login
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
