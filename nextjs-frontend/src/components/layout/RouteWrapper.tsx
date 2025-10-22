'use client';

import { AuthGuard, ProtectedRoute, PublicRoute, AdminRoute } from '@/components/auth/AuthGuard';
import { AuthenticatedLayout } from './AuthenticatedLayout';
import { PublicLayout } from './PublicLayout';

export type RouteType = 'public' | 'protected' | 'admin' | 'guest-only';

interface RouteWrapperProps {
  children: React.ReactNode;
  type: RouteType;
  title?: string;
  showHeader?: boolean;
  showFooter?: boolean;
  showSidebar?: boolean;
  message?: string;
  redirectTo?: string;
}

export function RouteWrapper({
  children,
  type,
  title,
  showHeader = true,
  showFooter = true,
  showSidebar = true,
  message,
  redirectTo,
}: RouteWrapperProps) {
  // Public routes (no authentication required)
  if (type === 'public') {
    return (
      <PublicLayout showHeader={showHeader} showFooter={showFooter}>
        {children}
      </PublicLayout>
    );
  }

  // Guest-only routes (redirect if authenticated)
  if (type === 'guest-only') {
    return (
      <PublicRoute redirectTo={redirectTo}>
        <PublicLayout showHeader={showHeader} showFooter={showFooter}>
          {children}
        </PublicLayout>
      </PublicRoute>
    );
  }

  // Protected routes (authentication required)
  if (type === 'protected') {
    return (
      <ProtectedRoute message={message} redirectTo={redirectTo}>
        <AuthenticatedLayout title={title} showSidebar={showSidebar}>
          {children}
        </AuthenticatedLayout>
      </ProtectedRoute>
    );
  }

  // Admin routes (admin role required)
  if (type === 'admin') {
    return (
      <AdminRoute message={message} redirectTo={redirectTo}>
        <AuthenticatedLayout title={title} showSidebar={showSidebar}>
          {children}
        </AuthenticatedLayout>
      </AdminRoute>
    );
  }

  // Fallback to public layout
  return (
    <PublicLayout showHeader={showHeader} showFooter={showFooter}>
      {children}
    </PublicLayout>
  );
}

export default RouteWrapper;