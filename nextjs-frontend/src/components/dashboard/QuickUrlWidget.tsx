'use client';

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Stack,
  IconButton,
  Tooltip,
  Chip,
  Collapse,
  Alert,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Add,
  Link as LinkIcon,
  ExpandMore,
  ExpandLess,
  ContentCopy,
  QrCode,
  Analytics,
  Refresh,
} from '@mui/icons-material';
import { useUrls } from '@/hooks/useUrls';
import { QRCodePreview } from '@/components/qr';
import toast from 'react-hot-toast';
import type { CreateURLData, URLData } from '@/types';

interface QuickUrlWidgetProps {
  onSuccess?: (url: URLData) => void;
  showAdvanced?: boolean;
  compact?: boolean;
  className?: string;
}

const categories = [
  'Business',
  'Personal',
  'Marketing',
  'Social Media',
  'Education',
  'Technology',
  'Other',
];

export const QuickUrlWidget: React.FC<QuickUrlWidgetProps> = ({
  onSuccess,
  showAdvanced = false,
  compact = false,
  className,
}) => {
  const { createUrl, isCreating } = useUrls();
  
  const [url, setUrl] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [category, setCategory] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<URLData | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      setError('Please enter a valid URL');
      return;
    }

    setError('');

    const urlData: CreateURLData = {
      originalUrl: url,
      customBackHalf: customCode || undefined,
      category: category || undefined,
    };

    try {
      const result = await createUrl(urlData);
      setCreatedUrl(result);
      onSuccess?.(result);
      
      // Reset form
      setUrl('');
      setCustomCode('');
      setCategory('');
      setShowOptions(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create URL');
    }
  };

  const handleCopy = async () => {
    if (!createdUrl) return;
    
    const shortUrl = `${window.location.origin}/${createdUrl.shortCode}`;
    try {
      await navigator.clipboard.writeText(shortUrl);
      toast.success('URL copied to clipboard');
    } catch (error) {
      toast.error('Failed to copy URL');
    }
  };

  const handleReset = () => {
    setCreatedUrl(null);
    setError('');
  };

  // Success view
  if (createdUrl) {
    const shortUrl = `${window.location.origin}/${createdUrl.shortCode}`;
    
    return (
      <Card className={className}>
        <CardContent sx={{ p: compact ? 2 : 3 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant={compact ? 'h6' : 'h5'} gutterBottom>
              URL Created Successfully! 🎉
            </Typography>
            
            <Box sx={{ 
              p: 2, 
              bgcolor: 'action.hover', 
              borderRadius: 1, 
              mb: 2,
              border: 1,
              borderColor: 'success.main'
            }}>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                Your shortened URL:
              </Typography>
              <Typography 
                variant="body1" 
                fontFamily="monospace" 
                color="primary.main"
                fontWeight="bold"
                sx={{ wordBreak: 'break-all' }}
              >
                {shortUrl}
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap">
              <Button
                variant="contained"
                size="small"
                startIcon={<ContentCopy />}
                onClick={handleCopy}
              >
                Copy
              </Button>
              
              <Button
                variant="outlined"
                size="small"
                startIcon={<QrCode />}
              >
                QR Code
              </Button>
              
              <Button
                variant="outlined"
                size="small"
                startIcon={<Analytics />}
              >
                Analytics
              </Button>
            </Stack>

            <Button
              variant="text"
              size="small"
              startIcon={<Add />}
              onClick={handleReset}
              sx={{ mt: 2 }}
            >
              Create Another
            </Button>
          </Box>
        </CardContent>
      </Card>
    );
  }

  // Form view
  return (
    <Card className={className}>
      <CardContent sx={{ p: compact ? 2 : 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant={compact ? 'subtitle1' : 'h6'} fontWeight="bold">
            Quick URL Shortener
          </Typography>
          
          {showAdvanced && (
            <Tooltip title={showOptions ? 'Hide options' : 'Show options'}>
              <IconButton size="small" onClick={() => setShowOptions(!showOptions)}>
                {showOptions ? <ExpandLess /> : <ExpandMore />}
              </IconButton>
            </Tooltip>
          )}
        </Box>

        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            {/* Main URL Input */}
            <TextField
              label="Enter URL to shorten"
              placeholder="https://example.com/very-long-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              error={!!error}
              helperText={error || 'Paste any long URL here'}
              fullWidth
              size={compact ? 'small' : 'medium'}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <LinkIcon />
                  </InputAdornment>
                ),
              }}
            />

            {/* Advanced Options */}
            {showAdvanced && (
              <Collapse in={showOptions}>
                <Stack spacing={2} sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <TextField
                    label="Custom Code (Optional)"
                    placeholder="my-custom-link"
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value)}
                    size="small"
                    fullWidth
                    helperText="Leave empty for auto-generated code"
                  />
                  
                  <FormControl size="small" fullWidth>
                    <InputLabel>Category</InputLabel>
                    <Select
                      value={category}
                      label="Category"
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <MenuItem value="">No Category</MenuItem>
                      {categories.map((cat) => (
                        <MenuItem key={cat} value={cat.toLowerCase()}>
                          {cat}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
              </Collapse>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              variant="contained"
              size={compact ? 'medium' : 'large'}
              startIcon={<Add />}
              disabled={isCreating || !url.trim()}
              fullWidth
            >
              {isCreating ? 'Creating...' : 'Shorten URL'}
            </Button>
          </Stack>
        </form>

        {/* Info */}
        {!compact && (
          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="body2">
              Create short, trackable links with detailed analytics and QR codes.
            </Typography>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};