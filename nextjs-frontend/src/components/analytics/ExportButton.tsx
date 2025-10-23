'use client';

import React, { useState } from 'react';
import {
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  Tooltip,
  Divider,
} from '@mui/material';
import {
  FileDownload,
  TableChart,
  PictureAsPdf,
  DataObject,
  Description,
} from '@mui/icons-material';
import { AnalyticsExporter, type ExportFormat, type ExportOptions } from '@/lib/utils/exportUtils';
import type { AnalyticsData } from '@/types/analytics';

interface ExportButtonProps {
  data: AnalyticsData;
  urlId?: string;
  className?: string;
  variant?: 'contained' | 'outlined' | 'text';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
}

export const ExportButton: React.FC<ExportButtonProps> = ({
  data,
  urlId,
  className,
  variant = 'outlined',
  size = 'medium',
  disabled = false,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);

  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);
    setExportingFormat(format);
    handleClose();

    try {
      const filename = urlId 
        ? `analytics-${urlId}-${new Date().toISOString().split('T')[0]}`
        : `analytics-${new Date().toISOString().split('T')[0]}`;

      const options: ExportOptions = {
        format,
        filename,
        includeCharts: format === 'pdf',
      };

      await AnalyticsExporter.exportData(data, options);
    } catch (error) {
      console.error('Export failed:', error);
      // You could add a toast notification here
    } finally {
      setIsExporting(false);
      setExportingFormat(null);
    }
  };

  const exportFormats = [
    {
      format: 'csv' as ExportFormat,
      label: 'Export as CSV',
      description: 'Spreadsheet format',
      icon: <TableChart />,
    },
    {
      format: 'excel' as ExportFormat,
      label: 'Export as Excel',
      description: 'Microsoft Excel format',
      icon: <Description />,
    },
    {
      format: 'pdf' as ExportFormat,
      label: 'Export as PDF',
      description: 'Printable report',
      icon: <PictureAsPdf />,
    },
    {
      format: 'json' as ExportFormat,
      label: 'Export as JSON',
      description: 'Developer format',
      icon: <DataObject />,
    },
  ];

  return (
    <>
      <Tooltip title="Export analytics data">
        <Button
          className={className}
          variant={variant}
          size={size}
          disabled={disabled || isExporting}
          onClick={handleClick}
          startIcon={
            isExporting ? (
              <CircularProgress size={16} />
            ) : (
              <FileDownload />
            )
          }
          aria-controls={open ? 'export-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
        >
          {isExporting 
            ? `Exporting ${exportingFormat?.toUpperCase()}...` 
            : 'Export'
          }
        </Button>
      </Tooltip>

      <Menu
        id="export-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          'aria-labelledby': 'export-button',
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        {exportFormats.map((format, index) => (
          <MenuItem
            key={format.format}
            onClick={() => handleExport(format.format)}
            disabled={isExporting}
          >
            <ListItemIcon>
              {format.icon}
            </ListItemIcon>
            <ListItemText
              primary={format.label}
              secondary={format.description}
            />
          </MenuItem>
        ))}
        
        <Divider />
        
        <MenuItem disabled>
          <ListItemText
            primary="Export includes:"
            secondary="Summary, clicks by date, geographic data, devices, browsers, and referrers"
            sx={{ 
              '& .MuiListItemText-primary': { 
                fontSize: '0.75rem',
                fontWeight: 'bold',
                color: 'text.secondary'
              },
              '& .MuiListItemText-secondary': { 
                fontSize: '0.7rem'
              }
            }}
          />
        </MenuItem>
      </Menu>
    </>
  );
};