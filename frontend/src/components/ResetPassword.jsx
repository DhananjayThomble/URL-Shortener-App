import React, { useState, useEffect } from 'react';
import {
  Container,
  Card,
  Typography,
  TextField,
  Button,
  Box,
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';

function ResetPassword() {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const token = queryParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setMessage('Invalid or missing token.');
      setIsLoading(true);
    }
  }, [token]);

  const handleResetPassword = async () => {
    try {
      if (password !== confirmPassword) {
        setMessage('Passwords do not match.');
        return;
      }

      setIsLoading(true);

      // Make a POST request to your backend API to reset the password
      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}/auth/reset-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token, password }),
        },
      );

      if (response.status === 200) {
        setMessage('Password reset successful.');
        navigate('/login');
      } else {
        // Handle error response from the backend
        const data = await response.json();
        setMessage(data.error || 'Password reset failed.');
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      setMessage('Password reset failed.');
    } finally {
      setIsLoading(false); // re-enable the btn
    }
  };

  return (
    <Container
      maxWidth="sm"
      style={{
        minHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Card>
        <Box m={2}>
          <div style={{ padding: '16px' }}>
            <Typography variant="h4" component="h2" gutterBottom>
              Reset Password
            </Typography>
            <form>
              <Box mb={2}>
                <TextField
                  label="New Password"
                  type="password"
                  fullWidth
                  variant="outlined"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Box>
              <Box mb={2}>
                <TextField
                  label="Confirm Password"
                  type="password"
                  fullWidth
                  variant="outlined"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Box>

              <Button
                style={{ backgroundColor: '#4B3F6B' }}
                variant="contained"
                disabled={isLoading}
                fullWidth
                onClick={handleResetPassword}
              >
                Reset Password
              </Button>
            </form>
            <Typography variant="body1" style={{ marginTop: '16px' }}>
              {message}
            </Typography>
          </div>
        </Box>
      </Card>
    </Container>
  );
}

export default ResetPassword;
