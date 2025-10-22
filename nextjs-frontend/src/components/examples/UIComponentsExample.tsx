'use client';

import { useState } from 'react';
import {
  Box,
  Stack,
  Typography,
  Divider,
  Chip,
  Alert as MuiAlert,
} from '@mui/material';
import {
  Button,
  Input,
  Select,
  Card,
  Modal,
  Loading,
  Badge,
  Tooltip,
  Avatar,
  Skeleton,
  Alert,
  ThemeToggle,
} from '@/components/ui';
import type { SelectOption } from '@/components/ui';
import {
  Search,
  Person,
  Email,
  Phone,
  LocationOn,
  Star,
  Favorite,
  Share,
  Notifications,
  Settings,
  CheckCircle,
} from '@mui/icons-material';

/**
 * Comprehensive example showcasing all UI components
 */
export const UIComponentsExample: React.FC = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectValue, setSelectValue] = useState('');
  const [multiSelectValue, setMultiSelectValue] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');

  // Sample select options
  const selectOptions: SelectOption[] = [
    { value: 'option1', label: 'Option 1', icon: <Star /> },
    { value: 'option2', label: 'Option 2', icon: <Favorite /> },
    { value: 'option3', label: 'Option 3', icon: <Share />, description: 'This is option 3' },
    { value: 'option4', label: 'Disabled Option', disabled: true },
  ];

  const handleLoadingDemo = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 3000);
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      <Stack spacing={4}>
        {/* Header */}
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h4" component="h1">
            UI Components Library
          </Typography>
          <ThemeToggle />
        </Box>

        <MuiAlert severity="info">
          This page demonstrates all the custom UI components in our design system.
        </MuiAlert>

        {/* Buttons Section */}
        <Card title="Buttons" size="large">
          <Stack spacing={3}>
            {/* Button Variants */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Button Variants
              </Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap">
                <Button variant="contained">Contained</Button>
                <Button variant="outlined">Outlined</Button>
                <Button variant="text">Text</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link</Button>
              </Stack>
            </Box>

            {/* Button Sizes */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Button Sizes
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Button size="small">Small</Button>
                <Button size="medium">Medium</Button>
                <Button size="large">Large</Button>
              </Stack>
            </Box>

            {/* Button Colors */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Button Colors
              </Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap">
                <Button color="primary">Primary</Button>
                <Button color="secondary">Secondary</Button>
                <Button color="success">Success</Button>
                <Button color="error">Error</Button>
                <Button color="warning">Warning</Button>
                <Button color="info">Info</Button>
              </Stack>
            </Box>

            {/* Button States */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Button States
              </Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap">
                <Button icon={<Person />} iconPosition="start">
                  With Icon
                </Button>
                <Button loading loadingText="Loading...">
                  Loading Button
                </Button>
                <Button disabled>Disabled</Button>
                <Button fullWidth>Full Width</Button>
              </Stack>
            </Box>
          </Stack>
        </Card>

        {/* Inputs Section */}
        <Card title="Input Components" size="large">
          <Stack spacing={3}>
            {/* Input Variants */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Input Variants & Sizes
              </Typography>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <Box flex={1}>
                  <Input
                    label="Small Input"
                    size="small"
                    placeholder="Enter text..."
                    leftIcon={<Search />}
                    fullWidth
                  />
                </Box>
                <Box flex={1}>
                  <Input
                    label="Medium Input"
                    size="medium"
                    placeholder="Enter text..."
                    leftIcon={<Email />}
                    fullWidth
                  />
                </Box>
                <Box flex={1}>
                  <Input
                    label="Large Input"
                    size="large"
                    placeholder="Enter text..."
                    leftIcon={<Phone />}
                    fullWidth
                  />
                </Box>
              </Stack>
            </Box>

            {/* Input States */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Input States
              </Typography>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Box flex={1}>
                    <Input
                      label="Success State"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      success={inputValue.length > 3}
                      successMessage="Looks good!"
                      leftIcon={<Person />}
                      fullWidth
                    />
                  </Box>
                  <Box flex={1}>
                    <Input
                      label="Error State"
                      error
                      helperText="This field is required"
                      leftIcon={<Email />}
                      fullWidth
                    />
                  </Box>
                </Stack>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Box flex={1}>
                    <Input
                      label="Password Input"
                      type="password"
                      showPasswordToggle
                      placeholder="Enter password..."
                      fullWidth
                    />
                  </Box>
                  <Box flex={1}>
                    <Input
                      label="Character Limit"
                      characterLimit={50}
                      showCharacterCount
                      multiline
                      rows={3}
                      placeholder="Type something..."
                      fullWidth
                    />
                  </Box>
                </Stack>
              </Stack>
            </Box>
          </Stack>
        </Card>

        {/* Select Section */}
        <Card title="Select Components" size="large">
          <Stack spacing={3}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <Box flex={1}>
                  <Select
                    label="Single Select"
                    options={selectOptions}
                    value={selectValue}
                    onChange={(e) => setSelectValue(e.target.value as string)}
                    placeholder="Choose an option..."
                    leftIcon={<LocationOn />}
                    fullWidth
                  />
                </Box>
                <Box flex={1}>
                  <Select
                    label="Multi Select"
                    options={selectOptions}
                    multiple
                    value={multiSelectValue}
                    onChange={(e) => setMultiSelectValue(e.target.value as string[])}
                    placeholder="Choose multiple options..."
                    fullWidth
                  />
                </Box>
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <Box flex={1}>
                  <Select
                    label="Success State"
                    options={selectOptions}
                    success
                    successMessage="Great choice!"
                    value="option1"
                    fullWidth
                  />
                </Box>
                <Box flex={1}>
                  <Select
                    label="Loading State"
                    options={[]}
                    loading
                    fullWidth
                  />
                </Box>
              </Stack>
            </Stack>
          </Stack>
        </Card>

        {/* Cards Section */}
        <Card title="Card Components" size="large">
          <Stack spacing={3}>
            {/* Basic Cards */}
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3}>
              <Box flex={1}>
                <Card
                  variant="elevated"
                  title="Elevated Card"
                  subtitle="This is a subtitle"
                  hoverable
                >
                  <Typography variant="body2">
                    This is an elevated card with hover effects. It demonstrates
                    the elevated variant with shadow.
                  </Typography>
                </Card>
              </Box>

              <Box flex={1}>
                <Card
                  variant="outlined"
                  title="Outlined Card"
                  subtitle="With border"
                  actions={
                    <Stack direction="row" spacing={1}>
                      <Button size="small">Action</Button>
                      <Button size="small" variant="outlined">Cancel</Button>
                    </Stack>
                  }
                >
                  <Typography variant="body2">
                    This is an outlined card variant with actions in the footer.
                  </Typography>
                </Card>
              </Box>

              <Box flex={1}>
                <Card
                  variant="filled"
                  title="Filled Card"
                  subtitle="Background filled"
                  clickable
                  onClick={() => alert('Card clicked!')}
                >
                  <Typography variant="body2">
                    This is a filled card that's clickable. Try clicking on it!
                  </Typography>
                </Card>
              </Box>
            </Stack>

            {/* Card with Image */}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
              <Box flex={1}>
                <Card
                  title="Card with Image"
                  subtitle="Includes header image"
                  image="https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=400&h=200&fit=crop"
                  imageAlt="Sample image"
                  imageHeight={200}
                  actions={
                    <Stack direction="row" spacing={1}>
                      <Button icon={<Favorite />} size="small">Like</Button>
                      <Button icon={<Share />} size="small" variant="outlined">Share</Button>
                    </Stack>
                  }
                >
                  <Typography variant="body2">
                    This card includes an image header and demonstrates how images
                    are handled in our card component.
                  </Typography>
                </Card>
              </Box>

              {/* Loading Card */}
              <Box flex={1}>
                <Card loading size="medium" />
              </Box>
            </Stack>
          </Stack>
        </Card>

        {/* Loading Section */}
        <Card title="Loading Components" size="large">
          <Stack spacing={3}>
            <Box>
              <Typography variant="h6" gutterBottom>
                Loading Variants
              </Typography>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                <Box flex={1}>
                  <Stack spacing={2} alignItems="center">
                    <Loading variant="circular" message="Circular Loading" />
                    <Loading variant="linear" message="Linear Loading" />
                    <Loading variant="dots" message="Dots Loading" />
                    <Loading variant="pulse" message="Pulse Loading" />
                  </Stack>
                </Box>
                <Box flex={1}>
                  <Loading variant="skeleton" />
                </Box>
              </Stack>
            </Box>

            <Box>
              <Typography variant="h6" gutterBottom>
                Loading Sizes
              </Typography>
              <Stack direction="row" spacing={4} alignItems="center">
                <Loading variant="circular" size="small" message="Small" />
                <Loading variant="circular" size="medium" message="Medium" />
                <Loading variant="circular" size="large" message="Large" />
              </Stack>
            </Box>

            <Box>
              <Button onClick={handleLoadingDemo} disabled={loading}>
                {loading ? 'Loading...' : 'Demo Full Screen Loading'}
              </Button>
              {loading && (
                <Loading
                  variant="circular"
                  fullScreen
                  overlay
                  message="Please wait..."
                />
              )}
            </Box>
          </Stack>
        </Card>

        {/* Modal Section */}
        <Card title="Modal Component" size="large">
          <Stack spacing={2}>
            <Typography variant="body2">
              Click the button below to open a modal dialog with various configurations.
            </Typography>
            
            <Box>
              <Button onClick={() => setModalOpen(true)}>
                Open Modal
              </Button>
            </Box>

            <Modal
              open={modalOpen}
              onClose={() => setModalOpen(false)}
              title="Example Modal"
              subtitle="This is a subtitle for the modal"
              size="medium"
              animation="fade"
              headerDivider
              footerDivider
              actions={
                <Stack direction="row" spacing={2}>
                  <Button variant="outlined" onClick={() => setModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setModalOpen(false)}>
                    Confirm
                  </Button>
                </Stack>
              }
            >
              <Typography variant="body1" paragraph>
                This is the modal content. You can put any content here including
                forms, images, or other components.
              </Typography>
              
              <Typography variant="body2" color="text.secondary">
                The modal supports different sizes, animations, and configurations.
                It also includes proper accessibility features and keyboard navigation.
              </Typography>
            </Modal>
          </Stack>
        </Card>

        {/* Additional Components Section */}
        <Card title="Additional Components" size="large">
          <Stack spacing={3}>
            {/* Badges */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Badges
              </Typography>
              <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap">
                <Badge badgeContent={4} color="primary">
                  <Notifications />
                </Badge>
                <Badge badgeContent={99} color="error">
                  <Email />
                </Badge>
                <Badge badgeContent={1000} color="secondary" maxCount={999}>
                  <Star />
                </Badge>
                <Badge variant="dot" color="success" pulse>
                  <Person />
                </Badge>
                <Badge badgeContent="NEW" color="warning" size="small">
                  <Settings />
                </Badge>
              </Stack>
            </Box>

            {/* Tooltips */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Tooltips
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Tooltip title="Default tooltip">
                  <Button>Default</Button>
                </Tooltip>
                <Tooltip title="Arrow tooltip" variant="arrow">
                  <Button>Arrow</Button>
                </Tooltip>
                <Tooltip title="Light tooltip" variant="light">
                  <Button>Light</Button>
                </Tooltip>
                <Tooltip title="This is a multiline tooltip\nwith multiple lines of text" multiline>
                  <Button>Multiline</Button>
                </Tooltip>
              </Stack>
            </Box>

            {/* Avatars */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Avatars
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <Avatar name="John Doe" size="small" />
                <Avatar name="Jane Smith" size="medium" />
                <Avatar name="Bob Johnson" size="large" clickable />
                <Avatar 
                  src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face" 
                  name="Profile User"
                  size="large"
                  bordered
                />
                <Avatar name="Online User" status="online" showStatus />
                <Avatar name="Away User" status="away" showStatus />
                <Avatar loading size="medium" />
              </Stack>
            </Box>

            {/* Skeletons */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Skeleton Loading
              </Typography>
              <Stack spacing={2}>
                <Skeleton variant="text" lines={3} />
                <Skeleton variant="rectangular" width="100%" height={100} />
                <Stack direction="row" spacing={2}>
                  <Skeleton variant="circular" width={40} height={40} />
                  <Box flex={1}>
                    <Skeleton variant="text" width="60%" />
                    <Skeleton variant="text" width="40%" />
                  </Box>
                </Stack>
              </Stack>
            </Box>

            {/* Enhanced Alerts */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Enhanced Alerts
              </Typography>
              <Stack spacing={2}>
                <Alert severity="success" title="Success!" closable>
                  This is a success alert with a title and close button.
                </Alert>
                <Alert severity="info" collapsible title="Collapsible Alert">
                  This alert can be collapsed and expanded. Click the arrow to toggle.
                </Alert>
                <Alert 
                  severity="warning" 
                  loading 
                  progress={65}
                  title="Processing..."
                >
                  This alert shows loading progress.
                </Alert>
                <Alert 
                  severity="error" 
                  title="Error occurred"
                  actions={
                    <Button size="small" variant="outlined">
                      Retry
                    </Button>
                  }
                >
                  This alert has custom actions.
                </Alert>
              </Stack>
            </Box>
          </Stack>
        </Card>

        {/* Component Status */}
        <Card title="Component Status" size="large">
          <Stack spacing={2}>
            <Typography variant="body1">
              All core UI components have been implemented with the following features:
            </Typography>
            
            <Stack spacing={1}>
              <Chip label="✅ Consistent Design Tokens" color="success" variant="outlined" />
              <Chip label="✅ Multiple Variants & Sizes" color="success" variant="outlined" />
              <Chip label="✅ Loading & Error States" color="success" variant="outlined" />
              <Chip label="✅ Accessibility Support" color="success" variant="outlined" />
              <Chip label="✅ TypeScript Support" color="success" variant="outlined" />
              <Chip label="✅ Theme Integration" color="success" variant="outlined" />
              <Chip label="✅ Responsive Design" color="success" variant="outlined" />
              <Chip label="✅ Enhanced Components" color="success" variant="outlined" />
            </Stack>
          </Stack>
        </Card>
      </Stack>
    </Box>
  );
};