'use client';

import { IconButton, Tooltip, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import { 
  LightMode, 
  DarkMode, 
  SettingsBrightness,
  Check 
} from '@mui/icons-material';
import { useState } from 'react';
import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle() {
  const { mode, actualMode, setTheme } = useTheme();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleThemeChange = (newMode: 'light' | 'dark' | 'system') => {
    setTheme(newMode);
    handleClose();
  };

  const getIcon = () => {
    switch (actualMode) {
      case 'dark':
        return <DarkMode />;
      case 'light':
        return <LightMode />;
      default:
        return <SettingsBrightness />;
    }
  };

  const getTooltipText = () => {
    switch (mode) {
      case 'dark':
        return 'Dark mode';
      case 'light':
        return 'Light mode';
      case 'system':
        return `System (${actualMode})`;
      default:
        return 'Theme';
    }
  };

  return (
    <>
      <Tooltip title={getTooltipText()}>
        <IconButton
          onClick={handleClick}
          size="small"
          aria-label="Toggle theme"
          aria-controls={open ? 'theme-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
        >
          {getIcon()}
        </IconButton>
      </Tooltip>
      
      <Menu
        id="theme-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          'aria-labelledby': 'theme-button',
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <MenuItem onClick={() => handleThemeChange('light')}>
          <ListItemIcon>
            <LightMode fontSize="small" />
          </ListItemIcon>
          <ListItemText>Light</ListItemText>
          {mode === 'light' && (
            <ListItemIcon>
              <Check fontSize="small" />
            </ListItemIcon>
          )}
        </MenuItem>
        
        <MenuItem onClick={() => handleThemeChange('dark')}>
          <ListItemIcon>
            <DarkMode fontSize="small" />
          </ListItemIcon>
          <ListItemText>Dark</ListItemText>
          {mode === 'dark' && (
            <ListItemIcon>
              <Check fontSize="small" />
            </ListItemIcon>
          )}
        </MenuItem>
        
        <MenuItem onClick={() => handleThemeChange('system')}>
          <ListItemIcon>
            <SettingsBrightness fontSize="small" />
          </ListItemIcon>
          <ListItemText>System</ListItemText>
          {mode === 'system' && (
            <ListItemIcon>
              <Check fontSize="small" />
            </ListItemIcon>
          )}
        </MenuItem>
      </Menu>
    </>
  );
}

export default ThemeToggle;