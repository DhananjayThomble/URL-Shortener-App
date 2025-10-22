'use client';

import { useState } from 'react';
import {
  Box,
  Stack,
  Typography,
  Card,
  CardContent,
  Divider,
  Alert,
  Chip,
} from '@mui/material';
import {
  Form,
  FormInput,
  FormSelect,
  FormCheckbox,
  FormRadioGroup,
  FormSubmitButton,
  FormResetButton,
  LoginForm,
  RegisterForm,
  ValidationSchemas,
  type LoginFormData,
  type RegisterFormData,
} from '@/components/forms';
import { Button } from '@/components/ui';
import { z } from 'zod';

// Example form schema
const exampleSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email'),
  age: z.number().min(18, 'Must be at least 18 years old'),
  country: z.string().min(1, 'Please select a country'),
  interests: z.array(z.string()).min(1, 'Select at least one interest'),
  newsletter: z.boolean(),
  contactMethod: z.enum(['email', 'phone', 'sms']),
  bio: z.string().max(500, 'Bio must be less than 500 characters').optional(),
});

type ExampleFormData = z.infer<typeof exampleSchema>;

const countryOptions = [
  { value: 'us', label: 'United States' },
  { value: 'ca', label: 'Canada' },
  { value: 'uk', label: 'United Kingdom' },
  { value: 'de', label: 'Germany' },
  { value: 'fr', label: 'France' },
  { value: 'jp', label: 'Japan' },
  { value: 'au', label: 'Australia' },
];

const interestOptions = [
  { value: 'tech', label: 'Technology' },
  { value: 'design', label: 'Design' },
  { value: 'business', label: 'Business' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'development', label: 'Development' },
];

const contactMethodOptions = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'sms', label: 'SMS' },
];

export const FormsExample: React.FC = () => {
  const [formData, setFormData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Example form submission
  const handleExampleSubmit = async (data: ExampleFormData) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      setFormData(data);
      setSuccess('Form submitted successfully!');
    } catch (err) {
      setError('Failed to submit form. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Login form submission
  const handleLogin = async (data: LoginFormData) => {
    console.log('Login data:', data);
    await new Promise(resolve => setTimeout(resolve, 1000));
    alert('Login successful! (This is just a demo)');
  };

  // Register form submission
  const handleRegister = async (data: RegisterFormData) => {
    console.log('Register data:', data);
    await new Promise(resolve => setTimeout(resolve, 1000));
    alert('Registration successful! (This is just a demo)');
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      <Stack spacing={4}>
        {/* Header */}
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Form System Demo
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Comprehensive form components with validation, auto-save, and error handling.
          </Typography>
        </Box>

        <Alert severity="info">
          This page demonstrates our form system built with React Hook Form, Zod validation,
          and Material-UI components.
        </Alert>

        {/* Features Overview */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Form System Features
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
              <Chip label="✅ React Hook Form Integration" color="success" variant="outlined" />
              <Chip label="✅ Zod Schema Validation" color="success" variant="outlined" />
              <Chip label="✅ Auto-save & Recovery" color="success" variant="outlined" />
              <Chip label="✅ TypeScript Support" color="success" variant="outlined" />
              <Chip label="✅ Accessibility" color="success" variant="outlined" />
              <Chip label="✅ Error Handling" color="success" variant="outlined" />
              <Chip label="✅ Progress Tracking" color="success" variant="outlined" />
              <Chip label="✅ Pre-built Templates" color="success" variant="outlined" />
            </Stack>
          </CardContent>
        </Card>

        {/* Example Form */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Example Form with Validation
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              This form demonstrates various field types, validation, and auto-save functionality.
            </Typography>

            <Form<ExampleFormData>
              schema={exampleSchema}
              onSubmit={handleExampleSubmit}
              loading={loading}
              error={error}
              success={success}
              autoSave
              showProgress
              title="User Information"
              subtitle="Please fill out all required fields"
              defaultValues={{
                name: '',
                email: '',
                age: 18,
                country: '',
                interests: [],
                newsletter: false,
                contactMethod: 'email' as const,
                bio: '',
              }}
            >
              <Stack spacing={3}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <FormInput
                    name="name"
                    label="Full Name"
                    placeholder="Enter your full name"
                    required
                    fullWidth
                  />
                  <FormInput
                    name="email"
                    label="Email Address"
                    type="email"
                    placeholder="Enter your email"
                    required
                    fullWidth
                  />
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <FormInput
                    name="age"
                    label="Age"
                    type="number"
                    placeholder="Enter your age"
                    required
                    fullWidth
                  />
                  <FormSelect
                    name="country"
                    label="Country"
                    options={countryOptions}
                    placeholder="Select your country"
                    required
                    fullWidth
                  />
                </Stack>

                <FormSelect
                  name="interests"
                  label="Interests"
                  options={interestOptions}
                  multiple
                  placeholder="Select your interests"
                  helperText="You can select multiple interests"
                  required
                  fullWidth
                />

                <FormRadioGroup
                  name="contactMethod"
                  label="Preferred Contact Method"
                  options={contactMethodOptions}
                  direction="row"
                  required
                />

                <FormInput
                  name="bio"
                  label="Bio"
                  multiline
                  rows={4}
                  placeholder="Tell us about yourself..."
                  characterLimit={500}
                  showCharacterCount
                  fullWidth
                />

                <FormCheckbox
                  name="newsletter"
                  checkboxLabel="Subscribe to our newsletter for updates and tips"
                />

                <Stack direction="row" spacing={2}>
                  <FormSubmitButton loading={loading}>
                    Submit Form
                  </FormSubmitButton>
                  <FormResetButton>
                    Reset Form
                  </FormResetButton>
                </Stack>
              </Stack>
            </Form>

            {/* Form Data Display */}
            {formData && (
              <Box sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
                <Typography variant="h6" gutterBottom>
                  Submitted Data:
                </Typography>
                <pre style={{ fontSize: '0.875rem', overflow: 'auto' }}>
                  {JSON.stringify(formData, null, 2)}
                </pre>
              </Box>
            )}
          </CardContent>
        </Card>

        {/* Authentication Forms */}
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={4}>
          {/* Login Form */}
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Login Form Template
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Pre-built login form with social authentication options.
              </Typography>

              <LoginForm
                onSubmit={handleLogin}
                onForgotPassword={() => alert('Forgot password clicked')}
                onSignUp={() => alert('Sign up clicked')}
                onSocialLogin={(provider) => alert(`${provider} login clicked`)}
                autoSave
              />
            </CardContent>
          </Card>

          {/* Register Form */}
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Registration Form Template
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Pre-built registration form with validation and progress tracking.
              </Typography>

              <RegisterForm
                onSubmit={handleRegister}
                onSignIn={() => alert('Sign in clicked')}
                onSocialLogin={(provider) => alert(`${provider} signup clicked`)}
                autoSave
              />
            </CardContent>
          </Card>
        </Stack>

        {/* Validation Examples */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Available Validation Schemas
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Pre-built validation schemas for common use cases:
            </Typography>

            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Authentication Schemas
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip label="Login" size="small" />
                  <Chip label="Register" size="small" />
                  <Chip label="Forgot Password" size="small" />
                  <Chip label="Reset Password" size="small" />
                  <Chip label="Change Password" size="small" />
                </Stack>
              </Box>

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  User Management Schemas
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip label="Profile" size="small" />
                  <Chip label="Preferences" size="small" />
                </Stack>
              </Box>

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  URL Management Schemas
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip label="Create URL" size="small" />
                  <Chip label="Update URL" size="small" />
                  <Chip label="Bulk Create" size="small" />
                </Stack>
              </Box>

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Contact & Feedback Schemas
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip label="Contact Form" size="small" />
                  <Chip label="Feedback" size="small" />
                </Stack>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
};