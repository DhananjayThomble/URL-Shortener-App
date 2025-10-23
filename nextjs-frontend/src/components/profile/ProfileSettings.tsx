'use client';

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Avatar,
  Stack,
  Alert,
  IconButton,
  Divider,
} from '@mui/material';
import {
  Edit,
  Save,
  Cancel,
  PhotoCamera,
  Person,
} from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { usersAPI } from '@/lib/api/users';
import toast from 'react-hot-toast';

const profileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be less than 100 characters'),
  email: z.string().email('Invalid email address'),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export function ProfileSettings() {
  const { user, updateUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user?.name || '',
      email: user?.email || '',
    },
  });

  const handleEdit = () => {
    setIsEditing(true);
    reset({
      name: user?.name || '',
      email: user?.email || '',
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    reset({
      name: user?.name || '',
      email: user?.email || '',
    });
  };

  const onSubmit = async (data: ProfileFormData) => {
    if (!user) return;

    setIsLoading(true);
    try {
      const response = await usersAPI.updateProfile({
        name: data.name,
      });

      updateUser(response.data);
      setIsEditing(false);
      toast.success('Profile updated successfully');
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast.error('Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAvatarUpload = () => {
    // TODO: Implement avatar upload functionality
    toast('Avatar upload coming soon!', { icon: 'ℹ️' });
  };

  if (!user) {
    return (
      <Alert severity="error">
        Unable to load user profile. Please try refreshing the page.
      </Alert>
    );
  }

  return (
    <Stack spacing={3}>
      {/* Profile Picture Section */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Profile Picture
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Box sx={{ position: 'relative' }}>
              <Avatar
                sx={{ width: 80, height: 80, bgcolor: 'primary.main' }}
              >
                <Person sx={{ fontSize: 40 }} />
              </Avatar>
              <IconButton
                sx={{
                  position: 'absolute',
                  bottom: -8,
                  right: -8,
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  '&:hover': {
                    bgcolor: 'action.hover',
                  },
                }}
                size="small"
                onClick={handleAvatarUpload}
              >
                <PhotoCamera fontSize="small" />
              </IconButton>
            </Box>
            <Box>
              <Typography variant="body1" gutterBottom>
                Upload a new profile picture
              </Typography>
              <Typography variant="body2" color="text.secondary">
                JPG, PNG or GIF. Max size 2MB.
              </Typography>
              <Button
                variant="outlined"
                size="small"
                startIcon={<PhotoCamera />}
                onClick={handleAvatarUpload}
                sx={{ mt: 1 }}
              >
                Upload Photo
              </Button>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Basic Information */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6">
              Basic Information
            </Typography>
            {!isEditing && (
              <Button
                startIcon={<Edit />}
                onClick={handleEdit}
                variant="outlined"
                size="small"
              >
                Edit
              </Button>
            )}
          </Box>

          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack spacing={3}>
              <TextField
                label="Full Name"
                {...register('name')}
                error={!!errors.name}
                helperText={errors.name?.message}
                disabled={!isEditing}
                fullWidth
              />

              <TextField
                label="Email Address"
                {...register('email')}
                error={!!errors.email}
                helperText={errors.email?.message || 'Email changes require verification'}
                disabled={true} // Email changes should be handled separately
                fullWidth
              />

              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Account Status
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: user.isEmailVerified ? 'success.main' : 'warning.main',
                    }}
                  />
                  <Typography variant="body2">
                    {user.isEmailVerified ? 'Email Verified' : 'Email Not Verified'}
                  </Typography>
                </Box>
              </Box>

              {isEditing && (
                <>
                  <Divider />
                  <Stack direction="row" spacing={2} justifyContent="flex-end">
                    <Button
                      variant="outlined"
                      onClick={handleCancel}
                      disabled={isLoading}
                      startIcon={<Cancel />}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={!isDirty || isLoading}
                      startIcon={<Save />}
                    >
                      {isLoading ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </Stack>
                </>
              )}
            </Stack>
          </form>
        </CardContent>
      </Card>

      {/* Account Information */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Account Information
          </Typography>
          <Stack spacing={2}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Member Since
              </Typography>
              <Typography variant="body1">
                {new Date(user.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </Typography>
            </Box>

            <Box>
              <Typography variant="body2" color="text.secondary">
                Last Login
              </Typography>
              <Typography variant="body1">
                {user.lastLoginAt
                  ? new Date(user.lastLoginAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Never'}
              </Typography>
            </Box>

            <Box>
              <Typography variant="body2" color="text.secondary">
                Account Type
              </Typography>
              <Typography variant="body1" sx={{ textTransform: 'capitalize' }}>
                {user.role}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}