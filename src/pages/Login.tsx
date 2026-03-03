import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Lock, Loader2 } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const { success, error: showError } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
      success(`Welcome back! 👋`);
    } catch (err: any) {
      showError('Invalid email or password');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100">Sign in</h2>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          Or{' '}
          <Link to="/signup" className="font-medium text-primary hover:text-primary/80 transition-colors">
            create a new account
          </Link>
        </p>
      </div>
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-card dark:bg-gray-800 py-8 px-4 shadow sm:rounded-2xl sm:px-10 border border-gray-100 dark:border-gray-700">
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email address</label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  required type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary focus:border-primary sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="you@example.com"
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                <Link to="/forgot-password" className="text-sm font-medium text-primary hover:text-primary/80">Forgot password?</Link>
              </div>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  required type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary focus:border-primary sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="••••••••"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
