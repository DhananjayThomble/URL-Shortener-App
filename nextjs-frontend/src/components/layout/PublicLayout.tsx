'use client';

import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  Button,
  Container,
  Stack,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/ui';

interface PublicLayoutProps {
  children: React.ReactNode;
  showHeader?: boolean;
  showFooter?: boolean;
}

export function PublicLayout({ 
  children, 
  showHeader = true,
  showFooter = true 
}: PublicLayoutProps) {
  const router = useRouter();

  const handleLogin = () => {
    router.push('/login');
  };

  const handleSignUp = () => {
    router.push('/register');
  };

  const handleHome = () => {
    router.push('/');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      {showHeader && (
        <AppBar
          position="static"
          elevation={0}
          sx={{
            backgroundColor: 'transparent',
            borderBottom: '1px solid',
            borderColor: 'divider',
            color: 'text.primary',
          }}
        >
          <Container maxWidth="lg">
            <Toolbar sx={{ px: { xs: 0 } }}>
              {/* Logo */}
              <Typography
                variant="h6"
                component="div"
                sx={{ 
                  flexGrow: 1,
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  color: 'primary.main',
                }}
                onClick={handleHome}
              >
                SnapURL
              </Typography>

              {/* Navigation */}
              <Stack direction="row" spacing={2} alignItems="center">
                <ThemeToggle />
                
                <Button
                  color="inherit"
                  onClick={handleLogin}
                  sx={{ textTransform: 'none' }}
                >
                  Sign In
                </Button>
                
                <Button
                  variant="contained"
                  onClick={handleSignUp}
                  sx={{ textTransform: 'none' }}
                >
                  Get Started
                </Button>
              </Stack>
            </Toolbar>
          </Container>
        </AppBar>
      )}

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </Box>

      {/* Footer */}
      {showFooter && (
        <Box
          component="footer"
          sx={{
            py: 3,
            px: 2,
            mt: 'auto',
            borderTop: '1px solid',
            borderColor: 'divider',
            backgroundColor: 'background.paper',
          }}
        >
          <Container maxWidth="lg">
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems="center"
              spacing={2}
            >
              <Typography variant="body2" color="text.secondary">
                © 2024 SnapURL. All rights reserved.
              </Typography>
              
              <Stack direction="row" spacing={3}>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => router.push('/privacy')}
                  sx={{ textTransform: 'none' }}
                >
                  Privacy Policy
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => router.push('/terms')}
                  sx={{ textTransform: 'none' }}
                >
                  Terms of Service
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => router.push('/contact')}
                  sx={{ textTransform: 'none' }}
                >
                  Contact
                </Button>
              </Stack>
            </Stack>
          </Container>
        </Box>
      )}
    </Box>
  );
}

export default PublicLayout;