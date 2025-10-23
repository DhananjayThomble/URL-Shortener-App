'use client';

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  IconButton,
  Tooltip,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
} from '@mui/material';
import {
  Share,
  ContentCopy,
  Email,
  Facebook,
  Twitter,
  LinkedIn,
  WhatsApp,
  Telegram,
  Download,
  Link as LinkIcon,
  QrCode,
} from '@mui/icons-material';
import { QRCodePreview } from './QRCodePreview';
import toast from 'react-hot-toast';

interface QRCodeShareProps {
  url: string;
  title?: string;
  description?: string;
  onShare?: (platform: string) => void;
  className?: string;
}

interface SharePlatform {
  name: string;
  icon: React.ReactNode;
  color: string;
  getUrl: (url: string, title: string, description: string) => string;
}

const sharePlatforms: SharePlatform[] = [
  {
    name: 'Facebook',
    icon: <Facebook />,
    color: '#1877f2',
    getUrl: (url, title) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(title)}`,
  },
  {
    name: 'Twitter',
    icon: <Twitter />,
    color: '#1da1f2',
    getUrl: (url, title) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  },
  {
    name: 'LinkedIn',
    icon: <LinkedIn />,
    color: '#0077b5',
    getUrl: (url, title, description) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&summary=${encodeURIComponent(description)}`,
  },
  {
    name: 'WhatsApp',
    icon: <WhatsApp />,
    color: '#25d366',
    getUrl: (url, title) => `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
  },
  {
    name: 'Telegram',
    icon: <Telegram />,
    color: '#0088cc',
    getUrl: (url, title) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  },
];

export const QRCodeShare: React.FC<QRCodeShareProps> = ({
  url,
  title = 'Check out this link',
  description = 'Shared via QR code',
  onShare,
  className,
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [shareMethod, setShareMethod] = useState<'qr' | 'link' | 'email'>('qr');
  const [emailData, setEmailData] = useState({
    to: '',
    subject: title,
    body: `${description}\n\n${url}`,
  });

  const handlePlatformShare = (platform: SharePlatform) => {
    const shareUrl = platform.getUrl(url, title, description);
    window.open(shareUrl, '_blank', 'width=600,height=400');
    
    if (onShare) {
      onShare(platform.name);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: description,
          url,
        });
        
        if (onShare) {
          onShare('native');
        }
      } catch (error) {
        console.error('Share failed:', error);
      }
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('URL copied to clipboard');
      
      if (onShare) {
        onShare('copy');
      }
    } catch (error) {
      toast.error('Failed to copy URL');
    }
  };

  const handleEmailShare = () => {
    const mailtoUrl = `mailto:${emailData.to}?subject=${encodeURIComponent(emailData.subject)}&body=${encodeURIComponent(emailData.body)}`;
    window.location.href = mailtoUrl;
    
    if (onShare) {
      onShare('email');
    }
    
    setIsDialogOpen(false);
  };

  const generateQRCodeWithLogo = () => {
    // This could be enhanced to include a custom logo
    return url;
  };

  return (
    <>
      <Card className={className}>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" component="h3" fontWeight="bold">
              Share QR Code
            </Typography>
            <Button
              variant="outlined"
              startIcon={<Share />}
              onClick={() => setIsDialogOpen(true)}
            >
              More Options
            </Button>
          </Box>

          {/* QR Code Preview */}
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <QRCodePreview
              url={url}
              size={200}
              showLabel={true}
              showActions={true}
            />
          </Box>

          {/* Quick Share Actions */}
          <Stack spacing={2}>
            <Typography variant="subtitle2" gutterBottom>
              Quick Share
            </Typography>
            
            <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center">
              {navigator.share && (
                <Button
                  variant="outlined"
                  startIcon={<Share />}
                  onClick={handleNativeShare}
                  size="small"
                >
                  Share
                </Button>
              )}
              
              <Button
                variant="outlined"
                startIcon={<ContentCopy />}
                onClick={handleCopyUrl}
                size="small"
              >
                Copy URL
              </Button>

              {sharePlatforms.slice(0, 3).map((platform) => (
                <Tooltip key={platform.name} title={`Share on ${platform.name}`}>
                  <IconButton
                    onClick={() => handlePlatformShare(platform)}
                    sx={{ 
                      color: platform.color,
                      '&:hover': { bgcolor: `${platform.color}20` }
                    }}
                  >
                    {platform.icon}
                  </IconButton>
                </Tooltip>
              ))}
            </Stack>
          </Stack>

          {/* URL Info */}
          <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary" gutterBottom display="block">
              Sharing URL:
            </Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {url}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Advanced Share Dialog */}
      <Dialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Share Options
        </DialogTitle>
        
        <DialogContent>
          <Box sx={{ mb: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Share Method</InputLabel>
              <Select
                value={shareMethod}
                label="Share Method"
                onChange={(e) => setShareMethod(e.target.value as any)}
              >
                <MenuItem value="qr">QR Code</MenuItem>
                <MenuItem value="link">Direct Link</MenuItem>
                <MenuItem value="email">Email</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {shareMethod === 'qr' && (
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h6" gutterBottom>
                QR Code Sharing
              </Typography>
              <QRCodePreview
                url={url}
                size={256}
                showLabel={false}
                showActions={true}
              />
              <Alert severity="info" sx={{ mt: 2 }}>
                Users can scan this QR code with their phone camera to visit your link instantly.
              </Alert>
            </Box>
          )}

          {shareMethod === 'link' && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Social Media Sharing
              </Typography>
              
              <Box sx={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 2,
                mb: 3
              }}>
                {sharePlatforms.map((platform) => (
                  <Button
                    key={platform.name}
                    variant="outlined"
                    startIcon={platform.icon}
                    onClick={() => handlePlatformShare(platform)}
                    sx={{ 
                      color: platform.color,
                      borderColor: platform.color,
                      '&:hover': { 
                        bgcolor: `${platform.color}20`,
                        borderColor: platform.color,
                      }
                    }}
                  >
                    {platform.name}
                  </Button>
                ))}
              </Box>

              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="body2" gutterBottom>
                  <strong>Share Text:</strong>
                </Typography>
                <Typography variant="body2">
                  {title}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <strong>URL:</strong> {url}
                </Typography>
              </Box>
            </Box>
          )}

          {shareMethod === 'email' && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Email Sharing
              </Typography>
              
              <Stack spacing={2}>
                <TextField
                  label="To (Email Address)"
                  value={emailData.to}
                  onChange={(e) => setEmailData(prev => ({ ...prev, to: e.target.value }))}
                  fullWidth
                  size="small"
                />
                
                <TextField
                  label="Subject"
                  value={emailData.subject}
                  onChange={(e) => setEmailData(prev => ({ ...prev, subject: e.target.value }))}
                  fullWidth
                  size="small"
                />
                
                <TextField
                  label="Message"
                  value={emailData.body}
                  onChange={(e) => setEmailData(prev => ({ ...prev, body: e.target.value }))}
                  multiline
                  rows={4}
                  fullWidth
                  size="small"
                />
                
                <Button
                  variant="contained"
                  startIcon={<Email />}
                  onClick={handleEmailShare}
                  disabled={!emailData.to}
                >
                  Send Email
                </Button>
              </Stack>
            </Box>
          )}
        </DialogContent>
        
        <DialogActions>
          <Button onClick={() => setIsDialogOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};