import React, { useState, useRef, useEffect } from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import insforge from '../../lib/db';
import { useNavigate, useLocation } from 'react-router-dom';
import { Mail, Loader2 } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export default function VerifyOtp() {
    const location = useLocation();
    const navigate = useNavigate();
    const { success, error: showError } = useToast();

    // Recover our state from the React Router `navigate` call
    const email = location.state?.email || '';
    const fullName = location.state?.fullName || '';
    const inviteKey = location.state?.inviteKey || '';

    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const inputs = useRef<(HTMLInputElement | null)[]>([]);

    useEffect(() => {
        if (!email) navigate('/signup');
        inputs.current[0]?.focus();
    }, [email, navigate]);

    const handleChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return;
        const newOtp = [...otp];
        newOtp[index] = value.slice(-1);
        setOtp(newOtp);
        if (value && index < 5) inputs.current[index + 1]?.focus();
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !otp[index] && index > 0) {
            inputs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (pasted.length === 6) {
            setOtp(pasted.split(''));
            inputs.current[5]?.focus();
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = otp.join('');
        if (token.length !== 6) return;
        setLoading(true);
        try {
            const { data, error } = await insforge.auth.verifyEmail({
                email,
                otp: token
            });
            if (error) throw new Error(error.message || 'Invalid OTP');

            // The user is finally generated and fully authenticated at this exact moment. 
            // We can now safely access their ID and update the backend!
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const userId = (data as any)?.session?.user?.id || (data as any)?.user?.id;

            if (userId && fullName && inviteKey) {
                // Upsert to public.users first to satisfy foreign key constraints
                const { error: upsertError } = await insforge.database.from('users')
                    .upsert({ id: userId, full_name: fullName, email, role: 'member' });

                if (upsertError) console.error("Could not create user profile:", upsertError);

                // Now burn the passed invite key and add them to the group
                const { error: rpcError } = await insforge.database.rpc('consume_invite_key', {
                    key_code_param: inviteKey,
                    target_user_id: userId
                });

                if (rpcError) console.error("Failed to consume invite key:", rpcError);
            }

            success('Email verified! You can now log in.');
            navigate('/login');
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Verification failed');
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        setResending(true);
        try {
            const { error } = await insforge.auth.resendVerificationEmail({
                email
            });
            if (error) throw new Error(error.message);
            success('OTP resent! Check your email.');
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Failed to resend OTP');
        } finally {
            setResending(false);
        }
    };

    return (
        <div className="auth-shell">
            <div className="auth-header">
                <div className="auth-mark">
                    <Mail className="h-7 w-7" />
                </div>
                <h2 className="auth-heading">
                    Verify your email
                </h2>
                <p className="auth-copy">
                    We sent a 6-digit code to<br />
                    <span className="font-medium text-white">{email}</span>
                </p>
            </div>

            <div className="auth-card-wrap">
                <div className="auth-card">
                    <form onSubmit={handleVerify} className="space-y-6">
                        <div className="flex justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
                            {otp.map((digit, i) => (
                                <input
                                    key={i}
                                    ref={el => { inputs.current[i] = el; }}
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={1}
                                    value={digit}
                                    onChange={e => handleChange(i, e.target.value)}
                                    onKeyDown={e => handleKeyDown(i, e)}
                                    className="otp-cell"
                                />
                            ))}
                        </div>

                        <button
                            type="submit"
                            disabled={otp.join('').length !== 6 || loading}
                            className="auth-submit"
                        >
                            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Verify Email'}
                        </button>

                        <p className="text-center text-sm text-muted-foreground">
                            Didn't receive the code?{' '}
                            <button
                                type="button"
                                onClick={handleResend}
                                disabled={resending}
                                className="font-medium text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
                            >
                                {resending ? 'Sending...' : 'Resend OTP'}
                            </button>
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
}
