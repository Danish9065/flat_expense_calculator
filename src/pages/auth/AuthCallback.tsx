import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function AuthCallback() {
    const { user, role, loading } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (loading) return;
        navigate(user ? (role === 'admin' ? '/admin' : '/dashboard') : '/login', { replace: true });
    }, [loading, navigate, role, user]);

    return (
        <div className="auth-shell">
            <div className="auth-card-wrap">
                <div className="auth-card flex items-center justify-center gap-3 text-sm text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    Completing secure sign-in…
                </div>
            </div>
        </div>
    );
}
