'use client';

import React, { useState } from 'react';
import {
  Box,
  Button,
  Popover,
  TextField,
  Typography,
  Stack,
  IconButton,
} from '@mui/material';
import {
  DateRange as DateRangeIcon,
  Clear,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import type { DateRange } from '@/types/analytics';

interface DateRangePickerProps {
  value?: DateRange | null;
  onChange: (range: DateRange | null) => void;
  className?: string;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  value,
  onChange,
  className,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(value?.start || null);
  const [endDate, setEndDate] = useState<Date | null>(value?.end || null);

  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleApply = () => {
    if (startDate && endDate) {
      onChange({
        start: startDate,
        end: endDate,
      });
    }
    handleClose();
  };

  const handleClear = () => {
    setStartDate(null);
    setEndDate(null);
    onChange(null);
    handleClose();
  };

  const formatDateRange = (range: DateRange | null | undefined) => {
    if (!range) return 'Select date range';
    
    const start = range.start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    
    const end = range.end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    
    return `${start} - ${end}`;
  };

  const isValidRange = startDate && endDate && startDate <= endDate;

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box className={className}>
        <Button
          variant="outlined"
          startIcon={<DateRangeIcon />}
          endIcon={value && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              sx={{ ml: 0.5, p: 0.25 }}
            >
              <Clear fontSize="small" />
            </IconButton>
          )}
          onClick={handleClick}
          sx={{ minWidth: 200 }}
        >
          {formatDateRange(value)}
        </Button>

        <Popover
          open={open}
          anchorEl={anchorEl}
          onClose={handleClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'left',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'left',
          }}
        >
          <Box sx={{ p: 3, minWidth: 320 }}>
            <Typography variant="h6" gutterBottom>
              Select Date Range
            </Typography>

            <Stack spacing={2}>
              <DatePicker
                label="Start Date"
                value={startDate}
                onChange={(date) => setStartDate(date)}
                maxDate={endDate || new Date()}
                slotProps={{
                  textField: {
                    size: 'small',
                    fullWidth: true,
                  },
                }}
              />

              <DatePicker
                label="End Date"
                value={endDate}
                onChange={(date) => setEndDate(date)}
                minDate={startDate || undefined}
                maxDate={new Date()}
                slotProps={{
                  textField: {
                    size: 'small',
                    fullWidth: true,
                  },
                }}
              />

              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleClear}
                >
                  Clear
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleApply}
                  disabled={!isValidRange}
                >
                  Apply
                </Button>
              </Box>
            </Stack>
          </Box>
        </Popover>
      </Box>
    </LocalizationProvider>
  );
};