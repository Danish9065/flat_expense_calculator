const RECOVERY_MARKER_KEY = 'splitmate-password-recovery-started-at';
const RECOVERY_MARKER_MAX_AGE_MS = 60 * 60 * 1000;

export function hasPasswordRecoveryParams(location: Pick<Location, 'search' | 'hash'>): boolean {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  return search.has('code') || search.get('type') === 'recovery' || hash.get('type') === 'recovery';
}

export function markPasswordRecoverySession(): void {
  sessionStorage.setItem(RECOVERY_MARKER_KEY, String(Date.now()));
}

export function hasActivePasswordRecoverySession(): boolean {
  const startedAt = Number(sessionStorage.getItem(RECOVERY_MARKER_KEY));
  return Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < RECOVERY_MARKER_MAX_AGE_MS;
}

export function clearPasswordRecoverySession(): void {
  sessionStorage.removeItem(RECOVERY_MARKER_KEY);
}
