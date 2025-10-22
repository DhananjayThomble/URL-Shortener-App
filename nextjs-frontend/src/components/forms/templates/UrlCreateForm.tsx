'use client';

import { useState } from 'react';
import { Stack, Box, Typography, Alert, Chip, Collapse, IconButton } from '@mui/material';
import { 
  Link as LinkIcon, 
  ContentCopy, 
  QrCode, 
  ExpandMore, 
  ExpandLess,
  Add,
  Schedule,
  Lock,
  Public,
  Category
} from '@mui/icons-material';
import { Form, FormInput, FormSelect, FormSubmitButton, FormResetButton } from '../';
import { Button } from '@/components/ui';
import { UrlSchemas, type CreateUrlFormData } from '@/lib/validation/schemas';
import type { SelectOption } from '@/components/ui';

export interface UrlCreateFormProps {
  onSubmit: (data: CreateUrlFormData) => Promise<{ shortUrl: string; qrCode?: string }>;
  loading?: boolean;
  error?: string;
  success?: { shortUrl: string; qrCode?: string } | null;
  showAdvanced?: boolean;
  autoSave?: boolean;
  categories?: string[];
}

const defaultCategories = [
  'Business',
  'Personal', 
  'Social Media',
  'Marketing',
  'Education',
  'Technology',
  'Entertainment',
  'News',
  'Other'
];

export const UrlCreateForm: React.FC<UrlCreateFormProps> = ({
  onSubmit,
  loading = false,
  error,
  success,
  showAdvanced = true,
  autoSave = false,
  categories = defaultCategories,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [copied, setCopied] = useState(false);

  const categoryOptions: SelectOption[] = categories.map(category => ({
    value: category.toLowerCase(),
    label: category,
    icon: <Category />,
  }));

  const handleSubmit = async (data: CreateUrlFormData) => {
    try {
      setIsSubmitting(true);
      await onSubmit(data);
    } catch (error) {
      console.error('URL creation error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!success?.shortUrl) return;
    
    try {
      await navigator.clipboard.writeText(success.shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
    }
  };

  if (success) {
    return (
      <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto', textAlign: 'center' }}>
        <Box sx={{ mb: 4 }}>
          <LinkIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom>
            URL Shortened Successfully!
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            Your shortened URL is ready to use and share.
          </Typography>
        </Box>

        <Box sx={{ 
          p: 3, 
          border: 1, 
          borderColor: 'divider', 
          borderRadius: 2, 
          backgroundColor: 'background.paper',
          mb: 3 
        }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Your shortened URL:
          </Typography>
          <Typography 
            variant="h6" 
            sx={{ 
              wordBreak: 'break-all', 
              color: 'primary.main',
              mb: 2 
            }}
          >
            {success.shortUrl}
          </Typography>
          
          <Stack direction="row" spacing={2} justifyContent="center">
            <Button
              variant="contained"
              icon={<ContentCopy />}
              onClick={handleCopyUrl}
              color={copied ? 'success' : 'primary'}
            >
              {copied ? 'Copied!' : 'Copy URL'}
            </Button>
            
            {success.qrCode && (
              <Button
                variant="outlined"
                icon={<QrCode />}
                onClick={() => window.open(success.qrCode, '_blank')}
              >
                View QR Code
              </Button>
            )}
          </Stack>
        </Box>

        <Button
          variant="outlined"
          onClick={() => window.location.reload()}
        >
          Shorten Another URL
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Shorten Your URL
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Transform long URLs into short, shareable links with analytics
        </Typography>
      </Box>

      <Form<CreateUrlFormData>
        schema={UrlSchemas.createUrl}
        onSubmit={handleSubmit}
        loading={loading || isSubmitting}
        error={error}
        autoSave={autoSave}
        defaultValues={{
          originalUrl: '',
          customSlug: '',
          title: '',
          description: '',
          category: '',
          tags: [],
          isPublic: true,
        }}
      >
        <Stack spacing={3}>
          {/* Main URL Input */}
          <FormInput
            name="originalUrl"
            label="Original URL"
            placeholder="https://example.com/very-long-url-that-needs-shortening"
            leftIcon={<LinkIcon />}
            required
            fullWidth
            helperText="Enter the URL you want to shorten"
          />

          {/* Custom Slug */}
          <FormInput
            name="customSlug"
            label="Custom Short Code (Optional)"
            placeholder="my-custom-link"
            fullWidth
            helperText="Leave empty for auto-generated code. Only letters, numbers, and hyphens allowed."
          />

          {/* Advanced Options Toggle */}
          {showAdvanced && (
            <Box>
              <IconButton
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 1, 
                  width: 'fit-content',
                  p: 1,
                  borderRadius: 1,
                }}
              >
                <Typography variant="body2" color="primary">
                  Advanced Options
                </Typography>
                {showAdvancedOptions ? <ExpandLess /> : <ExpandMore />}
              </IconButton>

              <Collapse in={showAdvancedOptions}>
                <Stack spacing={3} sx={{ mt: 2, p: 2, backgroundColor: 'action.hover', borderRadius: 1 }}>
                  <FormInput
                    name="title"
                    label="Title (Optional)"
                    placeholder="Give your link a memorable title"
                    fullWidth
                  />

                  <FormInput
                    name="description"
                    label="Description (Optional)"
                    placeholder="Describe what this link is about..."
                    multiline
                    rows={2}
                    fullWidth
                    characterLimit={500}
                    showCharacterCount
                  />

                  <FormSelect
                    name="category"
                    label="Category (Optional)"
                    options={categoryOptions}
                    placeholder="Select a category"
                    fullWidth
                  />

                  <Box>
                    <Typography variant="body2" gutterBottom>
                      Privacy Settings
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Chip
                        icon={<Public />}
                        label="Public"
                        color="primary"
                        variant="outlined"
                      />
                      <Chip
                        icon={<Lock />}
                        label="Password Protected"
                        variant="outlined"
                        disabled
                      />
                      <Chip
                        icon={<Schedule />}
                        label="Expiring"
                        variant="outlined"
                        disabled
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Advanced privacy options coming soon
                    </Typography>
                  </Box>
                </Stack>
              </Collapse>
            </Box>
          )}

          {/* Info Alert */}
          <Alert severity="info" sx={{ fontSize: '0.875rem' }}>
            <Typography variant="body2" gutterBottom>
              <strong>What you get:</strong>
            </Typography>
            <Typography variant="caption" component="div">
              • Detailed click analytics and statistics<br />
              • QR code generation for easy sharing<br />
              • Custom branded short links<br />
              • Link management and editing tools
            </Typography>
          </Alert>

          {/* Action Buttons */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormSubmitButton
              loading={loading || isSubmitting}
              fullWidth
              size="large"
              icon={<Add />}
            >
              Shorten URL
            </FormSubmitButton>

            <FormResetButton
              size="large"
              sx={{ minWidth: { sm: 120 } }}
            >
              Clear Form
            </FormResetButton>
          </Stack>
        </Stack>
      </Form>
    </Box>
  );
};