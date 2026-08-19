import type { User } from '@supabase/supabase-js';
import { supabaseClient } from './db';

export const AUTH_STORAGE_KEY = 'splitmate-user';

export interface PersistentAuthSession {
  user: Record<string, unknown>;
  role: string;
  version?: number;
  updatedAt?: string;
}

export type RefreshResult =
  | { status: 'refreshed'; session: PersistentAuthSession; accessToken: string }
  | { status: 'unavailable'; session: PersistentAuthSession | null; reason: string };

export const authClient = supabaseClient;

export function readPersistentSession(): PersistentAuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistentAuthSession;
    return parsed?.user ? parsed : null;
  } catch {
    return null;
  }
}

export function writePersistentSession(session: PersistentAuthSession) {
  const normalized: PersistentAuthSession = {
    ...session,
    version: 3,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function writeCookieSession(user: Record<string, unknown>, role: string) {
  return writePersistentSession({ user, role });
}

export function clearPersistentSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function isSessionRefreshDue(session: PersistentAuthSession | null, maxAgeMs = 4 * 60_000) {
  if (!session?.updatedAt) return true;
  const updatedAt = Date.parse(session.updatedAt);
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt >= maxAgeMs;
}

function cacheUser(user: User, role: string) {
  return writePersistentSession({
    user: user as unknown as Record<string, unknown>,
    role,
  });
}

export async function refreshPersistentSession(): Promise<RefreshResult> {
  const snapshot = readPersistentSession();
  const { data, error } = await supabaseClient.auth.refreshSession();
  if (error || !data.session?.access_token || !data.user) {
    return {
      status: 'unavailable',
      session: snapshot,
      reason: error?.message || 'No active Supabase session was returned',
    };
  }

  const session = cacheUser(data.user, snapshot?.role || 'member');
  return { status: 'refreshed', session, accessToken: data.session.access_token };
}
