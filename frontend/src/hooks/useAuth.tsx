import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { authService } from "@/services/auth.service";
import { User } from "@/services/api/types";

interface AuthContextType {
  user: User | null;
  session: { user: User } | null; // Maintain compatibility with existing components
  loading: boolean;
  isAuthenticated: boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<{ user: User } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initialize authentication state
    const initializeAuth = async () => {
      try {
        setLoading(true);
        
        // Check if user is already authenticated
        if (authService.isAuthenticated()) {
          const currentUser = authService.getCurrentUser();
          if (currentUser) {
            setUser(currentUser);
            setSession({ user: currentUser });
          } else {
            // Try to fetch current user profile
            const userProfile = await authService.getCurrentUserProfile();
            if (userProfile) {
              setUser(userProfile);
              setSession({ user: userProfile });
            }
          }
        }
      } catch (error) {
        console.warn('Failed to initialize auth state:', error);
        // Clear any invalid auth data
        await authService.logout();
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const signUp = async (email: string, password: string, fullName?: string) => {
    try {
      setLoading(true);
      const result = await authService.register(email, password, fullName);
      
      if (result.success && result.data) {
        const { user: newUser } = result.data;
        setUser(newUser);
        setSession({ user: newUser });
        return { error: null };
      } else {
        const errorMessage = result.error?.message || 'Registration failed';
        return { error: new Error(errorMessage) };
      }
    } catch (error) {
      console.error('Sign up error:', error);
      return { error: error instanceof Error ? error : new Error('Registration failed') };
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      setLoading(true);
      const result = await authService.login(email, password);
      
      if (result.success && result.data) {
        const { user: loggedInUser } = result.data;
        setUser(loggedInUser);
        setSession({ user: loggedInUser });
        return { error: null };
      } else {
        const errorMessage = result.error?.message || 'Login failed';
        return { error: new Error(errorMessage) };
      }
    } catch (error) {
      console.error('Sign in error:', error);
      return { error: error instanceof Error ? error : new Error('Login failed') };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      await authService.logout();
      setUser(null);
      setSession(null);
    } catch (error) {
      console.error('Sign out error:', error);
      // Still clear local state even if API call fails
      setUser(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  
  // Add isAuthenticated computed property
  const isAuthenticated = !!context.user && !!context.session;
  
  return {
    ...context,
    isAuthenticated
  };
};
