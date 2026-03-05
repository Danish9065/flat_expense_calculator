import { createContext, useContext, useEffect, useState } from 'react';
import insforge, { dbQuery, setAuthToken } from '../lib/db';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Optimistically load user data from localStorage
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('splitmate-user');
      return saved ? JSON.parse(saved).user : null;
    } catch { return null; }
  });

  const [role, setRole] = useState(() => {
    try {
      const saved = localStorage.getItem('splitmate-user');
      return saved ? JSON.parse(saved).role : null;
    } catch { return null; }
  });

  // If we have a cached user, don't show the loading screen initially
  const [loading, setLoading] = useState(!user);

  // Global log out listener for interceptors
  useEffect(() => {
    const handleLogout = () => {
      localStorage.removeItem('splitmate-user');
      if ('caches' in window) {
        caches.keys().then(names => Promise.all(names.map(name => caches.delete(name))));
      }
      setUser(null);
      setRole(null);
    };
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchUserRoleSilently = async (sessionUser) => {
      try {
        const userData = await dbQuery('users', `id=eq.${sessionUser.id}&select=role,full_name,avatar_url`);
        const data = userData?.[0];

        if (mounted && data) {
          const updatedUser = {
            ...sessionUser,
            full_name: data.full_name || sessionUser.user_metadata?.full_name,
            avatar_url: data.avatar_url || sessionUser.user_metadata?.avatar_url
          };
          const userRole = data.role ?? 'member';

          setUser(updatedUser);
          setRole(userRole);

          localStorage.setItem('splitmate-user', JSON.stringify({
            user: updatedUser,
            role: userRole
          }));
        }
      } catch (e) {
        console.error('Failed fetching fresh user data silently', e);
      }
    };

    const initializeAuth = async () => {
      try {
        // Use SDK's native session validation
        const { data: sessionData, error } = await insforge.auth.getCurrentSession();
        const session = sessionData?.session;

        if (error) {
          console.error("Auth init session error:", error);
          return;
        }

        if (session?.accessToken) {
          setAuthToken(session.accessToken);
          // Silently validate and fetch role in the background
          await fetchUserRoleSilently(session.user);
        } else {
          // No valid session, gently clear local data
          setUser(null);
          setRole(null);
          localStorage.removeItem('splitmate-user');
        }
      } catch (err) {
        console.error("Auth init exception:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initializeAuth();

    // Listen to SDK native auth state changes, such as token refreshes!
    const { data: authListener } = insforge.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        window.dispatchEvent(new Event('auth:logout'));
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setAuthToken(session.accessToken);
        if (event === 'SIGNED_IN') {
          // Let the signIn function handle the initial setup instead to avoid race conditions
        }
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email, password) => {
    const res = await fetch(`${import.meta.env.VITE_INSFORGE_URL}/api/auth/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_INSFORGE_ANON_KEY,
        'Authorization': `Bearer ${import.meta.env.VITE_INSFORGE_ANON_KEY}`
      },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Invalid email or password');

    // Set SDK token immediately after login
    setAuthToken(data.accessToken);

    let userRole = 'member';
    let fullName = 'Member';
    try {
      const userData = await dbQuery('users', `id=eq.${data.user.id}&select=role,full_name,avatar_url`);
      userRole = userData?.[0]?.role ?? 'member';
      fullName = userData?.[0]?.full_name ?? 'Member';
      const avatarUrl = userData?.[0]?.avatar_url;
      if (fullName !== 'Member') data.user.full_name = fullName;
      if (avatarUrl) data.user.avatar_url = avatarUrl;
    } catch (e) {
      console.log('Role fetch failed:', e);
    }

    setUser(data.user);
    setRole(userRole);
    localStorage.setItem('splitmate-user', JSON.stringify({
      user: data.user,
      role: userRole,
    }));
    window.location.replace(userRole === 'admin' ? '/admin' : '/dashboard');
  };

  const signOut = async () => {
    await insforge.auth.signOut().catch(() => { });
    window.dispatchEvent(new Event('auth:logout'));
    window.location.replace('/login');
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
