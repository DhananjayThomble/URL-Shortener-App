'use client';

import { useState } from 'react';
import { Stack, Box, Typography, Alert } from '@mui/material';
import { Send, Person, Email, Subject, Message } from '@mui/icons-material';
import { Form, FormInput, FormSelect, FormSubmitButton, FormResetButton } from '../';
import { ContactSchemas, type ContactFormData } from '@/lib/validation/schemas';
import type { SelectOption } from '@/components/ui';

export interface ContactFormProps {
  onSubmit: (data: ContactFormData) => Promise<void>;
  loading?: boolean;
  error?: string;
  success?: boolean;
  showReset?: boolean;
  autoSave?: boolean;
}

const categoryOptions: SelectOption[] = [
  { value: 'general', label: 'General Inquiry', icon: <Message /> },
  { value: 'support', label: 'Technical Support', icon: <Subject /> },
  { value: 'bug', label: 'Bug Report', icon: <Subject /> },
  { value: 'feature', label: 'Feature Request', icon: <Subject /> },
  { value: 'business', label: 'Business Inquiry', icon: <Subject /> },
];

export const ContactForm: React.FC<ContactFormProps> = ({
  onSubmit,
  loading = false,
  error,
  success = false,
  showReset = true,
  autoSave = true,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: ContactFormData) => {
    try {
      setIsSubmitting(true);
      await onSubmit(data);
    } catch (error) {
      console.error('Contact form error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', textAlign: 'center' }}>
        <Box sx={{ mb: 4 }}>
          <Send sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom>
            Message Sent Successfully
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            Thank you for contacting us! We've received your message and will 
            get back to you within 24 hours.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            For urgent matters, you can also reach us at support@snapurl.com
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Contact Us
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Have a question or need help? We'd love to hear from you.
        </Typography>
      </Box>

      <Form<ContactFormData>
        schema={ContactSchemas.contact}
        onSubmit={handleSubmit}
        loading={loading || isSubmitting}
        error={error}
        autoSave={autoSave}
        showProgress
        title="Get in Touch"
        subtitle="Fill out the form below and we'll get back to you as soon as possible."
        defaultValues={{
          name: '',
          email: '',
          subject: '',
          message: '',
          category: 'general',
        }}
      >
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
            />
          </Stack>

          <FormSelect
            name="category"
            label="Category"
            options={categoryOptions}
            placeholder="Select a category"
            required
            fullWidth
          />

          <FormInput
            name="subject"
            label="Subject"
            placeholder="Brief description of your inquiry"
            leftIcon={<Subject />}
            required
            fullWidth
          />

          <FormInput
            name="message"
            label="Message"
            placeholder="Please provide details about your inquiry..."
            multiline
            rows={6}
            required
            fullWidth
            characterLimit={1000}
            showCharacterCount
          />

          <Alert severity="info" sx={{ fontSize: '0.875rem' }}>
            We typically respond within 24 hours during business days. 
            For urgent technical issues, please include as much detail as possible.
          </Alert>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormSubmitButton
              loading={loading || isSubmitting}
              fullWidth
              size="large"
              icon={<Send />}
            >
              Send Message
            </FormSubmitButton>

            {showReset && (
              <FormResetButton
                size="large"
                sx={{ minWidth: { sm: 120 } }}
              >
                Reset Form
              </FormResetButton>
            )}
          </Stack>
        </Stack>
      </Form>
    </Box>
  );
};