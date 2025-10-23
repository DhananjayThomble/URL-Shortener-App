'use client';

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  Tooltip,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogActions,
  Button,
  Chip,
} from '@mui/material';
import {
  QrCode,
  Download,
  Fullscreen,
  Close,
  ContentCopy,
  Share,
} from '@mui/icons-material';
import { QRCodeSVG } from 'qrcode.react';
import { QRCodeGenerator } from './QRCodeGenerator';
import toast from 'react-hot-toast';

interface QRCodePreviewProps {
  url: string;
  size?: number;
  showLabel?: boolean;
  showActions?: boolean;
  className?: string;
}

export const QRCodePreview: React.FC<QRCodePreviewProps> = ({
  url,
  size = 128,
  showLabel = true,
  showActions = true,
  className,
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  const handleQuickDownload = () => {
    // Create a temporary canvas to generate PNG
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const qrSize = 256;
    canvas.width = qrSize;
    canvas.height = qrSize;

    // Create SVG data URL
    const svgData = `
      <svg width="${qrSize}" height="${qrSize}" xmlns="http://www.w3.org/2000/svg">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml">
            ${document.querySelector('.qr-preview-svg')?.outerHTML || ''}
          </div>
        </foreignObject>
      </svg>
    `;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `qrcode-${Date.now()}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          toast.success('QR code downloaded');
        }
      });
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('URL copied to clipboard');
    } catch (error) {
      toast.error('Failed to copy URL');
    }
  };

  return (
    <>
      <Card className={className} sx={{ display: 'inline-block' }}>
        <CardContent sx={{ p: 2, textAlign: 'center' }}>
          {/* QR Code */}
          <Box
            sx={{
              display: 'inline-block',
              p: 1,
              bgcolor: 'background.paper',
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
              cursor: 'pointer',
            }}
            onClick={handleOpenDialog}
          >
            <QRCodeSVG
              className="qr-preview-svg"
              value={url}
              size={size}
              bgColor="#FFFFFF"
              fgColor="#000000"
              level="M"
              includeMargin={true}
            />
          </Box>

          {/* Label */}
          {showLabel && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              QR Code
            </Typography>
          )}

          {/* Quick Actions */}
          {showActions && (
            <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center', gap: 0.5 }}>
              <Tooltip title="View full size">
                <IconButton size="small" onClick={handleOpenDialog}>
                  <Fullscreen fontSize="small" />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="Quick download">
                <IconButton size="small" onClick={handleQuickDownload}>
                  <Download fontSize="small" />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="Copy URL">
                <IconButton size="small" onClick={handleCopyUrl}>
                  <ContentCopy fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Full QR Code Dialog */}
      <Dialog
        open={isDialogOpen}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <QrCode />
          QR Code Generator
          <Chip label="Interactive" size="small" color="primary" sx={{ ml: 'auto' }} />
        </DialogTitle>
        
        <DialogContent>
          <QRCodeGenerator
            url={url}
            defaultSize={256}
            showCustomization={true}
          />
        </DialogContent>
        
        <DialogActions>
          <Button onClick={handleCloseDialog} startIcon={<Close />}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};