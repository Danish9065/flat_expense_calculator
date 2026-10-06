import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Loader2, ReceiptText } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { success, error: showError } = useToast();

  useEffect(() => {
    if (user && !authLoading) {
      navigate('/dashboard');
    }
  }, [user, authLoading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      success(`Welcome back! 👋`);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-header">
        <div className="auth-mark">
          <ReceiptText className="h-7 w-7" />
        </div>
        <h2 className="auth-heading">Sign in</h2>
        <p className="auth-copy">
          Or{' '}
          <Link to="/signup" className="auth-link">
            create a new account
          </Link>
        </p>
      </div>
      <div className="auth-card-wrap">
        <div className="auth-card">
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label className="auth-label" htmlFor="login-email">Email address</label>
              <div className="mt-2 relative">
                <div className="auth-field-icon">
                  <Mail className="h-5 w-5" />
                </div>
                <input
                  id="login-email" required type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-field"
                  placeholder="you@example.com"
                  autoComplete="email"
                  inputMode="email"
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-3">
                <label className="auth-label" htmlFor="login-password">Password</label>
                <Link to="/forgot-password" className="shrink-0 text-xs sm:text-sm font-medium text-primary hover:text-primary/80">Forgot password?</Link>
              </div>
              <div className="mt-2 relative">
                <div className="auth-field-icon">
                  <Lock className="h-5 w-5" />
                </div>
                <input
                  id="login-password" required type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-field"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="auth-submit"
            >
              {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
