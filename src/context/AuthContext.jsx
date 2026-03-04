import { createContext, useContext, useEffect, useState } from 'react';
import { dbQuery, setAuthToken } from '../lib/db';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const saved = localStorage.getItem('splitmate-user');
        if (saved) {
          const parsed = JSON.parse(saved);
          // Set SDK token BEFORE making any DB calls
          if (parsed.token) setAuthToken(parsed.token);
          try {
            const userData = await dbQuery('users', `id=eq.${parsed.user.id}&select=role,full_name,avatar_url`);
            const data = userData?.[0];
            if (data?.full_name) parsed.user.full_name = data.full_name;
            if (data?.avatar_url) parsed.user.avatar_url = data.avatar_url;
            parsed.role = data?.role ?? parsed.role;
          } catch (e) {
            console.error('Failed fetching fresh user data', e);
          }
          setUser(parsed.user);
          setRole(parsed.role);
        }
      } catch {
        localStorage.removeItem('splitmate-user');
      } finally {
        setLoading(false);
      }
    };
    init();
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
      fullName,
      token: data.accessToken
    }));
    window.location.replace(userRole === 'admin' ? '/admin' : '/dashboard');
  };

  const signOut = async () => {
    localStorage.removeItem('splitmate-user');
    setUser(null);
    setRole(null);
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
