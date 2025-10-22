'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { withErrorHandling } from '@/lib/api/utils';
import { authAPI } from '@/lib/api';
import type { LoginCredentials, RegisterData } from '@/types';

export function useAuth() {
  const router = useRouter();
  const {
    user,
    isAuthenticated,
    isLoading,
    login: storeLogin,
    register: storeRegister,
    logout: storeLogout,
    updateUser,
    checkAndRefreshToken,
  } = useAuthStore();

  const login = useCallback(
    async (credentials: LoginCredentials, redirectTo = '/dashboard') => {
      return withErrorHandling(
        () => storeLogin(credentials),
        {
          onSuccess: () => {
            router.push(redirectTo);
          },
          showSuccessToast: true,
          successMessage: `Welcome back, ${credentials.email}!`,
        }
      );
    },
    [storeLogin, router]
  );

  const register = useCallback(
    async (data: RegisterData, redirectTo = '/dashboard') => {
      return withErrorHandling(
        () => storeRegister(data),
        {
          onSuccess: () => {
            router.push(redirectTo);
          },
          showSuccessToast: true,
          successMessage: `Welcome to SnapURL, ${data.name}!`,
        }
      );
    },
    [storeRegister, router]
  );

  const logout = useCallback(
    (redirectTo = '/') => {
      storeLogout();
      router.push(redirectTo);
    },
    [storeLogout, router]
  );

  const requireAuth = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated) {
      router.push('/login');
      return false;
    }

    const isValid = await checkAndRefreshToken();
    if (!isValid) {
      router.push('/login');
      return false;
    }

    return true;
  }, [isAuthenticated, checkAndRefreshToken, router]);

  const requireRole = useCallback(
    (role: 'user' | 'admin'): boolean => {
      if (!user || user.role !== role) {
        router.push('/unauthorized');
        return false;
      }
      return true;
    },
    [user, router]
  );

  // Request password reset
  const requestPasswordReset = useCallback(
    async (email: string) => {
      return withErrorHandling(
        () => authAPI.requestPasswordReset(email),
        {
          showSuccessToast: true,
          successMessage: 'Password reset email sent',
        }
      );
    },
    []
  );

  // Reset password with token
  const resetPassword = useCallback(
    async (token: string, newPassword: string) => {
      return withErrorHandling(
        () => authAPI.resetPassword(token, newPassword),
        {
          showSuccessToast: true,
          successMessage: 'Password reset successfully',
          onSuccess: () => {
            router.push('/login');
          },
        }
      );
    },
    [router]
  );

  // Verify email
  const verifyEmail = useCallback(
    async (token: string) => {
      return withErrorHandling(
        async () => {
          await authAPI.verifyEmail(token);
          // Refresh user data to update email verification status
          if (user) {
            const updatedUser = await authAPI.getProfile();
            updateUser(updatedUser);
          }
        },
        {
          showSuccessToast: true,
          successMessage: 'Email verified successfully',
        }
      );
    },
    [user, updateUser]
  );

  // Resend email verification
  const resendEmailVerification = useCallback(
    async () => {
      return withErrorHandling(
        () => authAPI.resendEmailVerification(),
        {
          showSuccessToast: true,
          successMessage: 'Verification email sent',
        }
      );
    },
    []
  );

  // Get user initials for avatar
  const getUserInitials = useCallback(() => {
    if (!user?.name) return 'U';
    return user.name
      .split(' ')
      .map(name => name.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }, [user]);

  // Get user display name
  const getDisplayName = useCallback(() => {
    return user?.name || user?.email || 'User';
  }, [user]);

  return {
    // State
    user,
    isAuthenticated,
    isLoading,

    // Actions
    login,
    register,
    logout,
    updateUser,
    requestPasswordReset,
    resetPassword,
    verifyEmail,
    resendEmailVerification,

    // Utilities
    requireAuth,
    requireRole,
    checkAndRefreshToken,
    getUserInitials,
    getDisplayName,

    // Computed values
    isAdmin: user?.role === 'admin',
    isEmailVerified: user?.isEmailVerified ?? false,
  };
}

export default useAuth;