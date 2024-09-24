import React, { useState } from 'react';
import { toast } from 'react-toastify';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { FaUserAlt, FaKey, FaUserCircle, FaUserPlus } from 'react-icons/fa';
import {
  Container,
  Box,
  Card,
  CardContent,
  CardHeader,
  CardActions,
  Button,
  TextField,
  Typography,
  Link,
  Divider,
} from '@mui/material';

function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const URL = `${import.meta.env.VITE_API_ENDPOINT}`;
  const navigate = useNavigate();
  let toastId = null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    toastId = toast.loading('Signing up...');
    if (!validateForm()) return;
    await fetchSignup();
  };

  const validateForm = () => {
    if (email === '' || password === '' || confirmPassword === '' || name === '') {
      toast.update(toastId, {
        render: 'Please fill all the fields',
        type: 'error',
        isLoading: false,
        autoClose: 2000,
      });
      return false;
    }
    if (password !== confirmPassword) {
      toast.update(toastId, {
        render: 'Passwords do not match',
        type: 'error',
        isLoading: false,
        autoClose: 2000,
      });
      return false;
    }
    if (password.length < 6) {
      toast.update(toastId, {
        render: 'Password must be at least 6 characters',
        type: 'error',
        isLoading: false,
        autoClose: 2000,
      });
      return false;
    }
    return true;
  };

  const fetchSignup = async () => {
    try {
      const response = await axios.post(`${URL}/auth/signup`, {
        email,
        password,
        name,
      });
      if (response.data.ok) {
        toast.update(toastId, {
          render: 'Signup successful',
          type: 'success',
          isLoading: false,
          autoClose: 2000,
        });
        navigate('/login');
      } else {
        toast.update(toastId, {
          render: 'Signup failed',
          type: 'error',
          isLoading: false,
          autoClose: 2000,
        });
      }
    } catch (error) {
      toast.update(toastId, {
        render: 'Signup failed',
        type: 'error',
        isLoading: false,
        autoClose: 2000,
      });
    }
  };

  return (
    <Container
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '90vh',
      }}
    >
      <Box sx={{ maxWidth: '400px', width: '100%' }}>
        <Card>
          <CardHeader
            sx={{ backgroundColor: '#4B3F6B', color: 'white' }}
            title={<Typography variant="h5">Sign Up</Typography>}
          />
          <CardContent>
            <Box component="form" onSubmit={handleSubmit}>
              <Box sx={{ mb: 3 }}>
                <Typography
                  component="label"
                  sx={{
                    display: 'flex',
                    gap: '5px',
                    alignItems: 'center',
                    marginBottom: '7px',
                    fontWeight: '600',
                  }}
                >
                  <FaUserCircle /> Name
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  type=""
                  placeholder="Enter Your Name"
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </Box>
              <Box sx={{ mb: 3 }}>
                <Typography
                  component="label"
                  sx={{
                    display: 'flex',
                    gap: '5px',
                    alignItems: 'center',
                    marginBottom: '7px',
                    fontWeight: '600',
                  }}
                >
                  <FaUserAlt /> Email address
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="email"
                  placeholder="Enter email"
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Typography variant="caption" color="textSecondary">
                  We'll never share your email with anyone else.
                </Typography>
              </Box>
              <Box sx={{ mb: 3 }}>
                <Typography
                  component="label"
                  sx={{
                    display: 'flex',
                    gap: '5px',
                    alignItems: 'center',
                    marginBottom: '7px',
                    fontWeight: '600',
                  }}
                >
                  <FaKey /> Password
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  placeholder="Password"
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Box>
              <Box sx={{ mb: 3 }}>
                <Typography
                  component="label"
                  sx={{
                    display: 'flex',
                    gap: '5px',
                    alignItems: 'center',
                    marginBottom: '7px',
                    fontWeight: '600',
                  }}
                >
                  <FaKey /> Confirm Password
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  placeholder="Confirm Password"
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </Box>
              <Button
                fullWidth
                variant="contained"
                type="submit"
                sx={{
                  backgroundColor: '#4B3F6B',
                  color: 'white',
                  borderRadius: '20px',
                }}
                startIcon={<FaUserPlus />}
              >
                SIGN UP
              </Button>
            </Box>
          </CardContent>
          <Divider sx={{ backgroundColor: 'black' }} />
          <CardActions
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '14px',
            }}
          >
            <Typography variant="body1" sx={{ color: 'grey' }}>
              Already Have an Account?
            </Typography>
            <Link
              onClick={() => navigate('/login')}
              sx={{
                textDecoration: 'none',
                color: '#4B3F6B',
                cursor: 'pointer',
              }}
            >
              Click Here to Login
            </Link>
          </CardActions>
        </Card>
      </Box>
    </Container>
  );
}

export default Signup;
