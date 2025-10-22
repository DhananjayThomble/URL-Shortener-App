'use client';

import { useState, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Alert,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
} from '@mui/material';
import {
  Security,
  Smartphone,
  QrCode,
  Key,
  Check,
  Warning,
  ContentCopy,
} from '@mui/icons-material';
import { useAuth } from '@/hooks/useAuth';

interface TwoFactorSetupProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

export function TwoFactorSetup({ onComplete, onCancel }: TwoFactorSetupProps) {
  const { user } = useAuth();
  const [activeStep, setActiveStep] = useState(0);
  const [qrCode, setQrCode] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  const steps = [
    'Install Authenticator App',
    'Scan QR Code',
    'Verify Setup',
    'Save Backup Codes',
  ];

  // Generate 2FA setup (mock implementation)
  const generateTwoFactorSetup = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      // Mock API call - in real implementation, this would call your backend
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mock QR code and secret
      const mockSecret = 'JBSWY3DPEHPK3PXP';
      const mockQrCode = `otpauth://totp/SnapURL:${user?.email}?secret=${mockSecret}&issuer=SnapURL`;
      
      setSecret(mockSecret);
      setQrCode(mockQrCode);
      setActiveStep(1);
    } catch (err) {
      setError('Failed to generate 2FA setup. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.email]);

  // Verify 2FA code
  const verifyTwoFactorCode = useCallback(async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Mock API call - in real implementation, this would verify the code
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mock verification (accept any 6-digit code for demo)
      if (!/^\d{6}$/.test(verificationCode)) {
        throw new Error('Invalid code format');
      }

      // Generate backup codes
      const codes = Array.from({ length: 10 }, () => 
        Math.random().toString(36).substring(2, 10).toUpperCase()
      );
      setBackupCodes(codes);
      setActiveStep(3);
    } catch (err) {
      setError('Invalid verification code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [verificationCode]);

  // Complete setup
  const completeTwoFactorSetup = useCallback(async () => {
    setIsLoading(true);
    
    try {
      // Mock API call - in real implementation, this would enable 2FA
      await new Promise(resolve => setTimeout(resolve, 1000));
      onComplete?.();
    } catch (err) {
      setError('Failed to complete 2FA setup. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [onComplete]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const downloadBackupCodes = () => {
    const content = `SnapURL Two-Factor Authentication Backup Codes\n\nGenerated: ${new Date().toLocaleString()}\nAccount: ${user?.email}\n\n${backupCodes.map((code, i) => `${i + 1}. ${code}`).join('\n')}\n\nImportant:\n- Keep these codes in a safe place\n- Each code can only be used once\n- Use these codes if you lose access to your authenticator app`;
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'snapurl-backup-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <Security color="primary" />
            <Box>
              <Typography variant="h6">
                Set Up Two-Factor Authentication
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add an extra layer of security to your account
              </Typography>
            </Box>
          </Box>

          <Stepper activeStep={activeStep} orientation="vertical">
            {/* Step 1: Install App */}
            <Step>
              <StepLabel>Install Authenticator App</StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  First, install an authenticator app on your mobile device:
                </Typography>
                
                <List>
                  <ListItem>
                    <ListItemIcon>
                      <Smartphone />
                    </ListItemIcon>
                    <ListItemText
                      primary="Google Authenticator"
                      secondary="Free app for iOS and Android"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Smartphone />
                    </ListItemIcon>
                    <ListItemText
                      primary="Authy"
                      secondary="Multi-device support with cloud backup"
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <Smartphone />
                    </ListItemIcon>
                    <ListItemText
                      primary="Microsoft Authenticator"
                      secondary="Free app with additional Microsoft integration"
                    />
                  </ListItem>
                </List>

                <Box mt={2}>
                  <Button
                    variant="contained"
                    onClick={generateTwoFactorSetup}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Generating...' : 'Continue'}
                  </Button>
                </Box>
              </StepContent>
            </Step>

            {/* Step 2: Scan QR Code */}
            <Step>
              <StepLabel>Scan QR Code</StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Open your authenticator app and scan this QR code:
                </Typography>

                <Box display="flex" flexDirection="column" alignItems="center" gap={2} my={3}>
                  {/* Mock QR Code - in real implementation, use a QR code library */}
                  <Box
                    sx={{
                      width: 200,
                      height: 200,
                      border: '2px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: 'background.paper',
                    }}
                  >
                    <QrCode sx={{ fontSize: 100, color: 'text.secondary' }} />
                  </Box>
                  
                  <Typography variant="caption" color="text.secondary">
                    QR Code for {user?.email}
                  </Typography>
                </Box>

                <Alert severity="info" sx={{ mb: 2 }}>
                  Can't scan the QR code? You can manually enter this secret key:
                  <Box display="flex" alignItems="center" gap={1} mt={1}>
                    <Chip label={secret} variant="outlined" />
                    <Button
                      size="small"
                      startIcon={<ContentCopy />}
                      onClick={() => copyToClipboard(secret)}
                    >
                      Copy
                    </Button>
                  </Box>
                </Alert>

                <Box>
                  <Button
                    variant="contained"
                    onClick={() => setActiveStep(2)}
                  >
                    Continue
                  </Button>
                </Box>
              </StepContent>
            </Step>

            {/* Step 3: Verify */}
            <Step>
              <StepLabel>Verify Setup</StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Enter the 6-digit code from your authenticator app:
                </Typography>

                <Box my={2}>
                  <TextField
                    label="Verification Code"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder="123456"
                    inputProps={{ maxLength: 6 }}
                    error={!!error}
                    helperText={error}
                    fullWidth
                  />
                </Box>

                <Box>
                  <Button
                    variant="contained"
                    onClick={verifyTwoFactorCode}
                    disabled={isLoading || verificationCode.length !== 6}
                  >
                    {isLoading ? 'Verifying...' : 'Verify'}
                  </Button>
                </Box>
              </StepContent>
            </Step>

            {/* Step 4: Backup Codes */}
            <Step>
              <StepLabel>Save Backup Codes</StepLabel>
              <StepContent>
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <Typography variant="body2" gutterBottom>
                    <strong>Important:</strong> Save these backup codes in a safe place.
                  </Typography>
                  <Typography variant="body2">
                    You can use these codes to access your account if you lose your phone.
                  </Typography>
                </Alert>

                <Box display="flex" gap={1} mb={2}>
                  <Button
                    variant="outlined"
                    startIcon={<ContentCopy />}
                    onClick={() => copyToClipboard(backupCodes.join('\n'))}
                  >
                    Copy Codes
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={downloadBackupCodes}
                  >
                    Download
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => setShowBackupCodes(true)}
                  >
                    View Codes
                  </Button>
                </Box>

                <Box>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={completeTwoFactorSetup}
                    disabled={isLoading}
                    startIcon={<Check />}
                  >
                    {isLoading ? 'Completing...' : 'Complete Setup'}
                  </Button>
                </Box>
              </StepContent>
            </Step>
          </Stepper>

          {onCancel && (
            <Box mt={3}>
              <Divider sx={{ mb: 2 }} />
              <Button onClick={onCancel} color="inherit">
                Cancel Setup
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Backup Codes Dialog */}
      <Dialog
        open={showBackupCodes}
        onClose={() => setShowBackupCodes(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <Key />
            Backup Codes
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Each code can only be used once. Keep them safe!
          </Alert>
          <Box
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: 2,
            }}
          >
            {backupCodes.map((code, index) => (
              <Box key={index} display="flex" justifyContent="space-between">
                <span>{index + 1}.</span>
                <span>{code}</span>
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowBackupCodes(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default TwoFactorSetup;