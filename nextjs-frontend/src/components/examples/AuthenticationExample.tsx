'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  Divider,
  Card,
  CardContent,
  Alert,
  Chip,
} from '@mui/material';
import {
  Security,
  Login,
  PersonAdd,
  Key,
  Shield,
  AccountCircle,
} from '@mui/icons-material';
import {
  EnhancedLoginForm,
  EnhancedRegisterForm,
  PasswordStrengthIndicator,
  TwoFactorSetup,
  AccountRecovery,
  SecurityDashboard,
  SessionWarning,
} from '@/components/auth';
import { useAuth } from '@/hooks/useAuth';

export function AuthenticationExample() {
  const { user, isAuthenticated, logout } = useAuth();
  const [activeDemo, setActiveDemo] = useState<string>('overview');
  const [testPassword, setTestPassword] = useState('');

  const demos = {
    overview: 'System Overview',
    login: 'Enhanced Login Form',
    register: 'Enhanced Registration Form',
    password: 'Password Strength Indicator',
    twoFactor: 'Two-Factor Authentication Setup',
    recovery: 'Account Recovery',
    security: 'Security Dashboard',
    session: 'Session Warning',
  };

  const renderDemo = () => {
    switch (activeDemo) {
      case 'overview':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Authentication System Overview
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              A comprehensive authentication system with advanced security features, user management, and seamless user experience.
            </Typography>

            {/* Current User Status */}
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <AccountCircle color="primary" />
                  <Typography variant="h6">Current Authentication Status</Typography>
                </Box>
                
                {isAuthenticated ? (
                  <Box>
                    <Alert severity="success" sx={{ mb: 2 }}>
                      <Typography variant="body2" gutterBottom>
                        <strong>Authenticated</strong>
                      </Typography>
                      <Typography variant="body2">
                        Welcome back, {user?.name || user?.email}!
                      </Typography>
                    </Alert>
                    
                    <Box display="flex" gap={1} flexWrap="wrap" mb={2}>
                      <Chip label={`Role: ${user?.role || 'user'}`} color="primary" size="small" />
                      <Chip 
                        label={user?.isEmailVerified ? 'Email Verified' : 'Email Pending'} 
                        color={user?.isEmailVerified ? 'success' : 'warning'} 
                        size="small" 
                      />
                    </Box>

                    <Button variant="outlined" onClick={() => logout()} size="small">
                      Logout
                    </Button>
                  </Box>
                ) : (
                  <Alert severity="info">
                    <Typography variant="body2">
                      Not currently authenticated. Use the login form demo to sign in.
                    </Typography>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Features Overview */}
            <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={2}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <Security color="primary" />
                    <Typography variant="h6">Security Features</Typography>
                  </Box>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li>JWT token management with automatic refresh</li>
                    <li>Account lockout after failed attempts</li>
                    <li>Password strength validation</li>
                    <li>Two-factor authentication support</li>
                    <li>Session monitoring and warnings</li>
                    <li>Security event logging</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <Shield color="primary" />
                    <Typography variant="h6">User Experience</Typography>
                  </Box>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li>Multi-step registration process</li>
                    <li>Enhanced login with 2FA support</li>
                    <li>Account recovery options</li>
                    <li>Real-time password feedback</li>
                    <li>Responsive design</li>
                    <li>Comprehensive error handling</li>
                  </ul>
                </CardContent>
              </Card>
            </Box>
          </Box>
        );

      case 'login':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Enhanced Login Form
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Advanced login form with 2FA support, account lockout protection, and enhanced security features.
            </Typography>
            
            <EnhancedLoginForm
              onSuccess={() => alert('Login successful!')}
              onForgotPassword={() => setActiveDemo('recovery')}
              onRegister={() => setActiveDemo('register')}
            />
          </Box>
        );

      case 'register':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Enhanced Registration Form
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Multi-step registration process with password strength validation and terms acceptance.
            </Typography>
            
            <EnhancedRegisterForm
              onSuccess={() => alert('Registration successful!')}
              onLogin={() => setActiveDemo('login')}
            />
          </Box>
        );

      case 'password':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Password Strength Indicator
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Real-time password strength validation with detailed feedback and requirements checklist.
            </Typography>
            
            <Card sx={{ maxWidth: 500, mx: 'auto' }}>
              <CardContent>
                <input
                  type="password"
                  placeholder="Type a password to test..."
                  value={testPassword}
                  onChange={(e) => setTestPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    marginBottom: '16px',
                    fontSize: '16px',
                  }}
                />
                
                <PasswordStrengthIndicator
                  password={testPassword}
                  showRequirements
                  showScore
                />
              </CardContent>
            </Card>
          </Box>
        );

      case 'twoFactor':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Two-Factor Authentication Setup
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Step-by-step 2FA setup with QR code generation and backup codes.
            </Typography>
            
            <TwoFactorSetup
              onComplete={() => alert('2FA setup completed!')}
              onCancel={() => setActiveDemo('overview')}
            />
          </Box>
        );

      case 'recovery':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Account Recovery
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Multiple account recovery options including email, backup codes, and security questions.
            </Typography>
            
            <AccountRecovery
              onComplete={() => alert('Account recovery completed!')}
              onCancel={() => setActiveDemo('overview')}
            />
          </Box>
        );

      case 'security':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Security Dashboard
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Comprehensive security monitoring with device information and event logging.
            </Typography>
            
            <SecurityDashboard />
          </Box>
        );

      case 'session':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Session Warning
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Session expiration warnings with automatic extension options.
            </Typography>
            
            <Alert severity="info" sx={{ mb: 2 }}>
              This component automatically appears when your session is about to expire. 
              For demonstration purposes, here's how it looks:
            </Alert>
            
            <SessionWarning
              showInDialog={false}
              onSessionExpired={() => alert('Session expired!')}
            />
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Authentication System
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Comprehensive authentication system with advanced security features, user management, and seamless user experience.
      </Typography>

      {/* Demo Navigation */}
      <Stack direction="row" spacing={1} sx={{ mb: 3 }} flexWrap="wrap">
        {Object.entries(demos).map(([key, label]) => (
          <Button
            key={key}
            variant={activeDemo === key ? 'contained' : 'outlined'}
            onClick={() => setActiveDemo(key)}
            size="small"
          >
            {label}
          </Button>
        ))}
      </Stack>

      <Divider sx={{ mb: 3 }} />

      {/* Active Demo */}
      {renderDemo()}
    </Box>
  );
}

export default AuthenticationExample;