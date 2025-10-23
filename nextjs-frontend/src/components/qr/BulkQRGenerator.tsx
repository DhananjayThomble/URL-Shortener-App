'use client';

import React, { useState, useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  LinearProgress,
  Alert,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Download,
  QrCode,
  CheckCircle,
  Error,
  Visibility,
  Delete,
  CloudDownload,
} from '@mui/icons-material';
import { QRCodeCanvas } from 'qrcode.react';
import JSZip from 'jszip';
import toast from 'react-hot-toast';
import type { URLData } from '@/types';

interface BulkQRGeneratorProps {
  urls: URLData[];
  onComplete?: (results: BulkGenerationResult[]) => void;
  className?: string;
}

interface BulkGenerationResult {
  url: URLData;
  status: 'pending' | 'generating' | 'success' | 'error';
  error?: string;
  blob?: Blob;
}

interface QRCodeSettings {
  size: number;
  format: 'png' | 'svg';
  quality: number;
  includeUrl: boolean;
}

const defaultSettings: QRCodeSettings = {
  size: 256,
  format: 'png',
  quality: 1,
  includeUrl: true,
};

export const BulkQRGenerator: React.FC<BulkQRGeneratorProps> = ({
  urls,
  onComplete,
  className,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BulkGenerationResult[]>([]);
  const [settings, setSettings] = useState<QRCodeSettings>(defaultSettings);
  const canvasRefs = useRef<{ [key: string]: HTMLCanvasElement }>({});

  const initializeResults = () => {
    return (urls || []).map(url => ({
      url,
      status: 'pending' as const,
    }));
  };

  const generateQRCode = async (url: URLData): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      canvas.width = settings.size;
      canvas.height = settings.includeUrl ? settings.size + 60 : settings.size;

      // Create QR code
      const qrCanvas = document.createElement('canvas');
      const qrCtx = qrCanvas.getContext('2d');
      
      if (!qrCtx) {
        reject(new Error('QR Canvas context not available'));
        return;
      }

      // Use QRCodeCanvas to generate the QR code
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'absolute';
      tempContainer.style.left = '-9999px';
      document.body.appendChild(tempContainer);

      const qrElement = document.createElement('canvas');
      tempContainer.appendChild(qrElement);

      // Generate QR code using qrcode.react logic
      import('qrcode').then(QRCode => {
        QRCode.toCanvas(qrElement, url.shortCode ? `${window.location.origin}/${url.shortCode}` : url.originalUrl, {
          width: settings.size,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        }, (error) => {
          document.body.removeChild(tempContainer);
          
          if (error) {
            reject(error);
            return;
          }

          // Draw QR code to main canvas
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(qrElement, 0, 0, settings.size, settings.size);

          // Add URL text if enabled
          if (settings.includeUrl) {
            ctx.fillStyle = '#000000';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            
            const shortUrl = url.shortCode ? `${window.location.origin}/${url.shortCode}` : url.originalUrl;
            const maxWidth = settings.size - 20;
            
            // Truncate URL if too long
            let displayUrl = shortUrl;
            if (ctx.measureText(displayUrl).width > maxWidth) {
              displayUrl = shortUrl.substring(0, 30) + '...';
            }
            
            ctx.fillText(displayUrl, settings.size / 2, settings.size + 20);
            
            // Add title if available
            if (url.originalUrl) {
              ctx.font = '10px Arial';
              ctx.fillStyle = '#666666';
              const title = url.originalUrl.length > 40 ? url.originalUrl.substring(0, 40) + '...' : url.originalUrl;
              ctx.fillText(title, settings.size / 2, settings.size + 40);
            }
          }

          // Convert to blob
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob'));
            }
          }, `image/${settings.format}`, settings.quality);
        });
      }).catch(reject);
    });
  };

  const handleGenerate = async () => {
    if (urls.length === 0) {
      toast.error('No URLs to generate QR codes for');
      return;
    }

    setIsGenerating(true);
    setProgress(0);
    
    const initialResults = initializeResults();
    setResults(initialResults);

    const updatedResults: BulkGenerationResult[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      
      try {
        // Update status to generating
        const generatingResults = [...updatedResults];
        generatingResults[i] = { url, status: 'generating' };
        setResults([...generatingResults, ...initialResults.slice(i + 1)]);

        // Generate QR code
        const blob = await generateQRCode(url);
        
        // Update status to success
        updatedResults[i] = { url, status: 'success', blob };
        
      } catch (error) {
        // Update status to error
        updatedResults[i] = { 
          url, 
          status: 'error', 
          error: error instanceof Error ? error.message : 'Unknown error' 
        };
      }

      // Update progress
      const progressPercent = ((i + 1) / urls.length) * 100;
      setProgress(progressPercent);
      
      // Update results
      setResults([...updatedResults, ...initialResults.slice(i + 1)]);
    }

    setIsGenerating(false);
    
    if (onComplete) {
      onComplete(updatedResults);
    }

    const successCount = updatedResults.filter(r => r.status === 'success').length;
    toast.success(`Generated ${successCount} QR codes successfully`);
  };

  const handleDownloadAll = async () => {
    const successResults = results.filter(r => r.status === 'success' && r.blob);
    
    if (successResults.length === 0) {
      toast.error('No QR codes to download');
      return;
    }

    try {
      const zip = new JSZip();
      
      successResults.forEach((result, index) => {
        if (result.blob) {
          const filename = result.url.shortCode 
            ? `qr-${result.url.shortCode}.${settings.format}`
            : `qr-${index + 1}.${settings.format}`;
          zip.file(filename, result.blob);
        }
      });

      // Add a summary file
      const summary = successResults.map(result => ({
        shortCode: result.url.shortCode,
        originalUrl: result.url.originalUrl,
        qrCodeFile: result.url.shortCode 
          ? `qr-${result.url.shortCode}.${settings.format}`
          : `qr-${results.indexOf(result) + 1}.${settings.format}`,
      }));

      zip.file('summary.json', JSON.stringify(summary, null, 2));

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      // Download zip file
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `qr-codes-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('QR codes downloaded as ZIP file');
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Failed to download QR codes');
    }
  };

  const handleDownloadSingle = (result: BulkGenerationResult) => {
    if (!result.blob) return;

    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.url.shortCode 
      ? `qr-${result.url.shortCode}.${settings.format}`
      : `qr-code.${settings.format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRemoveResult = (index: number) => {
    setResults(prev => prev.filter((_, i) => i !== index));
  };

  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  return (
    <Card className={className}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h6" component="h3" fontWeight="bold" gutterBottom>
          Bulk QR Code Generator
        </Typography>

        {/* Settings */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Generation Settings
          </Typography>
          
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Size</InputLabel>
              <Select
                value={settings.size}
                label="Size"
                onChange={(e) => setSettings(prev => ({ ...prev, size: Number(e.target.value) }))}
              >
                <MenuItem value={128}>128px</MenuItem>
                <MenuItem value={256}>256px</MenuItem>
                <MenuItem value={512}>512px</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Format</InputLabel>
              <Select
                value={settings.format}
                label="Format"
                onChange={(e) => setSettings(prev => ({ ...prev, format: e.target.value as 'png' | 'svg' }))}
              >
                <MenuItem value="png">PNG</MenuItem>
                <MenuItem value="svg">SVG</MenuItem>
              </Select>
            </FormControl>

            <Chip 
              label={`${urls.length} URLs selected`} 
              color="primary" 
              variant="outlined" 
            />
          </Stack>
        </Box>

        {/* Actions */}
        <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
          <Button
            variant="contained"
            startIcon={<QrCode />}
            onClick={handleGenerate}
            disabled={isGenerating || urls.length === 0}
          >
            {isGenerating ? 'Generating...' : 'Generate QR Codes'}
          </Button>

          {successCount > 0 && (
            <Button
              variant="outlined"
              startIcon={<CloudDownload />}
              onClick={handleDownloadAll}
              disabled={isGenerating}
            >
              Download All ({successCount})
            </Button>
          )}
        </Stack>

        {/* Progress */}
        {isGenerating && (
          <Box sx={{ mb: 3 }}>
            <LinearProgress variant="determinate" value={progress} sx={{ mb: 1 }} />
            <Typography variant="caption" color="text.secondary">
              Generating QR codes... {Math.round(progress)}%
            </Typography>
          </Box>
        )}

        {/* Results Summary */}
        {results.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Stack direction="row" spacing={1}>
              <Chip 
                label={`${successCount} Success`} 
                color="success" 
                size="small"
                icon={<CheckCircle />}
              />
              {errorCount > 0 && (
                <Chip 
                  label={`${errorCount} Errors`} 
                  color="error" 
                  size="small"
                  icon={<Error />}
                />
              )}
            </Stack>
          </Box>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>URL</TableCell>
                  <TableCell>Short Code</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.map((result, index) => (
                  <TableRow key={`${result.url.id}-${index}`}>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                        {result.url.originalUrl}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">
                        {result.url.shortCode || 'N/A'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={result.status}
                        size="small"
                        color={
                          result.status === 'success' ? 'success' :
                          result.status === 'error' ? 'error' :
                          result.status === 'generating' ? 'warning' : 'default'
                        }
                        variant={result.status === 'pending' ? 'outlined' : 'filled'}
                      />
                      {result.error && (
                        <Tooltip title={result.error}>
                          <Error color="error" sx={{ ml: 1, fontSize: 16 }} />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5}>
                        {result.status === 'success' && result.blob && (
                          <Tooltip title="Download">
                            <IconButton 
                              size="small" 
                              onClick={() => handleDownloadSingle(result)}
                            >
                              <Download />
                            </IconButton>
                          </Tooltip>
                        )}
                        
                        <Tooltip title="Remove">
                          <IconButton 
                            size="small" 
                            onClick={() => handleRemoveResult(index)}
                          >
                            <Delete />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {urls.length === 0 && (
          <Alert severity="info">
            No URLs selected. Please select URLs from your URL list to generate QR codes.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};