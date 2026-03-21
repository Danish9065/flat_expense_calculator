declare module '../context/AuthContext' {
    export interface AuthUser {
        id: string;
        email?: string;
        full_name?: string;
        avatar_url?: string;
        user_metadata?: Record<string, any>;
    }

    export interface AuthContextValue {
        user: AuthUser | null;
        role: string | null;
        loading: boolean;
        signIn: (email: string, password: string) => Promise<void>;
        signOut: () => Promise<void>;
    }

    export function AuthProvider(props: { children: React.ReactNode }): JSX.Element;
    export function useAuth(): AuthContextValue;
}
