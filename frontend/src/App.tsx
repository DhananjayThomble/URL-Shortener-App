import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/hooks/useAuth";
import { useEffect } from "react";
import { initializeAPI } from "@/services/api/startup";
import { testAuthService } from "@/services/auth.integration.manual";
import { createQueryClient } from "@/lib/react-query";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import RedirectPage from "./pages/RedirectPage";
import PublicBioPage from "./pages/PublicBioPage";
import NotFound from "./pages/NotFound";

// Make test function available globally for browser console testing
if (typeof window !== 'undefined') {
  (window as any).testAuthService = testAuthService;
}

const queryClient = createQueryClient();

const App = () => {
  useEffect(() => {
    // Initialize API client and perform startup validation
    initializeAPI().catch((error) => {
      console.error('Failed to initialize API:', error);
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/login" element={<Auth />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/dashboard/*" element={<Dashboard />} />
                <Route path="/r/:shortCode" element={<RedirectPage />} />
                <Route path="/@:username" element={<PublicBioPage />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
      {/* React Query DevTools - only in development */}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
};

export default App;
