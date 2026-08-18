export const AUTH_STORAGE_KEY = 'splitmate-user';

export interface PersistentAuthSession {
  user: Record<string, unknown>;
  role: string;
  token: string;
  refreshToken?: string;
  version?: number;
  updatedAt?: string;
}

export type RefreshResult =
  | { status: 'refreshed'; session: PersistentAuthSession }
  | { status: 'unavailable'; session: PersistentAuthSession | null; reason: string }
  | { status: 'missing'; session: null; reason: string };

let refreshPromise: Promise<RefreshResult> | null = null;

export function readPersistentSession(): PersistentAuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PersistentAuthSession;
    if (!parsed?.user || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistentSession(session: PersistentAuthSession) {
  const normalized = {
    ...session,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearPersistentSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function isAccessTokenExpiring(token: string, leewayMs = 60_000) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now() + leewayMs;
  } catch {
    return true;
  }
}

/**
 * Refreshes the stored access token without ever deleting the durable login.
 * Only the explicit sign-out flow is allowed to clear the saved session.
 */
export async function refreshPersistentSession(): Promise<RefreshResult> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const session = readPersistentSession();
    if (!session) return { status: 'missing', session: null, reason: 'No saved session' } as const;
    if (!session.refreshToken) {
      return { status: 'unavailable', session, reason: 'No refresh token is available' } as const;
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_INSFORGE_URL}/api/auth/refresh?client_type=mobile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_INSFORGE_ANON_KEY,
        },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.accessToken) {
        return {
          status: 'unavailable',
          session,
          reason: data?.message || `Session refresh returned ${response.status}`,
        } as const;
      }

      const updated = writePersistentSession({
        ...session,
        token: data.accessToken,
        refreshToken: data.refreshToken || session.refreshToken,
      });
      return { status: 'refreshed', session: updated } as const;
    } catch (error) {
      return {
        status: 'unavailable',
        session,
        reason: error instanceof Error ? error.message : 'Session refresh is temporarily unavailable',
      } as const;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
