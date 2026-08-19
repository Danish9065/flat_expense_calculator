import type { ReactElement, ReactNode } from 'react';

export interface AuthUser {
  id: string;
  email?: string;
  full_name?: string;
  avatar_url?: string;
  currency?: string;
  user_metadata?: Record<string, unknown>;
}

export interface AuthContextValue {
  user: AuthUser | null;
  role: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<AuthUser>;
}

export function AuthProvider(props: { children: ReactNode }): ReactElement;
export function useAuth(): AuthContextValue;
