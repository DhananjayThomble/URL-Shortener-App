'use client';

import { useMemo } from 'react';
import {
  Box,
  LinearProgress,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
} from '@mui/material';
import { Check, Close, Info } from '@mui/icons-material';
import { useSecurity } from '@/hooks/useSecurity';

interface PasswordStrengthIndicatorProps {
  password: string;
  showRequirements?: boolean;
  showScore?: boolean;
  compact?: boolean;
}

export function PasswordStrengthIndicator({
  password,
  showRequirements = true,
  showScore = true,
  compact = false,
}: PasswordStrengthIndicatorProps) {
  const { validatePasswordStrength } = useSecurity();

  const strength = useMemo(() => {
    if (!password) {
      return {
        score: 0,
        feedback: [],
        isStrong: false,
      };
    }
    return validatePasswordStrength(password);
  }, [password, validatePasswordStrength]);

  const getStrengthColor = (score: number): 'error' | 'warning' | 'info' | 'success' => {
    if (score <= 1) return 'error';
    if (score <= 2) return 'warning';
    if (score <= 4) return 'info';
    return 'success';
  };

  const getStrengthLabel = (score: number): string => {
    if (score <= 1) return 'Very Weak';
    if (score <= 2) return 'Weak';
    if (score <= 4) return 'Good';
    return 'Strong';
  };

  const requirements = [
    { text: 'At least 8 characters', met: password.length >= 8 },
    { text: 'Contains lowercase letter', met: /[a-z]/.test(password) },
    { text: 'Contains uppercase letter', met: /[A-Z]/.test(password) },
    { text: 'Contains number', met: /\d/.test(password) },
    { text: 'Contains special character', met: /[^a-zA-Z\d]/.test(password) },
    { text: 'No repeated characters', met: !/(.)\1{2,}/.test(password) },
    { text: 'No common sequences', met: !/123|abc|qwe/i.test(password) },
  ];

  if (compact) {
    return (
      <Box>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <LinearProgress
            variant="determinate"
            value={(strength.score / 6) * 100}
            color={getStrengthColor(strength.score)}
            sx={{ flex: 1, height: 6, borderRadius: 3 }}
          />
          <Chip
            label={getStrengthLabel(strength.score)}
            color={getStrengthColor(strength.score)}
            size="small"
          />
        </Box>
        {strength.feedback.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {strength.feedback[0]}
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box>
      {/* Strength Indicator */}
      <Box mb={2}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography variant="body2" color="text.secondary">
            Password Strength
          </Typography>
          {showScore && (
            <Chip
              label={`${getStrengthLabel(strength.score)} (${strength.score}/6)`}
              color={getStrengthColor(strength.score)}
              size="small"
            />
          )}
        </Box>
        <LinearProgress
          variant="determinate"
          value={(strength.score / 6) * 100}
          color={getStrengthColor(strength.score)}
          sx={{ height: 8, borderRadius: 4 }}
        />
      </Box>

      {/* Requirements Checklist */}
      {showRequirements && (
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Password Requirements
          </Typography>
          <List dense>
            {requirements.map((req, index) => (
              <ListItem key={index} sx={{ py: 0.5 }}>
                <ListItemIcon sx={{ minWidth: 32 }}>
                  {req.met ? (
                    <Check color="success" fontSize="small" />
                  ) : (
                    <Close color="error" fontSize="small" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      variant="body2"
                      color={req.met ? 'success.main' : 'text.secondary'}
                    >
                      {req.text}
                    </Typography>
                  }
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {/* Feedback */}
      {strength.feedback.length > 0 && (
        <Box mt={2}>
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <Info color="info" fontSize="small" />
            <Typography variant="body2" color="info.main">
              Suggestions
            </Typography>
          </Box>
          <List dense>
            {strength.feedback.map((feedback, index) => (
              <ListItem key={index} sx={{ py: 0.25, pl: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  • {feedback}
                </Typography>
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </Box>
  );
}

export default PasswordStrengthIndicator;