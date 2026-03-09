import { createContext, useContext, useEffect, useState } from 'react';
import insforge, { dbQuery, setAuthToken } from '../lib/db';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Optimistically load user data from localStorage and set token synchronously
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('splitmate-user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.token) {
          setAuthToken(parsed.token);
        }
        return parsed.user || null;
      }
      return null;
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

  useEffect(() => {
    let mounted = true;

    const validateSessionSilently = async () => {
      try {
        const saved = localStorage.getItem('splitmate-user');
        if (!saved) {
          if (mounted) setLoading(false);
          return;
        }

        const parsed = JSON.parse(saved);
        const sessionUser = parsed.user;
        let token = parsed.token;
        const refreshToken = parsed.refreshToken;

        if (token && sessionUser) {
          // Proactive Refresh if expired on load
          const isTokenExpired = () => {
            try {
              const payload = JSON.parse(atob(token.split('.')[1]));
              return payload.exp * 1000 < Date.now() + 5000;
            } catch { return true; }
          };

          if (isTokenExpired() && refreshToken) {
            let res;
            try {
              const backendUrl = import.meta.env.VITE_INSFORGE_URL;
              res = await fetch(`${backendUrl}/api/auth/refresh?client_type=mobile`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': import.meta.env.VITE_INSFORGE_ANON_KEY
                },
                body: JSON.stringify({ refreshToken })
              });
            } catch (networkErr) {
              console.error('Network offline, session dormant', networkErr);
            }

            if (res) {
              try {
                const resData = await res.json();
                if (res.ok && resData.accessToken && resData.refreshToken) {
                  token = resData.accessToken;
                  setAuthToken(token);
                  parsed.token = token;
                  parsed.refreshToken = resData.refreshToken;
                  localStorage.setItem('splitmate-user', JSON.stringify(parsed));
                } else {
                  console.error('Network offline, session dormant');
                }
              } catch (jsonErr) {
                console.error('Network offline, session dormant', jsonErr);
              }
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

              localStorage.setItem('splitmate-user', JSON.stringify({
                user: updatedUser,
                role: userRole,
                token,
                refreshToken: parsed.refreshToken
              }));
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
    localStorage.setItem('splitmate-user', JSON.stringify({
      user: data.user,
      role: userRole,
      token: data.accessToken, // Save token for optimistic loading
      refreshToken: data.refreshToken
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
