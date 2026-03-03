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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'Verification failed');
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'Failed to resend OTP');
        } finally {
            setResending(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center mb-4">
                    <div className="bg-primary/10 p-3 rounded-full">
                        <Mail className="h-8 w-8 text-primary" />
                    </div>
                </div>
                <h2 className="text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                    Verify your email
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
                    We sent a 6-digit code to<br />
                    <span className="font-medium text-gray-900 dark:text-gray-100">{email}</span>
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-card dark:bg-gray-800 py-8 px-4 shadow sm:rounded-2xl sm:px-10 border border-gray-100 dark:border-gray-700">
                    <form onSubmit={handleVerify} className="space-y-6">
                        <div className="flex justify-center gap-3" onPaste={handlePaste}>
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
                                    className="w-12 h-12 text-center text-xl font-bold border-2 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white transition-all"
                                />
                            ))}
                        </div>

                        <button
                            type="submit"
                            disabled={otp.join('').length !== 6 || loading}
                            className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
                        >
                            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Verify Email'}
                        </button>

                        <p className="text-center text-sm text-gray-600 dark:text-gray-400">
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
