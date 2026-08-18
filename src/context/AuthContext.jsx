import { createContext, useContext, useEffect, useState } from 'react';
import { dbQuery, setAuthToken, setLegacyRefreshToken } from '../lib/db';
import {
  AUTH_STORAGE_KEY,
  authClient,
  clearPersistentSession,
  isSessionRefreshDue,
  readPersistentSession,
  refreshPersistentSession,
  writeCookieSession,
  writePersistentSession,
} from '../lib/authSession';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Optimistically load user data from localStorage and set token synchronously
  const [user, setUser] = useState(() => {
    const saved = readPersistentSession();
    if (saved?.token) setAuthToken(saved.token);
    if (saved?.refreshToken) setLegacyRefreshToken(saved.refreshToken);
    return saved?.user || null;
  });

  const [role, setRole] = useState(() => readPersistentSession()?.role || null);

  // Always complete the server/cookie restore before route guards decide where to go.
  const [loading, setLoading] = useState(true);

  // Global log out listener for interceptors
  useEffect(() => {
    const handleLogout = () => {
      clearPersistentSession();
      setAuthToken(null);
      setLegacyRefreshToken(null);
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
      if (!saved) {
        setAuthToken(null);
        setLegacyRefreshToken(null);
      } else {
        if (saved.token) setAuthToken(saved.token);
        if (saved.refreshToken) setLegacyRefreshToken(saved.refreshToken);
      }
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
        const cached = readPersistentSession();
        const refreshResult = await refreshPersistentSession();
        const activeSession = refreshResult.status === 'refreshed' ? refreshResult.session : cached;
        const sessionUser = activeSession?.user;

        if (refreshResult.status === 'refreshed') {
          setAuthToken(refreshResult.accessToken);
          if (refreshResult.session.refreshToken) {
            setLegacyRefreshToken(refreshResult.session.refreshToken);
          }
        }

        if (sessionUser) {
          if (mounted) {
            setUser(sessionUser);
            setRole(activeSession?.role || 'member');
          }

          // Silently validate and fetch role in the background
          try {
            const userData = await dbQuery('users', `id=eq.${sessionUser.id}&select=role,full_name,avatar_url,currency`);
            const data = userData?.[0];

            if (mounted && data) {
              const updatedUser = {
                ...sessionUser,
                full_name: data.full_name || sessionUser.user_metadata?.full_name,
                avatar_url: data.avatar_url || sessionUser.user_metadata?.avatar_url,
                currency: data.currency || sessionUser.currency,
              };
              const userRole = data.role ?? 'member';

              setUser(updatedUser);
              setRole(userRole);

              if (activeSession?.sessionMode === 'legacy') {
                writePersistentSession({ ...activeSession, user: updatedUser, role: userRole });
              } else {
                writeCookieSession(updatedUser, userRole);
              }
            }
          } catch (e) {
            console.error('Failed fetching fresh user data silently', e);
            // Leave session dormant. Do NOT wipe localStorage.
          }
        } else {
          // No cookie and no cached identity means the user has never signed in on this device.
          if (mounted) {
            setUser(null);
            setRole(null);
            setAuthToken(null);
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
      if (!saved || !isSessionRefreshDue(saved)) return;
      const result = await refreshPersistentSession();
      if (result.status === 'refreshed') {
        setAuthToken(result.accessToken);
        setUser(result.session.user);
        setRole(result.session.role);
      }
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
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data?.accessToken || !data.user) {
      throw new Error(error?.message || 'Invalid email or password');
    }

    // Keep the direct database client synchronized with the cookie-backed auth client.
    setAuthToken(data.accessToken);
    setLegacyRefreshToken(null);

    let userRole = 'member';
    let fullName = 'Member';
    try {
      const userData = await dbQuery('users', `id=eq.${data.user.id}&select=role,full_name,avatar_url,currency`);
      userRole = userData?.[0]?.role ?? 'member';
      fullName = userData?.[0]?.full_name ?? 'Member';
      const avatarUrl = userData?.[0]?.avatar_url;
      const currency = userData?.[0]?.currency;
      if (fullName !== 'Member') data.user.full_name = fullName;
      if (avatarUrl) data.user.avatar_url = avatarUrl;
      if (currency) data.user.currency = currency;
    } catch (e) {
      console.log('Role fetch failed:', e);
    }

    setUser(data.user);
    setRole(userRole);
    writeCookieSession(data.user, userRole);
    window.location.replace(userRole === 'admin' ? '/admin' : '/dashboard');
  };

  const signOut = async () => {
    await authClient.auth.signOut().catch(() => { });
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
