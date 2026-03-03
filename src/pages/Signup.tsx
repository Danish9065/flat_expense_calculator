import React, { useState } from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import insforge from '../lib/db';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { User, Mail, Lock, Key, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export default function Signup() {
    const [searchParams] = useSearchParams();
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [inviteKey, setInviteKey] = useState(searchParams.get('key') || '');

    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const navigate = useNavigate();
    const { success, error: showError } = useToast();

    // Password strength logic
    const getPasswordStrength = (pwd: string) => {
        let score = 0;
        if (pwd.length >= 8) score += 1;
        if (/[A-Z]/.test(pwd)) score += 1;
        if (/[0-9]/.test(pwd)) score += 1;
        if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

        if (pwd.length === 0) return { label: '', color: 'bg-gray-200', text: '' };
        if (score < 2) return { label: 'Weak', color: 'bg-danger', text: 'text-danger' };
        if (score === 2) return { label: 'Medium', color: 'bg-warning', text: 'text-warning' };
        return { label: 'Strong', color: 'bg-success', text: 'text-success' };
    };

    const strength = getPasswordStrength(password);

    // Live validation
    const isFormValid =
        fullName.trim().length > 0 &&
        email.includes('@') &&
        password.length >= 6 &&
        password === confirmPassword &&
        inviteKey.trim().length > 0 &&
        !loading;

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isFormValid) return;
        setLoading(true);
        try {
            const { data: keyData, error: keyError } = await insforge.database
                .from('invite_keys').select('*')
                .eq('key_code', inviteKey).eq('is_used', false).maybeSingle();

            console.log('KEY DEBUG FULL:', JSON.stringify({ keyData, keyError }));
            console.log('KEY DEBUG RAW inviteKey:', inviteKey);
            if (keyError || !keyData) throw new Error('Invalid or already used invite key');
            if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) throw new Error('Invite key has expired');

            const { error: authError } = await insforge.auth.signUp({ email, password });

            const alreadyExists = authError?.message?.toLowerCase().includes('already');
            if (authError && !alreadyExists) throw new Error(authError.message || 'Failed to sign up');

            success('OTP sent! Please verify your email.');
            // Send email, full name, and invite key to the OTP verification screen
            navigate('/verify-otp', { state: { email, fullName, inviteKey: keyData.key_code } });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                    Create an account
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
                    Already have an account?{' '}
                    <Link to="/login" className="font-medium text-primary hover:text-primary/80 transition-colors">
                        Sign in instead
                    </Link>
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-card dark:bg-gray-800 py-8 px-4 shadow sm:rounded-2xl sm:px-10 border border-gray-100 dark:border-gray-700">
                    <form className="space-y-5" onSubmit={handleSignup}>

                        {/* Invite Key */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Invite Key</label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Key className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    required
                                    type="text"
                                    value={inviteKey}
                                    placeholder="SPLIT-XXXXXX"
                                    onChange={(e) => setInviteKey(e.target.value.toUpperCase())}
                                    className="block w-full pl-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary focus:border-primary sm:text-sm font-mono uppercase dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                        </div>

                        {/* Full Name */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Full Name</label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <User className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    required
                                    type="text"
                                    value={fullName}
                                    placeholder="John Doe"
                                    onChange={(e) => setFullName(e.target.value)}
                                    className="block w-full pl-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary focus:border-primary sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                        </div>

                        {/* Email */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email address</label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Mail className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    required
                                    type="email"
                                    value={email}
                                    placeholder="you@example.com"
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="block w-full pl-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary focus:border-primary sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Lock className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    required
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    placeholder="••••••••"
                                    autoComplete="new-password"
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="block w-full pl-10 pr-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary focus:border-primary sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                                >
                                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>

                            {/* Password Strength Bar */}
                            {password.length > 0 && (
                                <div className="mt-2 text-xs flex items-center justify-between">
                                    <div className="flex gap-1 flex-1 mr-3 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                                        <div className={`h-full ${strength.color} transition-all duration-300 ease-out`} style={{ width: strength.label === 'Weak' ? '33%' : strength.label === 'Medium' ? '66%' : '100%' }}></div>
                                    </div>
                                    <span className={`font-medium ${strength.text}`}>{strength.label}</span>
                                </div>
                            )}
                        </div>

                        {/* Confirm Password */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Confirm Password</label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Lock className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    required
                                    type="password"
                                    value={confirmPassword}
                                    placeholder="••••••••"
                                    autoComplete="new-password"
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="block w-full pl-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary focus:border-primary sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                            {confirmPassword.length > 0 && password !== confirmPassword && (
                                <p className="mt-1 text-xs text-danger">Passwords do not match</p>
                            )}
                        </div>

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={!isFormValid}
                                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
                            >
                                {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Create Account'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
