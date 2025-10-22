'use client';

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Slider,
  Switch,
  Divider,
  Button,
  Grid,
  Chip,
  Alert,
} from '@mui/material';
import {
  Palette,
  Brightness4,
  Brightness7,
  SettingsBrightness,
  RestartAlt,
} from '@mui/icons-material';
import { useThemeConfig } from '@/hooks/useThemeConfig';
import { colors } from '@/lib/theme/colors';

interface ThemeCustomizerProps {
  onClose?: () => void;
}

export function ThemeCustomizer({ onClose }: ThemeCustomizerProps) {
  const { mode, setTheme, actualMode, getCSSVar, setCSSVar } = useThemeConfig();
  const [customizations, setCustomizations] = useState({
    primaryHue: 210, // Blue hue
    borderRadius: 8,
    animationSpeed: 1,
    reducedMotion: false,
  });

  const handleThemeChange = (newMode: 'light' | 'dark' | 'system') => {
    setTheme(newMode);
  };

  const handleCustomizationChange = (key: string, value: any) => {
    setCustomizations(prev => ({ ...prev, [key]: value }));
    
    // Apply customization immediately
    switch (key) {
      case 'primaryHue':
        // Generate new primary color based on hue
        const newPrimary = `hsl(${value}, 70%, 50%)`;
        setCSSVar('--primary', newPrimary);
        break;
      case 'borderRadius':
        setCSSVar('--radius-lg', `${value}px`);
        break;
      case 'animationSpeed':
        setCSSVar('--duration-normal', `${200 / value}ms`);
        break;
      case 'reducedMotion':
        document.documentElement.style.setProperty(
          '--animation-duration',
          value ? '0ms' : 'var(--duration-normal)'
        );
        break;
    }
  };

  const resetCustomizations = () => {
    setCustomizations({
      primaryHue: 210,
      borderRadius: 8,
      animationSpeed: 1,
      reducedMotion: false,
    });
    
    // Reset CSS variables to defaults
    setCSSVar('--primary', colors.primary[500]);
    setCSSVar('--radius-lg', '8px');
    setCSSVar('--duration-normal', '200ms');
    document.documentElement.style.removeProperty('--animation-duration');
  };

  const colorPresets = [
    { name: 'Blue', hue: 210, color: colors.primary[500] },
    { name: 'Purple', hue: 270, color: colors.secondary[500] },
    { name: 'Green', hue: 120, color: colors.success[500] },
    { name: 'Orange', hue: 30, color: colors.warning[500] },
    { name: 'Red', hue: 0, color: colors.error[500] },
    { name: 'Teal', hue: 180, color: '#14b8a6' },
    { name: 'Pink', hue: 330, color: '#ec4899' },
    { name: 'Indigo', hue: 240, color: '#6366f1' },
  ];

  return (
    <Card sx={{ maxWidth: 400, width: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={3}>
          <Palette color="primary" />
          <Typography variant="h6">Theme Customizer</Typography>
        </Box>

        {/* Theme Mode Selection */}
        <Box mb={3}>
          <FormControl component="fieldset">
            <FormLabel component="legend">Theme Mode</FormLabel>
            <RadioGroup
              value={mode}
              onChange={(e) => handleThemeChange(e.target.value as any)}
              row
            >
              <FormControlLabel
                value="light"
                control={<Radio />}
                label={
                  <Box display="flex" alignItems="center" gap={0.5}>
                    <Brightness7 fontSize="small" />
                    Light
                  </Box>
                }
              />
              <FormControlLabel
                value="dark"
                control={<Radio />}
                label={
                  <Box display="flex" alignItems="center" gap={0.5}>
                    <Brightness4 fontSize="small" />
                    Dark
                  </Box>
                }
              />
              <FormControlLabel
                value="system"
                control={<Radio />}
                label={
                  <Box display="flex" alignItems="center" gap={0.5}>
                    <SettingsBrightness fontSize="small" />
                    System
                  </Box>
                }
              />
            </RadioGroup>
          </FormControl>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Color Presets */}
        <Box mb={3}>
          <Typography variant="subtitle2" gutterBottom>
            Primary Color
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={1}>
            {colorPresets.map((preset) => (
              <Box key={preset.name}>
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: 1,
                    backgroundColor: preset.color,
                    cursor: 'pointer',
                    border: customizations.primaryHue === preset.hue ? 2 : 1,
                    borderColor: customizations.primaryHue === preset.hue 
                      ? 'primary.main' 
                      : 'divider',
                    '&:hover': {
                      transform: 'scale(1.1)',
                    },
                    transition: 'all 0.2s ease-in-out',
                  }}
                  onClick={() => handleCustomizationChange('primaryHue', preset.hue)}
                  title={preset.name}
                />
              </Box>
            ))}
          </Box>
        </Box>

        {/* Custom Hue Slider */}
        <Box mb={3}>
          <Typography variant="body2" gutterBottom>
            Custom Hue: {customizations.primaryHue}°
          </Typography>
          <Slider
            value={customizations.primaryHue}
            onChange={(_, value) => handleCustomizationChange('primaryHue', value)}
            min={0}
            max={360}
            step={1}
            sx={{
              '& .MuiSlider-thumb': {
                backgroundColor: `hsl(${customizations.primaryHue}, 70%, 50%)`,
              },
              '& .MuiSlider-track': {
                background: `linear-gradient(90deg, 
                  hsl(0, 70%, 50%) 0%, 
                  hsl(60, 70%, 50%) 17%, 
                  hsl(120, 70%, 50%) 33%, 
                  hsl(180, 70%, 50%) 50%, 
                  hsl(240, 70%, 50%) 67%, 
                  hsl(300, 70%, 50%) 83%, 
                  hsl(360, 70%, 50%) 100%)`,
              },
            }}
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Border Radius */}
        <Box mb={3}>
          <Typography variant="body2" gutterBottom>
            Border Radius: {customizations.borderRadius}px
          </Typography>
          <Slider
            value={customizations.borderRadius}
            onChange={(_, value) => handleCustomizationChange('borderRadius', value)}
            min={0}
            max={24}
            step={1}
            marks={[
              { value: 0, label: '0' },
              { value: 4, label: '4' },
              { value: 8, label: '8' },
              { value: 12, label: '12' },
              { value: 16, label: '16' },
              { value: 24, label: '24' },
            ]}
          />
        </Box>

        {/* Animation Speed */}
        <Box mb={3}>
          <Typography variant="body2" gutterBottom>
            Animation Speed: {customizations.animationSpeed}x
          </Typography>
          <Slider
            value={customizations.animationSpeed}
            onChange={(_, value) => handleCustomizationChange('animationSpeed', value)}
            min={0.5}
            max={2}
            step={0.1}
            marks={[
              { value: 0.5, label: '0.5x' },
              { value: 1, label: '1x' },
              { value: 1.5, label: '1.5x' },
              { value: 2, label: '2x' },
            ]}
          />
        </Box>

        {/* Accessibility Options */}
        <Box mb={3}>
          <Typography variant="subtitle2" gutterBottom>
            Accessibility
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={customizations.reducedMotion}
                onChange={(e) => handleCustomizationChange('reducedMotion', e.target.checked)}
              />
            }
            label="Reduce motion"
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Current Theme Info */}
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            Current mode: <Chip label={mode} size="small" /> 
            {mode === 'system' && (
              <>
                {' → '}
                <Chip label={actualMode} size="small" color="primary" />
              </>
            )}
          </Typography>
        </Alert>

        {/* Actions */}
        <Box display="flex" gap={1} justifyContent="space-between">
          <Button
            variant="outlined"
            startIcon={<RestartAlt />}
            onClick={resetCustomizations}
            size="small"
          >
            Reset
          </Button>
          {onClose && (
            <Button
              variant="contained"
              onClick={onClose}
              size="small"
            >
              Done
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

export default ThemeCustomizer;