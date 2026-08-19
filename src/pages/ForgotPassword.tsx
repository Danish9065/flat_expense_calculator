import React, { useState } from 'react';
import insforge from '../lib/db';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Loader2, ArrowLeft } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);

    const navigate = useNavigate();
    const { success, error: showError } = useToast();

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { error } = await insforge.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
            });

            if (error) {
                throw new Error(error.message || 'Failed to send reset email');
            }

            success('Password reset link sent! Check your inbox.');
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
                    <Mail className="h-7 w-7" />
                </div>
                <h2 className="auth-heading">
                    Forgot Password
                </h2>
                <p className="auth-copy">
                    Enter your email and we'll send you a secure reset link.
                </p>
            </div>

            <div className="auth-card-wrap">
                <div className="auth-card">
                    <form className="space-y-6" onSubmit={handleReset}>
                        <div>
                            <label className="auth-label">Email address</label>
                            <div className="mt-2 relative">
                                <div className="auth-field-icon">
                                    <Mail className="h-5 w-5" />
                                </div>
                                <input
                                    required
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="auth-field"
                                    placeholder="you@example.com"
                                />
                            </div>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={loading || !email}
                                className="auth-submit"
                            >
                                {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Send reset link'}
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
