/**
 * Error boundary component for React Query errors
 * Provides fallback UI for API failures
 */

import React from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { ErrorBoundary } from 'react-error-boundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getQueryErrorMessage } from '@/lib/react-query';

interface QueryErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

function QueryErrorFallback({ error, resetErrorBoundary }: QueryErrorFallbackProps) {
  const errorMessage = getQueryErrorMessage(error);

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
          <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>
        <CardTitle className="text-lg">Something went wrong</CardTitle>
        <CardDescription>
          {errorMessage}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <Button 
          onClick={resetErrorBoundary}
          variant="outline"
          className="w-full"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

interface QueryErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<QueryErrorFallbackProps>;
}

export function QueryErrorBoundary({ 
  children, 
  fallback: Fallback = QueryErrorFallback 
}: QueryErrorBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          FallbackComponent={Fallback}
          onReset={reset}
          resetKeys={['query-error-boundary']}
        >
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

/**
 * Lightweight error fallback for smaller components
 */
export function LightQueryErrorFallback({ error, resetErrorBoundary }: QueryErrorFallbackProps) {
  const errorMessage = getQueryErrorMessage(error);

  return (
    <div className="flex flex-col items-center justify-center p-4 text-center">
      <AlertTriangle className="h-8 w-8 text-red-500 mb-2" />
      <p className="text-sm text-muted-foreground mb-3">{errorMessage}</p>
      <Button 
        onClick={resetErrorBoundary}
        variant="outline"
        size="sm"
      >
        <RefreshCw className="mr-2 h-3 w-3" />
        Retry
      </Button>
    </div>
  );
}

/**
 * Error boundary for list components
 */
export function ListErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <QueryErrorBoundary fallback={LightQueryErrorFallback}>
      {children}
    </QueryErrorBoundary>
  );
}