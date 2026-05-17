import React, { useState, useEffect } from 'react';
import insforge from '../../lib/db';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export default function ResetPassword() {
    const location = useLocation();
    const navigate = useNavigate();
    const { success, error: showError } = useToast();

    const resetToken = location.state?.resetToken || '';
    const email = location.state?.email || '';

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!resetToken) navigate('/forgot-password');
    }, [resetToken, navigate]);

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
            const { error } = await insforge.auth.resetPassword({
                newPassword,
                otp: resetToken,
            });

            if (error) throw new Error(error.message || 'Failed to reset password');

            success('Password reset successfully! Please log in.');
            navigate('/login');
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-shell">
            <div className="auth-header">
                <div className="auth-mark">
                    <Lock className="h-7 w-7" />
                </div>
                <h2 className="auth-heading">
                    Set new password
                </h2>
                {email && (
                    <p className="auth-copy">
                        Resetting password for{' '}
                        <span className="font-medium text-white">{email}</span>
                    </p>
                )}
            </div>

            <div className="auth-card-wrap">
                <div className="auth-card">
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        {/* New Password */}
                        <div>
                            <label className="auth-label">
                                New Password
                            </label>
                            <div className="mt-2 relative">
                                <div className="auth-field-icon">
                                    <Lock className="h-5 w-5" />
                                </div>
                                <input
                                    required
                                    type={showNew ? 'text' : 'password'}
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    className="auth-field pr-10"
                                    placeholder="Minimum 6 characters"
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
                            <label className="auth-label">
                                Confirm Password
                            </label>
                            <div className="mt-2 relative">
                                <div className="auth-field-icon">
                                    <Lock className="h-5 w-5" />
                                </div>
                                <input
                                    required
                                    type={showConfirm ? 'text' : 'password'}
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    className="auth-field pr-10"
                                    placeholder="Repeat your password"
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
