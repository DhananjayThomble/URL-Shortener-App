'use client';

import React, { useState, useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  TextField,
  Switch,
  FormControlLabel,
  Divider,
  Alert,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  Download,
  ContentCopy,
  Share,
  Palette,
  Settings,
  QrCode,
  Refresh,
} from '@mui/icons-material';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import toast from 'react-hot-toast';

interface QRCodeGeneratorProps {
  url: string;
  defaultSize?: number;
  showCustomization?: boolean;
  onDownload?: (format: string, blob: Blob) => void;
  className?: string;
}

interface QRCodeStyle {
  size: number;
  bgColor: string;
  fgColor: string;
  level: 'L' | 'M' | 'Q' | 'H';
  includeMargin: boolean;
  imageSettings?: {
    src: string;
    height: number;
    width: number;
    excavate: boolean;
  };
}

const defaultStyle: QRCodeStyle = {
  size: 256,
  bgColor: '#FFFFFF',
  fgColor: '#000000',
  level: 'M',
  includeMargin: true,
};

export const QRCodeGenerator: React.FC<QRCodeGeneratorProps> = ({
  url,
  defaultSize = 256,
  showCustomization = true,
  onDownload,
  className,
}) => {
  const [style, setStyle] = useState<QRCodeStyle>({
    ...defaultStyle,
    size: defaultSize,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleStyleChange = (key: keyof QRCodeStyle, value: any) => {
    setStyle(prev => ({ ...prev, [key]: value }));
  };

  const handleDownload = async (format: 'png' | 'svg' | 'pdf') => {
    try {
      let blob: Blob;
      
      switch (format) {
        case 'png':
          blob = await downloadAsPNG();
          break;
        case 'svg':
          blob = await downloadAsSVG();
          break;
        case 'pdf':
          blob = await downloadAsPDF();
          break;
        default:
          throw new Error('Unsupported format');
      }

      // Create download link
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `qrcode-${Date.now()}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

      if (onDownload) {
        onDownload(format, blob);
      }

      toast.success(`QR code downloaded as ${format.toUpperCase()}`);
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Failed to download QR code');
    }
  };

  const downloadAsPNG = async (): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        reject(new Error('Canvas not found'));
        return;
      }

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create PNG blob'));
        }
      }, 'image/png');
    });
  };

  const downloadAsSVG = async (): Promise<Blob> => {
    const svg = svgRef.current;
    if (!svg) {
      throw new Error('SVG not found');
    }

    const svgData = new XMLSerializer().serializeToString(svg);
    return new Blob([svgData], { type: 'image/svg+xml' });
  };

  const downloadAsPDF = async (): Promise<Blob> => {
    // For PDF generation, we'll use the canvas approach
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error('Canvas not found');
    }

    // Create a simple PDF-like structure (this is a basic implementation)
    const imgData = canvas.toDataURL('image/png');
    
    // Create HTML content for PDF
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR Code</title>
        <style>
          body { margin: 0; padding: 20px; text-align: center; }
          img { max-width: 100%; height: auto; }
          .info { margin-top: 20px; font-family: Arial, sans-serif; }
        </style>
      </head>
      <body>
        <h2>QR Code</h2>
        <img src="${imgData}" alt="QR Code" />
        <div class="info">
          <p>URL: ${url}</p>
          <p>Generated on: ${new Date().toLocaleDateString()}</p>
        </div>
      </body>
      </html>
    `;

    return new Blob([htmlContent], { type: 'text/html' });
  };

  const handleCopyToClipboard = async () => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error('Canvas not found');
      }

      canvas.toBlob(async (blob) => {
        if (blob) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          toast.success('QR code copied to clipboard');
        }
      });
    } catch (error) {
      console.error('Copy failed:', error);
      toast.error('Failed to copy QR code');
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error('Canvas not found');
        }

        canvas.toBlob(async (blob) => {
          if (blob) {
            const file = new File([blob], 'qrcode.png', { type: 'image/png' });
            await navigator.share({
              title: 'QR Code',
              text: `QR Code for: ${url}`,
              files: [file],
            });
          }
        });
      } catch (error) {
        console.error('Share failed:', error);
        toast.error('Failed to share QR code');
      }
    } else {
      toast.error('Sharing not supported on this device');
    }
  };

  const presetStyles = [
    { name: 'Classic', fgColor: '#000000', bgColor: '#FFFFFF' },
    { name: 'Blue', fgColor: '#1976d2', bgColor: '#FFFFFF' },
    { name: 'Green', fgColor: '#388e3c', bgColor: '#FFFFFF' },
    { name: 'Red', fgColor: '#d32f2f', bgColor: '#FFFFFF' },
    { name: 'Dark', fgColor: '#FFFFFF', bgColor: '#212121' },
    { name: 'Purple', fgColor: '#7b1fa2', bgColor: '#FFFFFF' },
  ];

  return (
    <Card className={className}>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6" component="h3" fontWeight="bold">
            QR Code Generator
          </Typography>
          <Tooltip title="Generate new QR code">
            <IconButton onClick={() => setStyle({ ...style })}>
              <Refresh />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
          {/* QR Code Preview */}
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="subtitle2" gutterBottom>
              Preview
            </Typography>
            
            <Box sx={{ 
              display: 'inline-block', 
              p: 2, 
              bgcolor: style.bgColor,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider'
            }}>
              {/* Canvas version for downloads */}
              <QRCodeCanvas
                ref={canvasRef}
                value={url}
                size={style.size}
                bgColor={style.bgColor}
                fgColor={style.fgColor}
                level={style.level}
                includeMargin={style.includeMargin}
                style={{ display: 'none' }}
              />
              
              {/* SVG version for display */}
              <QRCodeSVG
                ref={svgRef}
                value={url}
                size={Math.min(style.size, 300)}
                bgColor={style.bgColor}
                fgColor={style.fgColor}
                level={style.level}
                includeMargin={style.includeMargin}
              />
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {style.size} × {style.size} pixels
            </Typography>
          </Box>

          {/* Customization Panel */}
          {showCustomization && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Customization
              </Typography>

              <Stack spacing={3}>
                {/* Size */}
                <Box>
                  <Typography variant="body2" gutterBottom>
                    Size: {style.size}px
                  </Typography>
                  <Slider
                    value={style.size}
                    onChange={(_, value) => handleStyleChange('size', value)}
                    min={128}
                    max={512}
                    step={32}
                    marks={[
                      { value: 128, label: '128' },
                      { value: 256, label: '256' },
                      { value: 512, label: '512' },
                    ]}
                  />
                </Box>

                {/* Error Correction Level */}
                <FormControl size="small" fullWidth>
                  <InputLabel>Error Correction</InputLabel>
                  <Select
                    value={style.level}
                    label="Error Correction"
                    onChange={(e) => handleStyleChange('level', e.target.value)}
                  >
                    <MenuItem value="L">Low (7%)</MenuItem>
                    <MenuItem value="M">Medium (15%)</MenuItem>
                    <MenuItem value="Q">Quartile (25%)</MenuItem>
                    <MenuItem value="H">High (30%)</MenuItem>
                  </Select>
                </FormControl>

                {/* Color Presets */}
                <Box>
                  <Typography variant="body2" gutterBottom>
                    Color Presets
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {presetStyles.map((preset) => (
                      <Tooltip key={preset.name} title={preset.name}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => {
                            handleStyleChange('fgColor', preset.fgColor);
                            handleStyleChange('bgColor', preset.bgColor);
                          }}
                          sx={{
                            minWidth: 40,
                            height: 40,
                            bgcolor: preset.bgColor,
                            border: 2,
                            borderColor: preset.fgColor,
                            '&:hover': {
                              bgcolor: preset.bgColor,
                              opacity: 0.8,
                            },
                          }}
                        >
                          <Box
                            sx={{
                              width: 16,
                              height: 16,
                              bgcolor: preset.fgColor,
                              borderRadius: 0.5,
                            }}
                          />
                        </Button>
                      </Tooltip>
                    ))}
                  </Box>
                </Box>

                {/* Advanced Settings */}
                <Box>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={showAdvanced}
                        onChange={(e) => setShowAdvanced(e.target.checked)}
                      />
                    }
                    label="Advanced Settings"
                  />
                </Box>

                {showAdvanced && (
                  <Stack spacing={2}>
                    <Divider />
                    
                    {/* Custom Colors */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                      <TextField
                        label="Foreground Color"
                        type="color"
                        value={style.fgColor}
                        onChange={(e) => handleStyleChange('fgColor', e.target.value)}
                        size="small"
                      />
                      <TextField
                        label="Background Color"
                        type="color"
                        value={style.bgColor}
                        onChange={(e) => handleStyleChange('bgColor', e.target.value)}
                        size="small"
                      />
                    </Box>

                    {/* Include Margin */}
                    <FormControlLabel
                      control={
                        <Switch
                          checked={style.includeMargin}
                          onChange={(e) => handleStyleChange('includeMargin', e.target.checked)}
                        />
                      }
                      label="Include Margin"
                    />
                  </Stack>
                )}
              </Stack>
            </Box>
          )}
        </Box>

        {/* Actions */}
        <Box sx={{ mt: 3 }}>
          <Divider sx={{ mb: 2 }} />
          
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              variant="contained"
              startIcon={<Download />}
              onClick={() => handleDownload('png')}
            >
              Download PNG
            </Button>
            
            <Button
              variant="outlined"
              startIcon={<Download />}
              onClick={() => handleDownload('svg')}
            >
              SVG
            </Button>
            
            <Button
              variant="outlined"
              startIcon={<ContentCopy />}
              onClick={handleCopyToClipboard}
            >
              Copy
            </Button>
            
            {navigator.share && (
              <Button
                variant="outlined"
                startIcon={<Share />}
                onClick={handleShare}
              >
                Share
              </Button>
            )}
          </Stack>

          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="body2">
              This QR code links to: <strong>{url}</strong>
            </Typography>
          </Alert>
        </Box>
      </CardContent>
    </Card>
  );
};