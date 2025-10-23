'use client';

import { useState, useCallback } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    TextField,
    Button,
    Stack,
    Alert,
    Chip,
    Collapse,
    InputAdornment,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
} from '@mui/material';
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
    Analytics,
    Share,
} from '@mui/icons-material';
import { useUrls } from '@/hooks/useUrls';
import { ValidationRules } from '@/lib/validation/rules';
import { QRCodePreview } from '@/components/qr';
import type { CreateURLData } from '@/types';

interface UrlShortenerProps {
    onSuccess?: (url: any) => void;
    showAdvanced?: boolean;
    compact?: boolean;
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
    'Other',
];

export function UrlShortener({
    onSuccess,
    showAdvanced = true,
    compact = false,
    categories = defaultCategories,
}: UrlShortenerProps) {
    const { createUrl, isCreating, error } = useUrls();

    const [formData, setFormData] = useState<CreateURLData>({
        originalUrl: '',
        customBackHalf: '',
        category: '',
        tags: [],
    });

    const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
    const [createdUrl, setCreatedUrl] = useState<any>(null);
    const [copied, setCopied] = useState(false);
    const [showQRCode, setShowQRCode] = useState(false);

    // Form validation
    const validateForm = useCallback(() => {
        const errors: Record<string, string> = {};

        // Validate original URL
        if (!formData.originalUrl) {
            errors.originalUrl = 'URL is required';
        } else {
            try {
                ValidationRules.url().parse(formData.originalUrl);
            } catch {
                errors.originalUrl = 'Please enter a valid URL';
            }
        }

        // Validate custom back half
        if (formData.customBackHalf) {
            if (!/^[a-zA-Z0-9-_]+$/.test(formData.customBackHalf)) {
                errors.customBackHalf = 'Only letters, numbers, hyphens, and underscores allowed';
            } else if (formData.customBackHalf.length < 3) {
                errors.customBackHalf = 'Must be at least 3 characters long';
            }
        }

        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formData]);

    // Handle form submission
    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!validateForm()) {
            return;
        }

        try {
            const result = await createUrl(formData);
            setCreatedUrl(result);
            onSuccess?.(result);
        } catch (err) {
            console.error('Failed to create URL:', err);
        }
    };

    // Handle input changes
    const handleInputChange = (field: keyof CreateURLData) => (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        setFormData(prev => ({
            ...prev,
            [field]: event.target.value,
        }));

        // Clear validation error for this field
        if (validationErrors[field]) {
            setValidationErrors(prev => ({
                ...prev,
                [field]: '',
            }));
        }
    };

    // Handle copy URL
    const handleCopyUrl = async () => {
        if (!createdUrl?.shortCode) return;

        try {
            const shortUrl = `${window.location.origin}/${createdUrl.shortCode}`;
            await navigator.clipboard.writeText(shortUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error('Failed to copy URL:', error);
        }
    };

    // Reset form
    const resetForm = () => {
        setFormData({
            originalUrl: '',
            customBackHalf: '',
            category: '',
            tags: [],
        });
        setValidationErrors({});
        setCreatedUrl(null);
        setCopied(false);
    };

    // Success view
    if (createdUrl) {
        const shortUrl = `${window.location.origin}/${createdUrl.shortCode}`;

        return (
            <Card sx={{ maxWidth: 600, mx: 'auto' }}>
                <CardContent sx={{ textAlign: 'center', p: 4 }}>
                    <Box sx={{ mb: 3 }}>
                        <LinkIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
                        <Typography variant="h5" gutterBottom>
                            URL Shortened Successfully!
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Your shortened URL is ready to use and share.
                        </Typography>
                    </Box>

                    <Box
                        sx={{
                            p: 3,
                            border: 1,
                            borderColor: 'divider',
                            borderRadius: 2,
                            backgroundColor: 'background.paper',
                            mb: 3,
                        }}
                    >
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            Your shortened URL:
                        </Typography>
                        <Typography
                            variant="h6"
                            sx={{
                                wordBreak: 'break-all',
                                color: 'primary.main',
                                mb: 2,
                                fontFamily: 'monospace',
                            }}
                        >
                            {shortUrl}
                        </Typography>

                        <Stack direction="row" spacing={2} justifyContent="center" flexWrap="wrap">
                            <Button
                                variant="contained"
                                startIcon={<ContentCopy />}
                                onClick={handleCopyUrl}
                                color={copied ? 'success' : 'primary'}
                            >
                                {copied ? 'Copied!' : 'Copy URL'}
                            </Button>

                            <Button
                                variant="outlined"
                                startIcon={<QrCode />}
                                onClick={() => setShowQRCode(true)}
                            >
                                QR Code
                            </Button>

                            <Button
                                variant="outlined"
                                startIcon={<Analytics />}
                                onClick={() => {
                                    // TODO: Navigate to analytics
                                    alert('Analytics coming soon!');
                                }}
                            >
                                View Analytics
                            </Button>
                        </Stack>
                    </Box>

                    <Stack direction="row" spacing={2} justifyContent="center">
                        <Button variant="outlined" onClick={resetForm}>
                            Shorten Another URL
                        </Button>
                        <Button
                            variant="text"
                            startIcon={<Share />}
                            onClick={() => {
                                if (navigator.share) {
                                    navigator.share({
                                        title: 'Shortened URL',
                                        url: shortUrl,
                                    });
                                }
                            }}
                        >
                            Share
                        </Button>
                    </Stack>
                </CardContent>
            </Card>
        );
    }

    // Form view
    return (
        <Card sx={{ maxWidth: compact ? 400 : 600, mx: 'auto' }}>
            <CardContent sx={{ p: compact ? 2 : 4 }}>
                {!compact && (
                    <Box sx={{ textAlign: 'center', mb: 4 }}>
                        <Typography variant="h4" component="h1" gutterBottom>
                            Shorten Your URL
                        </Typography>
                        <Typography variant="body1" color="text.secondary">
                            Transform long URLs into short, shareable links with analytics
                        </Typography>
                    </Box>
                )}

                <form onSubmit={handleSubmit}>
                    <Stack spacing={3}>
                        {/* Main URL Input */}
                        <TextField
                            label="Original URL"
                            placeholder="https://example.com/very-long-url-that-needs-shortening"
                            value={formData.originalUrl}
                            onChange={handleInputChange('originalUrl')}
                            error={!!validationErrors.originalUrl}
                            helperText={validationErrors.originalUrl || 'Enter the URL you want to shorten'}
                            required
                            fullWidth
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <LinkIcon />
                                    </InputAdornment>
                                ),
                            }}
                        />

                        {/* Custom Back Half */}
                        <TextField
                            label="Custom Short Code (Optional)"
                            placeholder="my-custom-link"
                            value={formData.customBackHalf}
                            onChange={handleInputChange('customBackHalf')}
                            error={!!validationErrors.customBackHalf}
                            helperText={
                                validationErrors.customBackHalf ||
                                'Leave empty for auto-generated code. Only letters, numbers, and hyphens allowed.'
                            }
                            fullWidth
                        />

                        {/* Advanced Options */}
                        {showAdvanced && (
                            <Box>
                                <Button
                                    onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                                    startIcon={showAdvancedOptions ? <ExpandLess /> : <ExpandMore />}
                                    sx={{ mb: 2 }}
                                >
                                    Advanced Options
                                </Button>

                                <Collapse in={showAdvancedOptions}>
                                    <Box
                                        sx={{
                                            p: 2,
                                            backgroundColor: 'action.hover',
                                            borderRadius: 1,
                                        }}
                                    >
                                        <Stack spacing={3}>
                                            {/* Category Selection */}
                                            <TextField
                                                select
                                                label="Category (Optional)"
                                                value={formData.category}
                                                onChange={handleInputChange('category')}
                                                SelectProps={{ native: true }}
                                                fullWidth
                                            >
                                                <option value="">Select a category</option>
                                                {categories.map(category => (
                                                    <option key={category} value={category.toLowerCase()}>
                                                        {category}
                                                    </option>
                                                ))}
                                            </TextField>

                                            {/* Privacy Settings Preview */}
                                            <Box>
                                                <Typography variant="body2" gutterBottom>
                                                    Privacy Settings
                                                </Typography>
                                                <Stack direction="row" spacing={1} flexWrap="wrap">
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
                                    </Box>
                                </Collapse>
                            </Box>
                        )}

                        {/* Error Display */}
                        {error && (
                            <Alert severity="error">
                                {error}
                            </Alert>
                        )}

                        {/* Info Alert */}
                        {!compact && (
                            <Alert severity="info">
                                <Typography variant="body2" gutterBottom>
                                    <strong>What you get:</strong>
                                </Typography>
                                <Typography variant="caption" component="div">
                                    • Detailed click analytics and statistics
                                    <br />
                                    • QR code generation for easy sharing
                                    <br />
                                    • Custom branded short links
                                    <br />• Link management and editing tools
                                </Typography>
                            </Alert>
                        )}

                        {/* Action Buttons */}
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                            <Button
                                type="submit"
                                variant="contained"
                                size="large"
                                startIcon={<Add />}
                                disabled={isCreating}
                                fullWidth
                            >
                                {isCreating ? 'Shortening...' : 'Shorten URL'}
                            </Button>

                            <Button
                                type="button"
                                variant="outlined"
                                size="large"
                                onClick={resetForm}
                                sx={{ minWidth: { sm: 120 } }}
                            >
                                Clear
                            </Button>
                        </Stack>
                    </Stack>
                </form>

                {/* QR Code Dialog */}
                <Dialog
                    open={showQRCode}
                    onClose={() => setShowQRCode(false)}
                    maxWidth="sm"
                    fullWidth
                >
                    <DialogTitle>
                        QR Code for Your Shortened URL
                    </DialogTitle>
                    <DialogContent>
                        {createdUrl && (
                            <QRCodePreview
                                url={`${window.location.origin}/${createdUrl.shortCode}`}
                                size={256}
                                showLabel={false}
                                showActions={false}
                            />
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setShowQRCode(false)}>
                            Close
                        </Button>
                    </DialogActions>
                </Dialog>
            </CardContent>
        </Card>
    );
}

export default UrlShortener;