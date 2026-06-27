import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isStaff } from '../types';
import { FullPageSpinner } from './Spinner';

/** Like ProtectedRoute, but requires admin OR semi-admin (staff). */
export function StaffRoute() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isStaff(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
