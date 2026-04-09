import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { GroupProvider } from './context/GroupContext';
import { ToastProvider } from './context/ToastContext';
import Login from './pages/Login';
import Signup from './pages/Signup';
import VerifyOtp from './pages/auth/VerifyOtp';
import VerifyPasswordOTP from './pages/auth/VerifyPasswordOTP';
import ResetPassword from './pages/auth/ResetPassword';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import Balance from './pages/Balance';
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

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          <GroupProvider>
            <ToastProvider>
              <div className="min-h-screen bg-background text-gray-900 font-sans flex flex-col pt-16 md:pt-20 pb-16 md:pb-0">
                <TopNavbar />

                <main className="flex-grow w-full">
                  <Routes>
                    {/* Public Routes */}
                    <Route path="/" element={<Navigate to="/login" />} />
                    <Route path="/login" element={<div className="-mt-16 md:-mt-20"><Login /></div>} />
                    <Route path="/signup" element={<div className="-mt-16 md:-mt-20"><Signup /></div>} />
                    <Route path="/verify-otp" element={<div className="-mt-16 md:-mt-20"><VerifyOtp /></div>} />
                    <Route path="/forgot-password" element={<div className="-mt-16 md:-mt-20"><ForgotPassword /></div>} />
                    <Route path="/verify-password-otp" element={<div className="-mt-16 md:-mt-20"><VerifyPasswordOTP /></div>} />
                    <Route path="/reset-password" element={<div className="-mt-16 md:-mt-20"><ResetPassword /></div>} />

                    {/* Protected Routes */}
                    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                    <Route path="/balance" element={<ProtectedRoute><Balance /></ProtectedRoute>} />
                    <Route path="/group" element={<ProtectedRoute><Group /></ProtectedRoute>} />
                    <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

                    {/* Admin Route */}
                    <Route path="/admin" element={<ProtectedRoute adminOnly={true}><Admin /></ProtectedRoute>} />

                    {/* 404 Route */}
                    <Route path="*" element={<div className="-mt-16 md:-mt-20"><NotFound /></div>} />
                  </Routes>
                </main>

                <BottomNav />
                <InstallPrompt />
              </div>
            </ToastProvider>
          </GroupProvider>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
