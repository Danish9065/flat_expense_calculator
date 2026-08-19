import { createContext, useContext, useEffect, useState } from 'react';
import { supabaseClient } from '../lib/db';
import {
  clearPersistentSession,
  writePersistentSession,
} from '../lib/authSession';

const AuthContext = createContext(null);

async function provisionProfileFromMetadata(authUser) {
  const metadata = authUser.user_metadata || {};
  if (!metadata.full_name) return null;

  const { data: profile, error: profileError } = await supabaseClient
    .from('users')
    .upsert({
      id: authUser.id,
      email: authUser.email,
      full_name: metadata.full_name,
      role: 'member',
    }, { onConflict: 'id', ignoreDuplicates: true })
    .select('role,full_name,avatar_url,currency')
    .maybeSingle();

  if (profileError) throw profileError;

  if (metadata.whatsapp_number || metadata.upi_id) {
    const { error } = await supabaseClient.from('user_payment_profiles').upsert({
      user_id: authUser.id,
      whatsapp_number: metadata.whatsapp_number || null,
      upi_id: metadata.upi_id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
  }

  if (metadata.invite_key) {
    const { error } = await supabaseClient.rpc('consume_invite_key', {
      key_code_param: metadata.invite_key,
      target_user_id: authUser.id,
    });
    // Provisioning is idempotent: a previously consumed key means this step
    // already completed on another tab/device.
    if (error && !/already used|invalid/i.test(error.message)) throw error;
  }

  return profile;
}

async function hydrateAppUser(authUser) {
  let { data: profile, error } = await supabaseClient
    .from('users')
    .select('role,full_name,avatar_url,currency')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error) throw error;
  if (!profile) profile = await provisionProfileFromMetadata(authUser);

  const hydratedUser = {
    ...authUser,
    full_name: profile?.full_name || authUser.user_metadata?.full_name || 'Member',
    avatar_url: profile?.avatar_url || authUser.user_metadata?.avatar_url || null,
    currency: profile?.currency || '₹',
  };
  const role = profile?.role || 'member';
  writePersistentSession({ user: hydratedUser, role });
  return { user: hydratedUser, role };
}

export function AuthProvider({ children }) {
  // Do not expose the display cache as an authenticated identity. Supabase
  // restores its persisted session asynchronously, and consumers must wait for
  // that authoritative result before making RLS-protected requests.
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const adoptSession = async (session) => {
      if (!session?.user) {
        if (active) {
          clearPersistentSession();
          setUser(null);
          setRole(null);
        }
        return;
      }

      try {
        const hydrated = await hydrateAppUser(session.user);
        if (active) {
          setUser(hydrated.user);
          setRole(hydrated.role);
        }
      } catch (error) {
        console.error('Failed to load the authenticated profile', error);
        if (active) {
          setUser(session.user);
          setRole('member');
        }
      }
    };

    supabaseClient.auth.getSession()
      .then(({ data }) => adoptSession(data.session))
      .finally(() => { if (active) setLoading(false); });

    const { data: listener } = supabaseClient.auth.onAuthStateChange((event, session) => {
      // Defer database work until the auth callback releases its internal lock.
      window.setTimeout(() => {
        if (event === 'SIGNED_OUT') {
          clearPersistentSession();
          if (active) {
            setUser(null);
            setRole(null);
          }
          return;
        }
        if (session?.user) void adoptSession(session);
      }, 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const refreshWhenActive = async () => {
      const { data } = await supabaseClient.auth.getSession();
      if (data.session) await supabaseClient.auth.refreshSession();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshWhenActive();
    };

    window.addEventListener('online', refreshWhenActive);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', refreshWhenActive);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const signIn = async (email, password) => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error || !data.user || !data.session) {
      throw new Error(error?.message || 'Invalid email or password');
    }

    const hydrated = await hydrateAppUser(data.user);
    setUser(hydrated.user);
    setRole(hydrated.role);
    window.location.replace(hydrated.role === 'admin' ? '/admin' : '/dashboard');
  };

  const signOut = async () => {
    const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
    if (error) console.error('Supabase sign-out failed', error);
    clearPersistentSession();
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
