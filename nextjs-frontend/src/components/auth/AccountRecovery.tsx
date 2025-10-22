'use client';

import { useState, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Alert,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Chip,
} from '@mui/material';
import {
  Email,
  Security,
  Key,
  Check,
  Warning,
  Phone,
  AlternateEmail,
} from '@mui/icons-material';
import { useAuth } from '@/hooks/useAuth';

interface AccountRecoveryProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

type RecoveryMethod = 'email' | 'backup_codes' | 'security_questions';

export function AccountRecovery({ onComplete, onCancel }: AccountRecoveryProps) {
  const { requestPasswordReset } = useAuth();
  const [activeStep, setActiveStep] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<RecoveryMethod>('email');
  const [email, setEmail] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [securityAnswers, setSecurityAnswers] = useState<string[]>(['', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  const steps = [
    'Choose Recovery Method',
    'Verify Identity',
    'Recovery Complete',
  ];

  const recoveryMethods = [
    {
      id: 'email' as RecoveryMethod,
      title: 'Email Recovery',
      description: 'Send a recovery link to your registered email address',
      icon: <Email />,
      available: true,
    },
    {
      id: 'backup_codes' as RecoveryMethod,
      title: 'Backup Codes',
      description: 'Use one of your saved backup codes',
      icon: <Key />,
      available: true,
    },
    {
      id: 'security_questions' as RecoveryMethod,
      title: 'Security Questions',
      description: 'Answer your security questions',
      icon: <Security />,
      available: false, // Mock as unavailable
    },
  ];

  const securityQuestions = [
    "What was the name of your first pet?",
    "In what city were you born?",
    "What was your mother's maiden name?",
  ];

  const handleMethodSelect = (method: RecoveryMethod) => {
    setSelectedMethod(method);
    setError('');
    setSuccess('');
  };

  const proceedWithMethod = () => {
    setActiveStep(1);
  };

  const handleEmailRecovery = useCallback(async () => {
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await requestPasswordReset(email);
      setSuccess('Recovery email sent! Check your inbox for further instructions.');
      setActiveStep(2);
    } catch (err) {
      setError('Failed to send recovery email. Please check your email address and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [email, requestPasswordReset]);

  const handleBackupCodeRecovery = useCallback(async () => {
    if (!backupCode || backupCode.length < 6) {
      setError('Please enter a valid backup code');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Mock API call - in real implementation, this would verify the backup code
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mock validation (accept any code with 6+ characters for demo)
      if (backupCode.length >= 6) {
        setSuccess('Backup code verified! You can now reset your password.');
        setActiveStep(2);
      } else {
        throw new Error('Invalid backup code');
      }
    } catch (err) {
      setError('Invalid backup code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [backupCode]);

  const handleSecurityQuestions = useCallback(async () => {
    const unanswered = securityAnswers.some(answer => !answer.trim());
    if (unanswered) {
      setError('Please answer all security questions');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Mock API call - in real implementation, this would verify the answers
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setSuccess('Security questions verified! You can now reset your password.');
      setActiveStep(2);
    } catch (err) {
      setError('One or more answers are incorrect. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [securityAnswers]);

  const handleVerification = () => {
    switch (selectedMethod) {
      case 'email':
        return handleEmailRecovery();
      case 'backup_codes':
        return handleBackupCodeRecovery();
      case 'security_questions':
        return handleSecurityQuestions();
    }
  };

  const renderMethodContent = () => {
    switch (selectedMethod) {
      case 'email':
        return (
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Enter the email address associated with your account:
            </Typography>
            <TextField
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              error={!!error}
              helperText={error}
              fullWidth
              sx={{ mb: 2 }}
            />
            <Alert severity="info">
              A recovery link will be sent to this email address. The link will expire in 1 hour.
            </Alert>
          </Box>
        );

      case 'backup_codes':
        return (
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Enter one of your backup codes:
            </Typography>
            <TextField
              label="Backup Code"
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
              placeholder="XXXXXXXX"
              error={!!error}
              helperText={error}
              fullWidth
              sx={{ mb: 2 }}
            />
            <Alert severity="warning">
              Each backup code can only be used once. Make sure you have access to your other codes.
            </Alert>
          </Box>
        );

      case 'security_questions':
        return (
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Answer your security questions:
            </Typography>
            {securityQuestions.map((question, index) => (
              <TextField
                key={index}
                label={`Question ${index + 1}`}
                placeholder={question}
                value={securityAnswers[index]}
                onChange={(e) => {
                  const newAnswers = [...securityAnswers];
                  newAnswers[index] = e.target.value;
                  setSecurityAnswers(newAnswers);
                }}
                fullWidth
                sx={{ mb: 2 }}
              />
            ))}
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
          </Box>
        );
    }
  };

  return (
    <Box>
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <Security color="primary" />
            <Box>
              <Typography variant="h6">
                Account Recovery
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Regain access to your account using one of the methods below
              </Typography>
            </Box>
          </Box>

          <Stepper activeStep={activeStep} orientation="vertical">
            {/* Step 1: Choose Method */}
            <Step>
              <StepLabel>Choose Recovery Method</StepLabel>
              <StepContent>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Select how you'd like to recover your account:
                </Typography>

                <List>
                  {recoveryMethods.map((method) => (
                    <ListItem
                      key={method.id}
                      onClick={() => method.available && handleMethodSelect(method.id)}
                      sx={{
                        border: '1px solid',
                        borderColor: selectedMethod === method.id ? 'primary.main' : 'divider',
                        borderRadius: 1,
                        mb: 1,
                        cursor: method.available ? 'pointer' : 'not-allowed',
                        opacity: method.available ? 1 : 0.6,
                        '&:hover': method.available ? {
                          backgroundColor: 'action.hover',
                        } : {},
                      }}
                    >
                      <ListItemIcon>
                        {method.icon}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box display="flex" alignItems="center" gap={1}>
                            {method.title}
                            {!method.available && (
                              <Chip label="Unavailable" size="small" color="default" />
                            )}
                          </Box>
                        }
                        secondary={method.description}
                      />
                    </ListItem>
                  ))}
                </List>

                <Box mt={2}>
                  <Button
                    variant="contained"
                    onClick={proceedWithMethod}
                    disabled={!recoveryMethods.find(m => m.id === selectedMethod)?.available}
                  >
                    Continue
                  </Button>
                </Box>
              </StepContent>
            </Step>

            {/* Step 2: Verify Identity */}
            <Step>
              <StepLabel>Verify Identity</StepLabel>
              <StepContent>
                {renderMethodContent()}

                <Box mt={2}>
                  <Button
                    variant="contained"
                    onClick={handleVerification}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Verifying...' : 'Verify'}
                  </Button>
                  <Button
                    onClick={() => setActiveStep(0)}
                    sx={{ ml: 1 }}
                  >
                    Back
                  </Button>
                </Box>
              </StepContent>
            </Step>

            {/* Step 3: Complete */}
            <Step>
              <StepLabel>Recovery Complete</StepLabel>
              <StepContent>
                <Alert severity="success" sx={{ mb: 2 }}>
                  <Typography variant="body2" gutterBottom>
                    <strong>Account recovery successful!</strong>
                  </Typography>
                  <Typography variant="body2">
                    {success}
                  </Typography>
                </Alert>

                <Box>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={onComplete}
                    startIcon={<Check />}
                  >
                    Continue to Login
                  </Button>
                </Box>
              </StepContent>
            </Step>
          </Stepper>

          {onCancel && (
            <Box mt={3}>
              <Divider sx={{ mb: 2 }} />
              <Button onClick={onCancel} color="inherit">
                Cancel Recovery
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

export default AccountRecovery;