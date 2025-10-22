'use client';

import { useState } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Badge,
  Tooltip,
} from '@mui/material';
import {
  Menu as MenuIcon,
  AccountCircle,
  Settings,
  Logout,
  Dashboard,
  Link as LinkIcon,
  Analytics,
  Notifications,
  Help,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { ThemeToggle } from '@/components/ui';
import { SessionWarning } from '@/components/auth/SessionWarning';

interface AuthenticatedLayoutProps {
  children: React.ReactNode;
  title?: string;
  showSidebar?: boolean;
}

export function AuthenticatedLayout({ 
  children, 
  title = 'SnapURL',
  showSidebar = true 
}: AuthenticatedLayoutProps) {
  const router = useRouter();
  const { user, logout, getUserInitials, getDisplayName } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleProfileMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleProfileMenuClose();
    logout();
  };

  const handleNavigation = (path: string) => {
    router.push(path);
    handleProfileMenuClose();
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* App Bar */}
      <AppBar
        position="fixed"
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          backgroundColor: 'var(--header-bg)',
          borderBottom: '1px solid var(--header-border)',
          backdropFilter: 'blur(8px)',
          boxShadow: 'none',
        }}
      >
        <Toolbar>
          {/* Menu Button */}
          {showSidebar && (
            <IconButton
              color="inherit"
              aria-label="open drawer"
              onClick={toggleSidebar}
              edge="start"
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
          )}

          {/* Logo/Title */}
          <Typography
            variant="h6"
            noWrap
            component="div"
            sx={{ 
              flexGrow: 1,
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
            onClick={() => router.push('/dashboard')}
          >
            {title}
          </Typography>

          {/* Navigation Items */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Quick Actions */}
            <Tooltip title="Create Short URL">
              <IconButton
                color="inherit"
                onClick={() => router.push('/dashboard')}
              >
                <LinkIcon />
              </IconButton>
            </Tooltip>

            <Tooltip title="Analytics">
              <IconButton
                color="inherit"
                onClick={() => router.push('/analytics')}
              >
                <Analytics />
              </IconButton>
            </Tooltip>

            {/* Notifications */}
            <Tooltip title="Notifications">
              <IconButton color="inherit">
                <Badge badgeContent={0} color="error">
                  <Notifications />
                </Badge>
              </IconButton>
            </Tooltip>

            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Profile Menu */}
            <Tooltip title="Account">
              <IconButton
                size="large"
                edge="end"
                aria-label="account of current user"
                aria-controls="primary-search-account-menu"
                aria-haspopup="true"
                onClick={handleProfileMenuOpen}
                color="inherit"
              >
                <Avatar
                  sx={{ 
                    width: 32, 
                    height: 32,
                    bgcolor: 'primary.main',
                    fontSize: '0.875rem',
                  }}
                >
                  {getUserInitials()}
                </Avatar>
              </IconButton>
            </Tooltip>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Profile Menu */}
      <Menu
        anchorEl={anchorEl}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        keepMounted
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        open={Boolean(anchorEl)}
        onClose={handleProfileMenuClose}
        sx={{
          '& .MuiPaper-root': {
            minWidth: 200,
            mt: 1,
          },
        }}
      >
        {/* User Info */}
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2" noWrap>
            {getDisplayName()}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {user?.email}
          </Typography>
        </Box>
        
        <Divider />

        {/* Menu Items */}
        <MenuItem onClick={() => handleNavigation('/dashboard')}>
          <ListItemIcon>
            <Dashboard fontSize="small" />
          </ListItemIcon>
          <ListItemText>Dashboard</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => handleNavigation('/profile')}>
          <ListItemIcon>
            <AccountCircle fontSize="small" />
          </ListItemIcon>
          <ListItemText>Profile</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => handleNavigation('/settings')}>
          <ListItemIcon>
            <Settings fontSize="small" />
          </ListItemIcon>
          <ListItemText>Settings</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => handleNavigation('/help')}>
          <ListItemIcon>
            <Help fontSize="small" />
          </ListItemIcon>
          <ListItemText>Help & Support</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <Logout fontSize="small" />
          </ListItemIcon>
          <ListItemText>Sign Out</ListItemText>
        </MenuItem>
      </Menu>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          pt: 8, // Account for AppBar height
          minHeight: '100vh',
          backgroundColor: 'background.default',
        }}
      >
        {/* Session Warning */}
        <SessionWarning />
        
        {children}
      </Box>
    </Box>
  );
}

export default AuthenticatedLayout;