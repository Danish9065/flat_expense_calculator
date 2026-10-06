import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { GroupProvider } from './context/GroupContext';
import { ToastProvider } from './context/ToastContext';
import Login from './pages/Login';
import Signup from './pages/Signup';
import VerifyOtp from './pages/auth/VerifyOtp';
import AuthCallback from './pages/auth/AuthCallback';
import ResetPassword from './pages/auth/ResetPassword';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import PaymentCenter from './pages/PaymentCenter';
import Group from './pages/Group';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import NotFound from './pages/NotFound';

// Global Components
import ErrorBoundary from './components/ErrorBoundary';
import TopNavbar from './components/TopNavbar';
import BottomNav from './components/BottomNav';
import InstallPrompt from './components/InstallPrompt';

const ProtectedRoute = ({ children, adminOnly = false }: { children: React.ReactNode, adminOnly?: boolean }) => {
  const { user, role, loading } = useAuth();

  // CRITICAL: wait for session restore before redirecting
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#6C63FF]" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && role !== 'admin') return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
};

const LandingRoute = () => {
  const { user, role, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#6C63FF]" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={role === 'admin' ? '/admin' : '/dashboard'} replace />;
};

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          <GroupProvider>
            <ToastProvider>
              <AppLayout />
            </ToastProvider>
          </GroupProvider>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}

const AUTH_PATHS = new Set(['/login', '/signup', '/verify-otp', '/auth/callback', '/forgot-password', '/verify-password-otp', '/reset-password']);

function AppLayout() {
  const location = useLocation();
  const isAuthPage = AUTH_PATHS.has(location.pathname);

  return (
    <div className={`min-h-screen bg-background text-white font-sans flex flex-col ${isAuthPage ? '' : 'pt-16 md:pt-20 pb-16 md:pb-0'}`}>
      {isAuthPage ? null : <TopNavbar />}

      <main className="flex-grow w-full">
                  <Routes>
                    {/* Public Routes */}
                    <Route path="/" element={<LandingRoute />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/verify-otp" element={<VerifyOtp />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/verify-password-otp" element={<Navigate to="/forgot-password" replace />} />
                    <Route path="/reset-password" element={<ResetPassword />} />

                    {/* Protected Routes */}
                    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                    <Route path="/balance" element={<ProtectedRoute><PaymentCenter /></ProtectedRoute>} />
                    <Route path="/group" element={<ProtectedRoute><Group /></ProtectedRoute>} />
                    <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

                    {/* Admin Route */}
                    <Route path="/admin" element={<ProtectedRoute adminOnly={true}><Admin /></ProtectedRoute>} />

                    {/* 404 Route */}
                    <Route path="*" element={<NotFound />} />
                  </Routes>
      </main>

      {isAuthPage ? null : <BottomNav />}
      <InstallPrompt />
    </div>
  );
}

export default App;
