'use client';

import { ThemeProvider } from '@/components/layout/ThemeProvider';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Toaster } from 'react-hot-toast';
import { CssBaseline } from '@mui/material';

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <CssBaseline />
      <AuthProvider>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: 'var(--background)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            },
            success: {
              iconTheme: {
                primary: 'var(--success)',
                secondary: 'var(--success-foreground)',
              },
            },
            error: {
              iconTheme: {
                primary: 'var(--destructive)',
                secondary: 'var(--destructive-foreground)',
              },
            },
          }}
        />
      </AuthProvider>
    </ThemeProvider>
  );
}