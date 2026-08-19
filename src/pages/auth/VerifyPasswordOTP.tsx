import { Navigate } from 'react-router-dom';

/** Legacy route retained for bookmarks; Supabase password recovery uses email links. */
export default function VerifyPasswordOTP() {
    return <Navigate to="/forgot-password" replace />;
}
