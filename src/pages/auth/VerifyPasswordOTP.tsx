import React, { useState, useRef, useEffect } from 'react';
import insforge from '../../lib/db';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ShieldCheck, Loader2, ArrowLeft } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export default function VerifyPasswordOTP() {
    const location = useLocation();
    const navigate = useNavigate();
    const { success, error: showError } = useToast();

    const email = location.state?.email || '';

    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const inputs = useRef<(HTMLInputElement | null)[]>([]);

    useEffect(() => {
        if (!email) navigate('/forgot-password');
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
        const code = otp.join('');
        if (code.length !== 6) return;
        setLoading(true);
        try {
            const { data, error } = await insforge.auth.exchangeResetPasswordToken({
                email,
                code,
            });
            if (error) throw new Error(error.message || 'Invalid OTP');
            if (!data) throw new Error('Unexpected response from server');

            success('OTP verified! Please set your new password.');
            navigate('/reset-password', { state: { resetToken: data.token, email } });
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'OTP verification failed');
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        setResending(true);
        try {
            const { error } = await insforge.auth.sendResetPasswordEmail({ email });
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
                    <ShieldCheck className="h-7 w-7" />
                </div>
                <h2 className="auth-heading">
                    Check your email
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
                            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Verify OTP'}
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

                    <div className="mt-6">
                        <Link to="/forgot-password" className="auth-secondary-action">
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
