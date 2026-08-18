import { createContext, useContext, useEffect, useState } from 'react';
import insforge, { dbQuery, setAuthToken } from '../lib/db';
import {
  AUTH_STORAGE_KEY,
  clearPersistentSession,
  isAccessTokenExpiring,
  readPersistentSession,
  refreshPersistentSession,
  writePersistentSession,
} from '../lib/authSession';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Optimistically load user data from localStorage and set token synchronously
  const [user, setUser] = useState(() => {
    const saved = readPersistentSession();
    if (saved?.token) setAuthToken(saved.token);
    return saved?.user || null;
  });

  const [role, setRole] = useState(() => readPersistentSession()?.role || null);

  // If we have a cached user, don't show the loading screen initially
  const [loading, setLoading] = useState(!user);

  // Global log out listener for interceptors
  useEffect(() => {
    const handleLogout = () => {
      clearPersistentSession();
      setAuthToken(null);
      if ('caches' in window) {
        caches.keys().then(names => Promise.all(names.map(name => caches.delete(name))));
      }
      setUser(null);
      setRole(null);
    };
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  // Keep every open tab in sync. Removing the session in one tab logs out the others;
  // token rotations and profile updates are also adopted without a reload.
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== AUTH_STORAGE_KEY) return;
      const saved = readPersistentSession();
      setAuthToken(saved?.token || null);
      setUser(saved?.user || null);
      setRole(saved?.role || null);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    let mounted = true;

    const validateSessionSilently = async () => {
      try {
        const parsed = readPersistentSession();
        if (!parsed) {
          if (mounted) setLoading(false);
          return;
        }

        const sessionUser = parsed.user;
        let token = parsed.token;

        if (token && sessionUser) {
          // Refresh before validation when a restored access token is near expiry.
          if (isAccessTokenExpiring(token, 60_000)) {
            const refreshResult = await refreshPersistentSession();
            if (refreshResult.status === 'refreshed') {
              token = refreshResult.session.token;
              parsed.refreshToken = refreshResult.session.refreshToken;
              setAuthToken(token);
            }
          }

          // Silently validate and fetch role in the background
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

              writePersistentSession({
                user: updatedUser,
                role: userRole,
                token,
                refreshToken: parsed.refreshToken
              });
            }
          } catch (e) {
            console.error('Failed fetching fresh user data silently', e);
            // Leave session dormant. Do NOT wipe localStorage.
          }
        } else {
          // No valid token/user in cache, gracefully downgrade to logged out state without wiping other local data aggressively.
          if (mounted) {
            setUser(null);
            setRole(null);
            setAuthToken(null);
            // DO NOT aggressively call localStorage.removeItem here, ensure logout is explicit.
          }
        }
      } catch (err) {
        console.error("Auth init exception:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    validateSessionSilently();

    return () => {
      mounted = false;
    };
  }, []);

  // Refresh in the background while the app is open, and immediately after the
  // device reconnects or the user returns to the tab.
  useEffect(() => {
    const keepSessionFresh = async () => {
      const saved = readPersistentSession();
      if (!saved || !isAccessTokenExpiring(saved.token, 5 * 60_000)) return;
      const result = await refreshPersistentSession();
      if (result.status === 'refreshed') setAuthToken(result.session.token);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void keepSessionFresh();
    };
    const intervalId = window.setInterval(() => void keepSessionFresh(), 4 * 60_000);
    window.addEventListener('online', keepSessionFresh);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', keepSessionFresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const signIn = async (email, password) => {
    const res = await fetch(`${import.meta.env.VITE_INSFORGE_URL}/api/auth/sessions?client_type=mobile`, {
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
    writePersistentSession({
      user: data.user,
      role: userRole,
      token: data.accessToken, // Save token for optimistic loading
      refreshToken: data.refreshToken
    });
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
