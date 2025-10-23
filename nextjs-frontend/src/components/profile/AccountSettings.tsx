'use client';

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
} from '@mui/material';
import {
  Download,
  Delete,
  Warning,
  DataUsage,
  Link as LinkIcon,
  Analytics,
  QrCode,
} from '@mui/icons-material';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

export function AccountSettings() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportData = async () => {
    setIsExporting(true);
    try {
      // TODO: Implement data export functionality
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call
      toast.success('Data export will be sent to your email');
    } catch (error) {
      console.error('Failed to export data:', error);
      toast.error('Failed to export data');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (confirmationText !== 'DELETE') {
      toast.error('Please type DELETE to confirm');
      return;
    }

    setIsDeleting(true);
    try {
      // TODO: Implement account deletion
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call
      toast.success('Account deletion initiated');
      logout();
      router.push('/');
    } catch (error) {
      console.error('Failed to delete account:', error);
      toast.error('Failed to delete account');
    } finally {
      setIsDeleting(false);
    }
  };

  // Mock data for account usage
  const accountUsage = {
    totalUrls: 42,
    totalClicks: 1234,
    totalQrCodes: 15,
    storageUsed: '2.3 MB',
    accountAge: user ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0,
  };

  return (
    <Stack spacing={3}>
      {/* Account Usage */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Account Usage
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Overview of your account activity and data usage
          </Typography>

          <List>
            <ListItem>
              <ListItemIcon>
                <LinkIcon color="primary" />
              </ListItemIcon>
              <ListItemText
                primary="Shortened URLs"
                secondary={`${accountUsage.totalUrls} URLs created`}
              />
            </ListItem>

            <ListItem>
              <ListItemIcon>
                <Analytics color="primary" />
              </ListItemIcon>
              <ListItemText
                primary="Total Clicks"
                secondary={`${accountUsage.totalClicks.toLocaleString()} clicks tracked`}
              />
            </ListItem>

            <ListItem>
              <ListItemIcon>
                <QrCode color="primary" />
              </ListItemIcon>
              <ListItemText
                primary="QR Codes"
                secondary={`${accountUsage.totalQrCodes} QR codes generated`}
              />
            </ListItem>

            <ListItem>
              <ListItemIcon>
                <DataUsage color="primary" />
              </ListItemIcon>
              <ListItemText
                primary="Storage Used"
                secondary={accountUsage.storageUsed}
              />
            </ListItem>
          </List>
        </CardContent>
      </Card>

      {/* Data Export */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Export Your Data
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Download a copy of all your data including URLs, analytics, and account information
          </Typography>

          <Alert severity="info" sx={{ mb: 3 }}>
            Your data export will include:
            <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
              <li>All shortened URLs and their analytics</li>
              <li>QR codes and click data</li>
              <li>Account information and settings</li>
              <li>Activity logs and usage statistics</li>
            </ul>
          </Alert>

          <Button
            variant="outlined"
            startIcon={<Download />}
            onClick={handleExportData}
            disabled={isExporting}
          >
            {isExporting ? 'Preparing Export...' : 'Export My Data'}
          </Button>
        </CardContent>
      </Card>

      {/* Account Deletion */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Warning color="error" />
            <Typography variant="h6" color="error">
              Delete Account
            </Typography>
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Permanently delete your account and all associated data. This action cannot be undone.
          </Typography>

          <Alert severity="error" sx={{ mb: 3 }}>
            <Typography variant="body2" gutterBottom>
              <strong>This will permanently delete:</strong>
            </Typography>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li>All your shortened URLs</li>
              <li>Analytics and click data</li>
              <li>QR codes and customizations</li>
              <li>Account settings and preferences</li>
            </ul>
          </Alert>

          <Button
            variant="outlined"
            color="error"
            startIcon={<Delete />}
            onClick={() => setDeleteDialogOpen(true)}
          >
            Delete My Account
          </Button>
        </CardContent>
      </Card>

      {/* Delete Account Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Warning color="error" />
            <Typography variant="h6" color="error">
              Delete Account
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent>
          <Alert severity="error" sx={{ mb: 3 }}>
            This action is permanent and cannot be undone. All your data will be permanently deleted.
          </Alert>

          <Typography variant="body1" gutterBottom>
            To confirm account deletion, please type <strong>DELETE</strong> in the field below:
          </Typography>

          <TextField
            fullWidth
            placeholder="Type DELETE to confirm"
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            sx={{ mt: 2 }}
            error={confirmationText !== '' && confirmationText !== 'DELETE'}
            helperText={
              confirmationText !== '' && confirmationText !== 'DELETE'
                ? 'Please type DELETE exactly as shown'
                : ''
            }
          />

          <Box sx={{ mt: 3, p: 2, bgcolor: 'error.light', borderRadius: 1 }}>
            <Typography variant="body2" color="error.contrastText">
              <strong>Account Summary:</strong>
            </Typography>
            <Typography variant="body2" color="error.contrastText">
              • {accountUsage.totalUrls} URLs will be deleted
            </Typography>
            <Typography variant="body2" color="error.contrastText">
              • {accountUsage.totalClicks.toLocaleString()} clicks of data will be lost
            </Typography>
            <Typography variant="body2" color="error.contrastText">
              • Account active for {accountUsage.accountAge} days
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => {
              setDeleteDialogOpen(false);
              setConfirmationText('');
            }}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeleteAccount}
            color="error"
            variant="contained"
            disabled={confirmationText !== 'DELETE' || isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete Account'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}