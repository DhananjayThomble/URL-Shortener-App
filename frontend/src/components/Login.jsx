import React, { useEffect, useState, useContext } from 'react';
import { toast } from 'react-toastify';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { FaUserAlt, FaKey, FaSignInAlt } from 'react-icons/fa';
import UserContext from '../context/UserContext';
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
import '../App.css';
import './Footer.css';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const URL = `${import.meta.env.VITE_API_ENDPOINT}`;
  const navigate = useNavigate();
  const context = useContext(UserContext);
  let toastId = null;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      toast.warning('You are already logged in');
      setTimeout(() => {
        navigate('/');
      }, 4000);
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    toastId = null;
    toastId = toast.loading('Logging in...');
    if (!validateForm()) return;

    await fetchLogin();
  };

  function validateForm() {
    if (email === '' || password === '') {
      toast.update(toastId, {
        render: 'Please fill all the fields',
        type: 'error',
        isLoading: false,
        autoClose: 2000,
      });
      return false;
    }
    return true;
  }

  const fetchLogin = async () => {
    try {
      const response = await axios.post(`${URL}/auth/login`, {
        email,
        password,
      });
      const {
        token,
        user: { name },
      } = response.data;

      localStorage.setItem('token', token);
      localStorage.setItem('name', name);
      context.setUser({ token: token });
      toast.update(toastId, {
        render: `Welcome ${name}`,
        type: 'success',
        isLoading: false,
        autoClose: 2000,
      });
      navigate('/');
    } catch ({
      response: {
        status,
        data: { error },
      },
    }) {
      toast.update(toastId, {
        render: 'Login failed',
        type: 'error',
        isLoading: false,
        autoClose: 2000,
      });
      if (status === 400) {
        toast.error(error);
      } else if (status === 401) {
        toast.error(error);
      } else {
        toast.error('Something went wrong');
      }
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
            title={<Typography variant="h5">Login</Typography>}
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
                <Link
                  onClick={() => navigate('/forgot-password')}
                  sx={{
                    textDecoration: 'none',
                    color: '#4B3F6B',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Forgot password
                </Link>
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
                startIcon={<FaSignInAlt />}
              >
                LOGIN
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
              Don't Have an Account?
            </Typography>
            <Link
              onClick={() => navigate('/signup')}
              sx={{
                textDecoration: 'none',
                color: '#4B3F6B',
                cursor: 'pointer',
              }}
            >
              Click Here to Signup
            </Link>
          </CardActions>
        </Card>
      </Box>
    </Container>
  );
}

export default Login;
