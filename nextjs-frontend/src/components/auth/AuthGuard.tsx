'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  requireAuth?: boolean;
  redirectTo?: string;
  requiredRole?: 'user' | 'admin';
  allowedRoles?: ('user' | 'admin')[];
  message?: string;
}

export function AuthGuard({
  children,
  fallback,
  requireAuth = true,
  redirectTo = '/login',
  requiredRole,
  allowedRoles,
  message,
}: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, user, checkAndRefreshToken } = useAuthStore();
  const [isChecking, setIsChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      setIsChecking(true);
      setAuthError(null);

      if (requireAuth) {
        // Check if user is authenticated and token is valid
        const isValid = await checkAndRefreshToken();
        
        if (!isValid) {
          // Build redirect URL with current path for return after login
          const currentPath = pathname;
          const loginUrl = currentPath !== '/' && currentPath !== '/login' 
            ? `${redirectTo}?redirect=${encodeURIComponent(currentPath)}`
            : redirectTo;
          
          if (message) {
            const urlWithMessage = `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}message=${encodeURIComponent(message)}`;
            router.push(urlWithMessage);
          } else {
            router.push(loginUrl);
          }
          return;
        }

        // Check role requirements
        if (requiredRole && user?.role !== requiredRole) {
          setAuthError(`This page requires ${requiredRole} access.`);
          router.push('/unauthorized');
          return;
        }

        if (allowedRoles && !allowedRoles.includes(user?.role as any)) {
          setAuthError(`This page requires one of the following roles: ${allowedRoles.join(', ')}.`);
          router.push('/unauthorized');
          return;
        }
      } else {
        // If auth is not required but user is authenticated, redirect to dashboard
        if (isAuthenticated) {
          router.push('/dashboard');
          return;
        }
      }

      setIsChecking(false);
    };

    checkAuth();
  }, [isAuthenticated, requireAuth, requiredRole, allowedRoles, user?.role, router, redirectTo, checkAndRefreshToken, pathname, message]);

  // Show loading state
  if (isLoading || isChecking) {
    return (
      fallback || (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          minHeight="100vh"
          gap={2}
          sx={{
            background: (theme) => 
              theme.palette.mode === 'dark'
                ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
                : 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
          }}
        >
          <CircularProgress size={40} />
          <Typography variant="body2" color="text.secondary">
            {requireAuth ? 'Checking authentication...' : 'Loading...'}
          </Typography>
        </Box>
      )
    );
  }

  // Show error if there's an auth error
  if (authError) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="100vh"
        gap={2}
        sx={{ p: 3 }}
      >
        <Alert severity="error" sx={{ maxWidth: 400 }}>
          {authError}
        </Alert>
      </Box>
    );
  }

  // If auth is required but user is not authenticated, don't render children
  if (requireAuth && !isAuthenticated) {
    return null;
  }

  // If auth is not required but user is authenticated, don't render children (will redirect)
  if (!requireAuth && isAuthenticated) {
    return null;
  }

  // If role is required but user doesn't have it, don't render children
  if (requiredRole && user?.role !== requiredRole) {
    return null;
  }

  if (allowedRoles && !allowedRoles.includes(user?.role as any)) {
    return null;
  }

  return <>{children}</>;
}

// Convenience components for common use cases
export function ProtectedRoute({ children, ...props }: Omit<AuthGuardProps, 'requireAuth'>) {
  return (
    <AuthGuard requireAuth={true} {...props}>
      {children}
    </AuthGuard>
  );
}

export function PublicRoute({ children, ...props }: Omit<AuthGuardProps, 'requireAuth'>) {
  return (
    <AuthGuard requireAuth={false} {...props}>
      {children}
    </AuthGuard>
  );
}

export function AdminRoute({ children, ...props }: Omit<AuthGuardProps, 'requireAuth' | 'requiredRole'>) {
  return (
    <AuthGuard requireAuth={true} requiredRole="admin" {...props}>
      {children}
    </AuthGuard>
  );
}