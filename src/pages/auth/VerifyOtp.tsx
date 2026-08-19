import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Mail } from 'lucide-react';
import { supabaseClient } from '../../lib/db';
import { useToast } from '../../context/ToastContext';

export default function VerifyOtp() {
    const location = useLocation();
    const navigate = useNavigate();
    const { success, error: showError } = useToast();
    const email = location.state?.email || '';
    const [resending, setResending] = useState(false);

    useEffect(() => {
        if (!email) navigate('/signup', { replace: true });
    }, [email, navigate]);

    const handleResend = async () => {
        setResending(true);
        try {
            const { error } = await supabaseClient.auth.resend({
                type: 'signup',
                email,
                options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
            });
            if (error) throw error;
            success('Verification link resent. Check your inbox.');
        } catch (error) {
            showError(error instanceof Error ? error.message : 'Failed to resend verification email');
        } finally {
            setResending(false);
        }
    };

    return (
        <div className="auth-shell">
            <div className="auth-header">
                <div className="auth-mark"><Mail className="h-7 w-7" /></div>
                <h2 className="auth-heading">Verify your email</h2>
                <p className="auth-copy">
                    We sent a secure verification link to<br />
                    <span className="font-medium text-white">{email}</span>
                </p>
            </div>

            <div className="auth-card-wrap">
                <div className="auth-card space-y-5 text-center">
                    <p className="text-sm leading-6 text-muted-foreground">
                        Open the link in the email. Your profile and invite will be completed automatically,
                        even if you open it on another device.
                    </p>
                    <button type="button" onClick={handleResend} disabled={resending} className="auth-submit">
                        {resending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Resend verification link'}
                    </button>
                    <Link to="/login" className="auth-secondary-action">Back to login</Link>
                </div>
            </div>
        </div>
    );
}
