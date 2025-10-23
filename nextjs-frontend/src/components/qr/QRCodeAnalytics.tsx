'use client';

import React, { useState, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  Chip,
  LinearProgress,
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
  QrCode,
  TrendingUp,
  Devices,
  Schedule,
  Visibility,
  Refresh,
  Download,
} from '@mui/icons-material';
import { ClickChart } from '@/components/analytics';
import type { AnalyticsData } from '@/types/analytics';

interface QRCodeAnalyticsProps {
  urlId: string;
  analyticsData?: AnalyticsData;
  onRefresh?: () => void;
  className?: string;
}

interface QRScanData {
  date: string;
  scans: number;
  device: string;
  location: string;
  source: 'camera' | 'app' | 'browser';
}

// Mock QR scan data - in real implementation, this would come from the API
const mockQRScans: QRScanData[] = [
  { date: '2024-01-15', scans: 12, device: 'iPhone', location: 'US', source: 'camera' },
  { date: '2024-01-14', scans: 8, device: 'Android', location: 'UK', source: 'app' },
  { date: '2024-01-13', scans: 15, device: 'iPhone', location: 'CA', source: 'camera' },
  { date: '2024-01-12', scans: 6, device: 'Android', location: 'US', source: 'browser' },
  { date: '2024-01-11', scans: 20, device: 'iPhone', location: 'AU', source: 'camera' },
];

export const QRCodeAnalytics: React.FC<QRCodeAnalyticsProps> = ({
  urlId,
  analyticsData,
  onRefresh,
  className,
}) => {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [isLoading, setIsLoading] = useState(false);

  // Calculate QR-specific metrics
  const qrMetrics = useMemo(() => {
    if (!analyticsData) return null;

    // In a real implementation, we would filter analytics data for QR code sources
    // For now, we'll estimate based on device types and referrer patterns
    const totalScans = mockQRScans.reduce((sum, scan) => sum + scan.scans, 0);
    const avgScansPerDay = totalScans / mockQRScans.length;
    
    // Estimate QR scans as percentage of mobile traffic
    const mobileDevices = analyticsData.topDevices.filter(d => 
      d.device.toLowerCase().includes('mobile') || 
      d.device.toLowerCase().includes('phone') ||
      d.device.toLowerCase().includes('tablet')
    );
    
    const mobilePercentage = mobileDevices.reduce((sum, device) => sum + device.percentage, 0);
    const estimatedQRClicks = Math.round((analyticsData.totalClicks * mobilePercentage) / 100);

    return {
      totalScans,
      avgScansPerDay: Math.round(avgScansPerDay),
      estimatedQRClicks,
      qrConversionRate: analyticsData.totalClicks > 0 ? (estimatedQRClicks / analyticsData.totalClicks) * 100 : 0,
      topScanDevice: mockQRScans.reduce((prev, current) => 
        prev.scans > current.scans ? prev : current
      ).device,
      scansBySource: mockQRScans.reduce((acc, scan) => {
        acc[scan.source] = (acc[scan.source] || 0) + scan.scans;
        return acc;
      }, {} as Record<string, number>),
    };
  }, [analyticsData]);

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  if (!analyticsData || !qrMetrics) {
    return (
      <Card className={className}>
        <CardContent sx={{ textAlign: 'center', py: 4 }}>
          <QrCode sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
          <Typography variant="body2" color="text.secondary">
            No QR code analytics data available
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardContent sx={{ p: 3 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <QrCode color="primary" />
            <Typography variant="h6" component="h3" fontWeight="bold">
              QR Code Analytics
            </Typography>
          </Box>
          
          <Stack direction="row" spacing={1} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Period</InputLabel>
              <Select
                value={timeRange}
                label="Period"
                onChange={(e) => setTimeRange(e.target.value as any)}
              >
                <MenuItem value="7d">7 Days</MenuItem>
                <MenuItem value="30d">30 Days</MenuItem>
                <MenuItem value="90d">90 Days</MenuItem>
              </Select>
            </FormControl>
            
            <Tooltip title="Refresh data">
              <IconButton onClick={handleRefresh} disabled={isLoading}>
                <Refresh />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        {/* Loading */}
        {isLoading && <LinearProgress sx={{ mb: 2 }} />}

        {/* QR Metrics */}
        <Box sx={{ 
          display: 'grid', 
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 3 
        }}>
          <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="h4" color="primary.main" fontWeight="bold">
              {qrMetrics.totalScans}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Total QR Scans
            </Typography>
          </Box>
          
          <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="h4" color="secondary.main" fontWeight="bold">
              {qrMetrics.estimatedQRClicks}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Estimated QR Clicks
            </Typography>
          </Box>
          
          <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="h4" color="success.main" fontWeight="bold">
              {qrMetrics.qrConversionRate.toFixed(1)}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              QR Conversion Rate
            </Typography>
          </Box>
          
          <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="h4" color="info.main" fontWeight="bold">
              {qrMetrics.avgScansPerDay}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Avg Scans/Day
            </Typography>
          </Box>
        </Box>

        {/* Scan Sources */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Scan Sources
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {Object.entries(qrMetrics.scansBySource).map(([source, count]) => (
              <Chip
                key={source}
                label={`${source}: ${count}`}
                variant="outlined"
                size="small"
                icon={
                  source === 'camera' ? <Visibility /> :
                  source === 'app' ? <Devices /> :
                  <Schedule />
                }
              />
            ))}
          </Stack>
        </Box>

        {/* Scan History Chart */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            QR Scan Activity
          </Typography>
          <Box sx={{ height: 200, bgcolor: 'action.hover', borderRadius: 1, p: 2 }}>
            {/* This would be replaced with actual QR scan data */}
            <ClickChart
              data={mockQRScans.map(scan => ({
                date: scan.date,
                clicks: scan.scans,
                uniqueClicks: Math.round(scan.scans * 0.8), // Estimate unique scans
              }))}
              type="area"
              period={timeRange}
              height={160}
              showUniqueClicks={true}
            />
          </Box>
        </Box>

        {/* Recent Scans Table */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Recent QR Scans
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Scans</TableCell>
                  <TableCell>Device</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Source</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mockQRScans.slice(0, 5).map((scan, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      {new Date(scan.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Chip label={scan.scans} size="small" color="primary" />
                    </TableCell>
                    <TableCell>{scan.device}</TableCell>
                    <TableCell>{scan.location}</TableCell>
                    <TableCell>
                      <Chip 
                        label={scan.source} 
                        size="small" 
                        variant="outlined"
                        color={
                          scan.source === 'camera' ? 'success' :
                          scan.source === 'app' ? 'info' : 'default'
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        {/* QR Code Performance Tips */}
        <Box sx={{ mt: 3, p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            💡 QR Code Performance Tips
          </Typography>
          <Typography variant="body2" color="text.secondary">
            • Place QR codes at eye level for easy scanning
            • Ensure good contrast between code and background
            • Test QR codes on different devices before printing
            • Include a short URL as backup text below the QR code
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};