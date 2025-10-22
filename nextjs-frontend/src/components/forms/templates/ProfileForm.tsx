'use client';

import { useState } from 'react';
import { Stack, Box, Typography, Avatar, IconButton, Alert } from '@mui/material';
import { 
  Person, 
  Email, 
  Phone, 
  Language, 
  LocationOn, 
  Edit, 
  Save,
  Cancel 
} from '@mui/icons-material';
import { Form, FormInput, FormSubmitButton, FormResetButton } from '../';
import { UserSchemas, type ProfileFormData } from '@/lib/validation/schemas';

export interface ProfileFormProps {
  initialData?: Partial<ProfileFormData>;
  onSubmit: (data: ProfileFormData) => Promise<void>;
  onAvatarChange?: (file: File) => Promise<string>;
  loading?: boolean;
  error?: string;
  success?: string;
  autoSave?: boolean;
  showAvatar?: boolean;
}

export const ProfileForm: React.FC<ProfileFormProps> = ({
  initialData,
  onSubmit,
  onAvatarChange,
  loading = false,
  error,
  success,
  autoSave = true,
  showAvatar = true,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    initialData?.avatar || null
  );

  const handleSubmit = async (data: ProfileFormData) => {
    try {
      setIsSubmitting(true);
      await onSubmit(data);
    } catch (error) {
      console.error('Profile update error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onAvatarChange) return;

    try {
      const avatarUrl = await onAvatarChange(file);
      setAvatarPreview(avatarUrl);
    } catch (error) {
      console.error('Avatar upload error:', error);
    }
  };

  const generateInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part.charAt(0))
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Profile Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Update your personal information and preferences
        </Typography>
      </Box>

      <Form<ProfileFormData>
        schema={UserSchemas.profile}
        onSubmit={handleSubmit}
        loading={loading || isSubmitting}
        error={error}
        success={success}
        autoSave={autoSave}
        defaultValues={{
          name: '',
          email: '',
          phone: '',
          bio: '',
          website: '',
          location: '',
          avatar: '',
          ...initialData,
        }}
      >
        <Stack spacing={4}>
          {/* Avatar Section */}
          {showAvatar && (
            <Box sx={{ textAlign: 'center' }}>
              <Box sx={{ position: 'relative', display: 'inline-block', mb: 2 }}>
                <Avatar
                  src={avatarPreview || initialData?.avatar}
                  sx={{ 
                    width: 120, 
                    height: 120, 
                    fontSize: '2rem',
                    border: 3,
                    borderColor: 'background.paper',
                    boxShadow: 2,
                  }}
                >
                  {initialData?.name ? generateInitials(initialData.name) : <Person />}
                </Avatar>
                
                {onAvatarChange && (
                  <IconButton
                    component="label"
                    sx={{
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                      backgroundColor: 'primary.main',
                      color: 'primary.contrastText',
                      '&:hover': {
                        backgroundColor: 'primary.dark',
                      },
                    }}
                  >
                    <Edit fontSize="small" />
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={handleAvatarChange}
                    />
                  </IconButton>
                )}
              </Box>
              
              <Typography variant="body2" color="text.secondary">
                Click the edit icon to change your profile picture
              </Typography>
            </Box>
          )}

          {/* Basic Information */}
          <Box>
            <Typography variant="h6" gutterBottom>
              Basic Information
            </Typography>
            
            <Stack spacing={3}>
              <FormInput
                name="name"
                label="Full Name"
                placeholder="Enter your full name"
                leftIcon={<Person />}
                required
                fullWidth
              />

              <FormInput
                name="email"
                label="Email Address"
                type="email"
                placeholder="Enter your email"
                leftIcon={<Email />}
                required
                fullWidth
                helperText="This will be used for account notifications"
              />

              <FormInput
                name="phone"
                label="Phone Number"
                type="tel"
                placeholder="Enter your phone number"
                leftIcon={<Phone />}
                fullWidth
              />
            </Stack>
          </Box>

          {/* Additional Information */}
          <Box>
            <Typography variant="h6" gutterBottom>
              Additional Information
            </Typography>
            
            <Stack spacing={3}>
              <FormInput
                name="bio"
                label="Bio"
                placeholder="Tell us a bit about yourself..."
                multiline
                rows={3}
                fullWidth
                characterLimit={500}
                showCharacterCount
              />

              <FormInput
                name="website"
                label="Website"
                type="url"
                placeholder="https://your-website.com"
                leftIcon={<Language />}
                fullWidth
              />

              <FormInput
                name="location"
                label="Location"
                placeholder="City, Country"
                leftIcon={<LocationOn />}
                fullWidth
              />
            </Stack>
          </Box>

          {/* Privacy Notice */}
          <Alert severity="info" sx={{ fontSize: '0.875rem' }}>
            Your profile information will be visible to other users. 
            You can control what information is displayed in your privacy settings.
          </Alert>

          {/* Action Buttons */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormSubmitButton
              loading={loading || isSubmitting}
              fullWidth
              size="large"
              icon={<Save />}
            >
              Save Changes
            </FormSubmitButton>

            <FormResetButton
              size="large"
              icon={<Cancel />}
              sx={{ minWidth: { sm: 140 } }}
            >
              Reset Changes
            </FormResetButton>
          </Stack>
        </Stack>
      </Form>
    </Box>
  );
};