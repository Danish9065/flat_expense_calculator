import { createClient } from '@insforge/sdk';

export const AUTH_STORAGE_KEY = 'splitmate-user';
const AUTH_REFRESH_LOCK = 'splitmate-auth-refresh';

export interface PersistentAuthSession {
  user: Record<string, unknown>;
  role: string;
  version?: number;
  updatedAt?: string;
  sessionMode?: 'cookie' | 'legacy';
  /** Legacy migration only. New sessions use an httpOnly first-party cookie. */
  token?: string;
  /** Legacy migration only. Removed after the next cookie-backed sign-in. */
  refreshToken?: string;
}

export type RefreshResult =
  | { status: 'refreshed'; session: PersistentAuthSession; accessToken: string }
  | { status: 'unavailable'; session: PersistentAuthSession | null; reason: string };

const backendUrl = import.meta.env.VITE_INSFORGE_URL;
const authBaseUrl = import.meta.env.VITE_AUTH_PROXY_URL
  || (import.meta.env.PROD && typeof window !== 'undefined' ? window.location.origin : backendUrl);

/**
 * Authentication deliberately uses a separate client.
 *
 * In production its base URL is the app origin, where the Vercel auth proxy
 * converts InsForge's refresh cookie into a first-party cookie. Database calls
 * continue to use the direct InsForge client for lower latency.
 */
export const authClient = createClient({
  baseUrl: authBaseUrl,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY,
  retryCount: 1,
});

let refreshPromise: Promise<RefreshResult> | null = null;

export function readPersistentSession(): PersistentAuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PersistentAuthSession;
    if (!parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistentSession(session: PersistentAuthSession) {
  const normalized: PersistentAuthSession = {
    ...session,
    version: 2,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function writeCookieSession(user: Record<string, unknown>, role: string) {
  return writePersistentSession({ user, role, sessionMode: 'cookie' });
}

export function clearPersistentSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function isSessionRefreshDue(session: PersistentAuthSession | null, maxAgeMs = 4 * 60_000) {
  if (!session?.updatedAt) return true;
  const updatedAt = Date.parse(session.updatedAt);
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt >= maxAgeMs;
}

async function refreshCookieSession(snapshot: PersistentAuthSession | null): Promise<RefreshResult> {
  const { data, error } = await authClient.auth.refreshSession();
  if (error || !data?.accessToken || !data.user) {
    return {
      status: 'unavailable',
      session: snapshot,
      reason: error?.message || 'No active browser session was returned',
    };
  }

  const session = writeCookieSession(
    data.user as unknown as Record<string, unknown>,
    snapshot?.role || 'member',
  );
  return { status: 'refreshed', session, accessToken: data.accessToken };
}

/**
 * Keeps users who signed in through the previous mobile-token implementation
 * working until their next normal sign-in migrates them to first-party cookies.
 */
async function refreshLegacySession(snapshot: PersistentAuthSession): Promise<RefreshResult> {
  if (!snapshot.refreshToken) {
    return { status: 'unavailable', session: snapshot, reason: 'No legacy refresh token is available' };
  }

  try {
    const response = await fetch(`${backendUrl}/api/auth/refresh?client_type=mobile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_INSFORGE_ANON_KEY,
      },
      body: JSON.stringify({ refreshToken: snapshot.refreshToken }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.accessToken) {
      return {
        status: 'unavailable',
        session: snapshot,
        reason: data?.message || `Legacy session refresh returned ${response.status}`,
      };
    }

    const updated = writePersistentSession({
      ...snapshot,
      user: (data.user || snapshot.user) as Record<string, unknown>,
      token: data.accessToken,
      refreshToken: data.refreshToken || snapshot.refreshToken,
      sessionMode: 'legacy',
    });
    return { status: 'refreshed', session: updated, accessToken: data.accessToken };
  } catch (error) {
    return {
      status: 'unavailable',
      session: snapshot,
      reason: error instanceof Error ? error.message : 'Legacy session refresh is unavailable',
    };
  }
}

async function performRefresh(): Promise<RefreshResult> {
  const snapshot = readPersistentSession();

  try {
    const cookieResult = await refreshCookieSession(snapshot);
    if (cookieResult.status === 'refreshed') return cookieResult;
    if (snapshot?.refreshToken) return refreshLegacySession(snapshot);
    return cookieResult;
  } catch (error) {
    if (snapshot?.refreshToken) return refreshLegacySession(snapshot);
    return {
      status: 'unavailable',
      session: snapshot,
      reason: error instanceof Error ? error.message : 'Session refresh is temporarily unavailable',
    };
  }
}

async function performRefreshWithCrossTabLock() {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(AUTH_REFRESH_LOCK, performRefresh);
  }
  return performRefresh();
}

/**
 * Refreshes through the first-party cookie proxy and deduplicates concurrent
 * refreshes in this tab. Web Locks also serializes refresh-token rotation across
 * browser tabs, preventing one tab from invalidating another tab's request.
 */
export async function refreshPersistentSession(): Promise<RefreshResult> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = performRefreshWithCrossTabLock();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
