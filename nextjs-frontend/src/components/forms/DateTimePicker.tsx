'use client';
import { forwardRef, useState } from 'react';
import {
  TextField,
  InputAdornment,
  IconButton,
  Popover,
  Box,
  Typography,
  Button,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  CalendarToday,
  AccessTime,
  ChevronLeft,
  ChevronRight,
  Today,
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';

export interface DateTimePickerProps {
  value?: Date | null;
  onChange?: (date: Date | null) => void;
  variant?: 'date' | 'time' | 'datetime';
  format?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  minDate?: Date;
  maxDate?: Date;
  disablePast?: boolean;
  disableFuture?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  required?: boolean;
}

// Styled components
const CalendarGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: theme.spacing(0.5),
  padding: theme.spacing(1),
}));

const CalendarCell = styled(Button, {
  shouldForwardProp: (prop) => !['isToday', 'isSelected', 'isOtherMonth'].includes(prop as string),
})<{ isToday?: boolean; isSelected?: boolean; isOtherMonth?: boolean }>(
  ({ theme, isToday, isSelected, isOtherMonth }) => ({
    minWidth: 32,
    height: 32,
    padding: 0,
    borderRadius: '50%',
    fontSize: theme.typography.body2.fontSize,
    ...(isOtherMonth && {
      color: theme.palette.text.disabled,
    }),
    ...(isToday && {
      backgroundColor: theme.palette.primary.light,
      color: theme.palette.primary.contrastText,
    }),
    ...(isSelected && {
      backgroundColor: theme.palette.primary.main,
      color: theme.palette.primary.contrastText,
      '&:hover': {
        backgroundColor: theme.palette.primary.dark,
      },
    }),
  })
);

const TimeInput = styled(TextField)(({ theme }) => ({
  '& .MuiInputBase-input': {
    textAlign: 'center',
    fontSize: theme.typography.h6.fontSize,
    fontWeight: theme.typography.h6.fontWeight,
  },
}));

// Utility functions
const formatDate = (date: Date | null, format: string): string => {
  if (!date) return '';
  
  switch (format) {
    case 'MM/dd/yyyy':
      return date.toLocaleDateString('en-US');
    case 'dd/MM/yyyy':
      return date.toLocaleDateString('en-GB');
    case 'yyyy-MM-dd':
      return date.toISOString().split('T')[0];
    case 'HH:mm':
      return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    case 'hh:mm a':
      return date.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
    case 'MM/dd/yyyy HH:mm':
      return `${date.toLocaleDateString('en-US')} ${date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
    default:
      return date.toLocaleDateString();
  }
};

const isSameDay = (date1: Date, date2: Date): boolean => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

export const DateTimePicker = forwardRef<HTMLInputElement, DateTimePickerProps>(
  (
    {
      value = null,
      onChange,
      variant = 'date',
      format,
      label,
      placeholder,
      disabled = false,
      error = false,
      helperText,
      minDate,
      maxDate,
      disablePast = false,
      disableFuture = false,
      size = 'medium',
      fullWidth = false,
      required = false,
      ...props
    },
    ref
  ) => {
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [viewDate, setViewDate] = useState(value || new Date());
    const [timeMode, setTimeMode] = useState<'12' | '24'>('12');

    // Default formats
    const defaultFormat = format || {
      date: 'MM/dd/yyyy',
      time: timeMode === '12' ? 'hh:mm a' : 'HH:mm',
      datetime: timeMode === '12' ? 'MM/dd/yyyy hh:mm a' : 'MM/dd/yyyy HH:mm',
    }[variant];

    const open = Boolean(anchorEl);

    // Handle input click
    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
      if (!disabled) {
        setAnchorEl(event.currentTarget);
      }
    };

    // Handle popover close
    const handleClose = () => {
      setAnchorEl(null);
    };

    // Handle date selection
    const handleDateSelect = (date: Date) => {
      let newDate = new Date(date);
      if (value && (variant === 'datetime' || variant === 'time')) {
        // Preserve time when selecting date
        newDate.setHours(value.getHours(), value.getMinutes(), value.getSeconds());
      }
      onChange?.(newDate);
      if (variant === 'date') {
        handleClose();
      }
    };

    // Handle time change
    const handleTimeChange = (hours: number, minutes: number) => {
      const newDate = value ? new Date(value) : new Date();
      newDate.setHours(hours, minutes, 0, 0);
      onChange?.(newDate);
    };

    // Navigate calendar
    const navigateMonth = (direction: 'prev' | 'next') => {
      const newDate = new Date(viewDate);
      newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
      setViewDate(newDate);
    };

    // Go to today
    const goToToday = () => {
      const today = new Date();
      setViewDate(today);
      handleDateSelect(today);
    };

    // Render calendar
    const renderCalendar = () => {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const today = new Date();
      const days = [];
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      // Day headers
      dayNames.forEach(day => {
        days.push(
          <Typography
            key={day}
            variant="caption"
            sx={{
              textAlign: 'center',
              fontWeight: 'bold',
              color: 'text.secondary',
              p: 1,
            }}
          >
            {day}
          </Typography>
        );
      });

      // Calendar days (simplified for demo)
      for (let day = 1; day <= 31; day++) {
        const date = new Date(year, month, day);
        const isToday = isSameDay(date, today);
        const isSelected = Boolean(value && isSameDay(date, value));

        days.push(
          <CalendarCell
            key={day}
            isToday={isToday}
            isSelected={isSelected}
            onClick={() => handleDateSelect(date)}
          >
            {day}
          </CalendarCell>
        );
      }

      return <CalendarGrid>{days}</CalendarGrid>;
    };

    // Render time picker
    const renderTimePicker = () => {
      const currentHours = value?.getHours() || 0;
      const currentMinutes = value?.getMinutes() || 0;
      const displayHours = timeMode === '12' 
        ? (currentHours === 0 ? 12 : currentHours > 12 ? currentHours - 12 : currentHours)
        : currentHours;
      const ampm = currentHours >= 12 ? 'PM' : 'AM';

      return (
        <Box sx={{ p: 2 }}>
          <Stack direction="row" spacing={2} alignItems="center" justifyContent="center">
            <TimeInput
              value={displayHours.toString().padStart(2, '0')}
              onChange={(e) => {
                const hours = parseInt(e.target.value) || 0;
                const actualHours = timeMode === '12' 
                  ? (ampm === 'PM' && hours !== 12 ? hours + 12 : hours === 12 && ampm === 'AM' ? 0 : hours)
                  : hours;
                handleTimeChange(actualHours, currentMinutes);
              }}
              size="small"
              sx={{ width: 60 }}
            />
            <Typography variant="h6">:</Typography>
            <TimeInput
              value={currentMinutes.toString().padStart(2, '0')}
              onChange={(e) => {
                const minutes = parseInt(e.target.value) || 0;
                handleTimeChange(currentHours, minutes);
              }}
              size="small"
              sx={{ width: 60 }}
            />
            {timeMode === '12' && (
              <ToggleButtonGroup
                value={ampm}
                exclusive
                onChange={(_, value) => {
                  if (value) {
                    const newHours = value === 'PM' && currentHours < 12 
                      ? currentHours + 12 
                      : value === 'AM' && currentHours >= 12 
                      ? currentHours - 12 
                      : currentHours;
                    handleTimeChange(newHours, currentMinutes);
                  }
                }}
                size="small"
              >
                <ToggleButton value="AM">AM</ToggleButton>
                <ToggleButton value="PM">PM</ToggleButton>
              </ToggleButtonGroup>
            )}
          </Stack>
        </Box>
      );
    };

    return (
      <>
        <TextField
          ref={ref}
          label={label}
          placeholder={placeholder}
          value={formatDate(value, defaultFormat)}
          onClick={handleClick}
          disabled={disabled}
          error={error}
          helperText={helperText}
          size={size}
          fullWidth={fullWidth}
          required={required}
          InputProps={{
            readOnly: true,
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={handleClick} disabled={disabled}>
                  {variant === 'time' ? <AccessTime /> : <CalendarToday />}
                </IconButton>
              </InputAdornment>
            ),
          }}
          {...props}
        />
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
          <Box sx={{ minWidth: 280 }}>
            {(variant === 'date' || variant === 'datetime') && (
              <>
                {/* Calendar Header */}
                <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <IconButton onClick={() => navigateMonth('prev')}>
                    <ChevronLeft />
                  </IconButton>
                  <Typography variant="h6">
                    {viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </Typography>
                  <IconButton onClick={() => navigateMonth('next')}>
                    <ChevronRight />
                  </IconButton>
                </Box>
                {/* Calendar Grid */}
                {renderCalendar()}
                {/* Today Button */}
                <Box sx={{ p: 1, textAlign: 'center' }}>
                  <Button
                    size="small"
                    startIcon={<Today />}
                    onClick={goToToday}
                  >
                    Today
                  </Button>
                </Box>
              </>
            )}
            {(variant === 'time' || variant === 'datetime') && renderTimePicker()}
          </Box>
        </Popover>
      </>
    );
  }
);

DateTimePicker.displayName = 'DateTimePicker';

export default DateTimePicker;