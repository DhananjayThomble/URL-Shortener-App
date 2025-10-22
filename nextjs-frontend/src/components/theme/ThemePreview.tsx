'use client';

import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  Chip,
  Avatar,
  LinearProgress,
  Alert,
  Switch,
  FormControlLabel,
  Divider,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Paper,
} from '@mui/material';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import {
  Favorite,
  Share,
  MoreVert,
  Person,
  Settings,
  Notifications,
  Security,
  CheckCircle,
  Warning,
  Error,
  Info,
} from '@mui/icons-material';
import { useThemeConfig } from '@/hooks/useThemeConfig';

export function ThemePreview() {
  const { actualMode } = useThemeConfig();
  const muiTheme = useMuiTheme();

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom>
        Theme Preview
      </Typography>
      
      <Typography variant="body1" color="text.secondary" paragraph>
        This preview showcases how the theme system looks across different components
        in {actualMode} mode.
      </Typography>

      {/* Color Palette */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Color Palette
          </Typography>
          
          <Box display="flex" flexWrap="wrap" gap={2} mb={2}>
            <Box textAlign="center">
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  borderRadius: 1,
                  backgroundColor: 'primary.main',
                  mb: 1,
                }}
              />
              <Typography variant="caption">Primary</Typography>
            </Box>
            
            <Box textAlign="center">
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  borderRadius: 1,
                  backgroundColor: 'secondary.main',
                  mb: 1,
                }}
              />
              <Typography variant="caption">Secondary</Typography>
            </Box>
            
            <Box textAlign="center">
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  borderRadius: 1,
                  backgroundColor: 'success.main',
                  mb: 1,
                }}
              />
              <Typography variant="caption">Success</Typography>
            </Box>
            
            <Box textAlign="center">
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  borderRadius: 1,
                  backgroundColor: 'warning.main',
                  mb: 1,
                }}
              />
              <Typography variant="caption">Warning</Typography>
            </Box>
            
            <Box textAlign="center">
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  borderRadius: 1,
                  backgroundColor: 'error.main',
                  mb: 1,
                }}
              />
              <Typography variant="caption">Error</Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Typography */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Typography Scale
          </Typography>
          
          <Typography variant="h1" gutterBottom>
            Heading 1
          </Typography>
          <Typography variant="h2" gutterBottom>
            Heading 2
          </Typography>
          <Typography variant="h3" gutterBottom>
            Heading 3
          </Typography>
          <Typography variant="h4" gutterBottom>
            Heading 4
          </Typography>
          <Typography variant="h5" gutterBottom>
            Heading 5
          </Typography>
          <Typography variant="h6" gutterBottom>
            Heading 6
          </Typography>
          
          <Typography variant="body1" gutterBottom>
            Body 1: Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
            Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
          </Typography>
          
          <Typography variant="body2" gutterBottom>
            Body 2: Ut enim ad minim veniam, quis nostrud exercitation ullamco 
            laboris nisi ut aliquip ex ea commodo consequat.
          </Typography>
          
          <Typography variant="caption" display="block" gutterBottom>
            Caption text
          </Typography>
          
          <Typography variant="overline" display="block">
            Overline text
          </Typography>
        </CardContent>
      </Card>

      {/* Buttons */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Buttons
          </Typography>
          
          <Box display="flex" flexWrap="wrap" gap={2} mb={2}>
            <Button variant="contained" color="primary">
              Primary
            </Button>
            <Button variant="contained" color="secondary">
              Secondary
            </Button>
            <Button variant="outlined" color="primary">
              Outlined
            </Button>
            <Button variant="text" color="primary">
              Text
            </Button>
            <Button variant="contained" disabled>
              Disabled
            </Button>
          </Box>
          
          <Box display="flex" flexWrap="wrap" gap={2}>
            <Button variant="contained" size="small">
              Small
            </Button>
            <Button variant="contained" size="medium">
              Medium
            </Button>
            <Button variant="contained" size="large">
              Large
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Form Elements */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Form Elements
          </Typography>
          
          <Box display="flex" flexDirection="column" gap={2} mb={2}>
            <TextField
              label="Standard Input"
              placeholder="Enter some text"
              variant="outlined"
              fullWidth
            />
            <TextField
              label="Email"
              type="email"
              placeholder="user@example.com"
              variant="outlined"
              fullWidth
            />
            <TextField
              label="Disabled Input"
              disabled
              variant="outlined"
              fullWidth
            />
            <TextField
              label="Error State"
              error
              helperText="This field has an error"
              variant="outlined"
              fullWidth
            />
          </Box>
          
          <Box display="flex" flexWrap="wrap" gap={2}>
            <FormControlLabel
              control={<Switch defaultChecked />}
              label="Enabled Switch"
            />
            <FormControlLabel
              control={<Switch />}
              label="Disabled Switch"
            />
          </Box>
        </CardContent>
      </Card>

      {/* Chips and Progress */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Chips & Progress
          </Typography>
          
          <Box display="flex" flexWrap="wrap" gap={1} mb={3}>
            <Chip label="Default" />
            <Chip label="Primary" color="primary" />
            <Chip label="Secondary" color="secondary" />
            <Chip label="Success" color="success" />
            <Chip label="Warning" color="warning" />
            <Chip label="Error" color="error" />
            <Chip label="Deletable" onDelete={() => {}} />
          </Box>
          
          <Typography variant="body2" gutterBottom>
            Progress Indicators
          </Typography>
          <LinearProgress value={30} variant="determinate" sx={{ mb: 1 }} />
          <LinearProgress value={60} variant="determinate" color="secondary" sx={{ mb: 1 }} />
          <LinearProgress value={90} variant="determinate" color="success" />
        </CardContent>
      </Card>

      {/* Alerts */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Alerts
          </Typography>
          
          <Box display="flex" flexDirection="column" gap={2}>
            <Alert severity="success" icon={<CheckCircle />}>
              This is a success alert with custom icon!
            </Alert>
            <Alert severity="info" icon={<Info />}>
              This is an info alert with some information.
            </Alert>
            <Alert severity="warning" icon={<Warning />}>
              This is a warning alert - please pay attention.
            </Alert>
            <Alert severity="error" icon={<Error />}>
              This is an error alert - something went wrong.
            </Alert>
          </Box>
        </CardContent>
      </Card>

      {/* List Component */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Lists
          </Typography>
          
          <List>
            <ListItem>
              <ListItemAvatar>
                <Avatar>
                  <Person />
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary="John Doe"
                secondary="Software Engineer"
              />
              <ListItemSecondaryAction>
                <IconButton edge="end">
                  <MoreVert />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
            
            <Divider variant="inset" component="li" />
            
            <ListItem>
              <ListItemAvatar>
                <Avatar>
                  <Settings />
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary="Settings"
                secondary="Manage your preferences"
              />
              <ListItemSecondaryAction>
                <Switch />
              </ListItemSecondaryAction>
            </ListItem>
            
            <Divider variant="inset" component="li" />
            
            <ListItem>
              <ListItemAvatar>
                <Avatar>
                  <Notifications />
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary="Notifications"
                secondary="Control notification settings"
              />
              <ListItemSecondaryAction>
                <Chip label="3" color="primary" size="small" />
              </ListItemSecondaryAction>
            </ListItem>
          </List>
        </CardContent>
      </Card>

      {/* Card with Actions */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Interactive Card
          </Typography>
          
          <Typography variant="body2" color="text.secondary" paragraph>
            This card demonstrates interactive elements and proper spacing
            in the current theme.
          </Typography>
          
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" gap={1}>
              <IconButton color="primary">
                <Favorite />
              </IconButton>
              <IconButton color="primary">
                <Share />
              </IconButton>
            </Box>
            
            <Button variant="contained" size="small">
              Action
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Theme Information */}
      <Paper sx={{ p: 2, backgroundColor: 'background.default' }}>
        <Typography variant="h6" gutterBottom>
          Current Theme Information
        </Typography>
        
        <Typography variant="body2" component="div">
          <strong>Mode:</strong> {actualMode}
        </Typography>
        <Typography variant="body2" component="div">
          <strong>Primary Color:</strong> {muiTheme.palette.primary.main}
        </Typography>
        <Typography variant="body2" component="div">
          <strong>Background:</strong> {muiTheme.palette.background.default}
        </Typography>
        <Typography variant="body2" component="div">
          <strong>Text Color:</strong> {muiTheme.palette.text.primary}
        </Typography>
      </Paper>
    </Box>
  );
}

export default ThemePreview;