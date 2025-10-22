export interface User {
  id: string;
  email: string;
  name: string;
  isEmailVerified: boolean;
  role: 'user' | 'admin';
  customDomain?: CustomDomain;
  createdAt: string;
  updatedAt: string;
}

export interface CustomDomain {
  id: string;
  domain: string;
  isVerified: boolean;
  dnsRecords?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
  twoFactorCode?: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  confirmPassword?: string;
  acceptTerms?: boolean;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export interface TokenResponse {
  tokens: AuthTokens;
}

export interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface AuthActions {
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<AuthTokens>;
  updateUser: (userData: Partial<User>) => void;
  setLoading: (loading: boolean) => void;
}
