'use client';

import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  Button, 
  Stack,
  Chip,
  useTheme as useMuiTheme 
} from '@mui/material';
import { useTheme } from '@/hooks/useTheme';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { tokens } from '@/lib/theme/tokens';

/**
 * Example component demonstrating the theme system
 * This shows how to use both Material-UI theme and our design tokens
 */
export const ThemeExample: React.FC = () => {
  const { mode, actualMode } = useTheme();
  const muiTheme = useMuiTheme();

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
      <Stack spacing={3}>
        {/* Header */}
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h4" component="h1">
            Theme System Demo
          </Typography>
          <ThemeToggle />
        </Box>

        {/* Theme Status */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Current Theme Status
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
              <Chip 
                label={`Mode: ${mode}`} 
                color="primary" 
                variant="outlined" 
              />
              <Chip 
                label={`Actual: ${actualMode}`} 
                color="secondary" 
                variant="outlined" 
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              The theme system supports light, dark, and system modes with automatic switching.
            </Typography>
          </CardContent>
        </Card>

        {/* Color Palette */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Color Palette
            </Typography>
            <Stack spacing={2}>
              {/* Primary Colors */}
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Primary Colors
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {Object.entries(tokens.colors.primary).map(([shade, color]) => (
                    <Box
                      key={shade}
                      sx={{
                        width: 60,
                        height: 60,
                        backgroundColor: color,
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: parseInt(shade) > 500 ? 'white' : 'black',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {shade}
                    </Box>
                  ))}
                </Stack>
              </Box>

              {/* Gray Colors */}
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Gray Colors
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {Object.entries(tokens.colors.gray).slice(0, 10).map(([shade, color]) => (
                    <Box
                      key={shade}
                      sx={{
                        width: 60,
                        height: 60,
                        backgroundColor: color,
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: parseInt(shade) > 500 ? 'white' : 'black',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {shade}
                    </Box>
                  ))}
                </Stack>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* Typography */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Typography Scale
            </Typography>
            <Stack spacing={1}>
              <Typography variant="h1">Heading 1</Typography>
              <Typography variant="h2">Heading 2</Typography>
              <Typography variant="h3">Heading 3</Typography>
              <Typography variant="h4">Heading 4</Typography>
              <Typography variant="h5">Heading 5</Typography>
              <Typography variant="h6">Heading 6</Typography>
              <Typography variant="body1">Body 1 - Regular text content</Typography>
              <Typography variant="body2">Body 2 - Secondary text content</Typography>
              <Typography variant="caption">Caption text</Typography>
            </Stack>
          </CardContent>
        </Card>

        {/* Spacing */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Spacing Scale
            </Typography>
            <Stack spacing={2}>
              {[1, 2, 3, 4, 6, 8, 12].map((space) => (
                <Box key={space} display="flex" alignItems="center" gap={2}>
                  <Typography variant="body2" sx={{ minWidth: 60 }}>
                    {space} ({tokens.spacing[space as keyof typeof tokens.spacing]}px)
                  </Typography>
                  <Box
                    sx={{
                      width: tokens.spacing[space as keyof typeof tokens.spacing],
                      height: 20,
                      backgroundColor: 'primary.main',
                      borderRadius: 1,
                    }}
                  />
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>

        {/* Components */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Component Examples
            </Typography>
            <Stack spacing={2}>
              <Stack direction="row" spacing={2}>
                <Button variant="contained">Primary Button</Button>
                <Button variant="outlined">Outlined Button</Button>
                <Button variant="text">Text Button</Button>
              </Stack>
              
              <Stack direction="row" spacing={2}>
                <Button variant="contained" size="small">Small</Button>
                <Button variant="contained" size="medium">Medium</Button>
                <Button variant="contained" size="large">Large</Button>
              </Stack>

              <Stack direction="row" spacing={1}>
                <Chip label="Default" />
                <Chip label="Primary" color="primary" />
                <Chip label="Secondary" color="secondary" />
                <Chip label="Success" color="success" />
                <Chip label="Error" color="error" />
                <Chip label="Warning" color="warning" />
                <Chip label="Info" color="info" />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* Material-UI Theme Values */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Material-UI Theme Values
            </Typography>
            <Stack spacing={1}>
              <Typography variant="body2">
                <strong>Palette Mode:</strong> {muiTheme.palette.mode}
              </Typography>
              <Typography variant="body2">
                <strong>Primary Color:</strong> {muiTheme.palette.primary.main}
              </Typography>
              <Typography variant="body2">
                <strong>Background:</strong> {muiTheme.palette.background.default}
              </Typography>
              <Typography variant="body2">
                <strong>Text Primary:</strong> {muiTheme.palette.text.primary}
              </Typography>
              <Typography variant="body2">
                <strong>Border Radius:</strong> {muiTheme.shape.borderRadius}px
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
};