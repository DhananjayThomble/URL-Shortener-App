'use client';
import { forwardRef, useState, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  LinearProgress,
  Chip,
  Stack,
  Alert,
  Card,
  CardContent,
} from '@mui/material';
import {
  CloudUpload,
  Delete,
  InsertDriveFile,
  Image,
  VideoFile,
  AudioFile,
  PictureAsPdf,
  Close,
  CheckCircle,
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';

export interface FileUploadProps {
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  maxSize?: number; // in MB
  disabled?: boolean;
  loading?: boolean;
  value?: File[];
  onChange?: (files: File[]) => void;
  onError?: (error: string) => void;
  onUpload?: (files: File[]) => Promise<void>;
  variant?: 'dropzone' | 'button' | 'compact';
  showPreview?: boolean;
  allowedTypes?: string[];
  helperText?: string;
  error?: boolean;
  errorMessage?: string;
}

// Styled components
const DropzoneContainer = styled(Box, {
  shouldForwardProp: (prop) => !['isDragActive', 'error', 'disabled'].includes(prop as string),
})<{ isDragActive?: boolean; error?: boolean; disabled?: boolean }>(
  ({ theme, isDragActive, error, disabled }) => ({
    border: `2px dashed ${
      error 
        ? theme.palette.error.main 
        : isDragActive 
        ? theme.palette.primary.main 
        : theme.palette.divider
    }`,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(3),
    textAlign: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.2s ease-in-out',
    backgroundColor: isDragActive 
      ? theme.palette.action.hover 
      : disabled 
      ? theme.palette.action.disabledBackground 
      : 'transparent',
    '&:hover': {
      backgroundColor: disabled ? undefined : theme.palette.action.hover,
      borderColor: disabled ? undefined : theme.palette.primary.main,
    },
  })
);

const HiddenInput = styled('input')({
  display: 'none',
});

// File type icons
const getFileIcon = (file: File) => {
  const type = file.type;
  if (type.startsWith('image/')) return <Image color="primary" />;
  if (type.startsWith('video/')) return <VideoFile color="primary" />;
  if (type.startsWith('audio/')) return <AudioFile color="primary" />;
  if (type === 'application/pdf') return <PictureAsPdf color="error" />;
  return <InsertDriveFile color="action" />;
};

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const FileUpload = forwardRef<HTMLInputElement, FileUploadProps>(
  (
    {
      accept,
      multiple = false,
      maxFiles = 10,
      maxSize = 10,
      disabled = false,
      loading = false,
      value = [],
      onChange,
      onError,
      onUpload,
      variant = 'dropzone',
      showPreview = true,
      allowedTypes,
      helperText,
      error = false,
      errorMessage,
      ...props
    },
    ref
  ) => {
    const [isDragActive, setIsDragActive] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Handle file selection
    const handleFiles = useCallback(
      (files: FileList | null) => {
        if (!files || disabled) return;
        
        const fileArray = Array.from(files);
        const validFiles: File[] = [];
        let errorMessages: string[] = [];

        // Validate each file
        fileArray.forEach((file) => {
          // Check file size
          if (file.size > maxSize * 1024 * 1024) {
            errorMessages.push(`${file.name}: File size must be less than ${maxSize}MB`);
            return;
          }
          
          // Check file type
          if (allowedTypes && !allowedTypes.includes(file.type)) {
            errorMessages.push(`${file.name}: File type not allowed`);
            return;
          }
          
          validFiles.push(file);
        });

        // Check max files limit
        const totalFiles = multiple ? value.length + validFiles.length : validFiles.length;
        if (totalFiles > maxFiles) {
          errorMessages.push(`Maximum ${maxFiles} files allowed`);
          return;
        }

        // Handle errors
        if (errorMessages.length > 0) {
          onError?.(errorMessages.join(', '));
          return;
        }

        // Update files
        const newFiles = multiple ? [...value, ...validFiles] : validFiles;
        onChange?.(newFiles);

        // Auto-upload if handler provided
        if (onUpload && validFiles.length > 0) {
          onUpload(validFiles).catch((error) => {
            onError?.(error instanceof Error ? error.message : 'Upload failed');
          });
        }
      },
      [value, multiple, maxFiles, maxSize, allowedTypes, disabled, onChange, onError, onUpload]
    );

    // Handle file removal
    const handleRemoveFile = (index: number) => {
      const newFiles = value.filter((_, i) => i !== index);
      onChange?.(newFiles);
    };

    // Drag and drop handlers
    const handleDragEnter = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragActive(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);
    };

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);
      if (!disabled) {
        handleFiles(e.dataTransfer.files);
      }
    };

    // Handle click to open file dialog
    const handleClick = () => {
      if (!disabled) {
        inputRef.current?.click();
      }
    };

    // Render file previews
    const renderFilePreviews = () => {
      if (!showPreview || value.length === 0) return null;

      return (
        <Stack spacing={1} sx={{ mt: 2 }}>
          {value.map((file, index) => (
            <Card key={`${file.name}-${index}`} variant="outlined">
              <CardContent sx={{ display: 'flex', alignItems: 'center', p: 1, '&:last-child': { pb: 1 } }}>
                <Box sx={{ mr: 2 }}>
                  {getFileIcon(file)}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {file.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatFileSize(file.size)}
                  </Typography>
                </Box>
                {!disabled && (
                  <IconButton
                    size="small"
                    onClick={() => handleRemoveFile(index)}
                  >
                    <Close fontSize="small" />
                  </IconButton>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      );
    };

    // Render dropzone variant
    if (variant === 'dropzone') {
      return (
        <Box>
          <DropzoneContainer
            isDragActive={isDragActive}
            error={error}
            disabled={disabled}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={handleClick}
          >
            <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              {isDragActive ? 'Drop files here' : 'Drag & drop files here'}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              or click to browse files
            </Typography>
            {helperText && (
              <Typography variant="caption" color="text.secondary">
                {helperText}
              </Typography>
            )}
            <Box sx={{ mt: 2 }}>
              <Chip
                label={`Max ${maxFiles} files`}
                size="small"
                variant="outlined"
                sx={{ mr: 1 }}
              />
              <Chip
                label={`Max ${maxSize}MB each`}
                size="small"
                variant="outlined"
              />
            </Box>
          </DropzoneContainer>
          <HiddenInput
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={(e) => handleFiles(e.target.files)}
            disabled={disabled}
            {...props}
          />
          {error && errorMessage && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {errorMessage}
            </Alert>
          )}
          {renderFilePreviews()}
        </Box>
      );
    }

    // Render button variant
    if (variant === 'button') {
      return (
        <Box>
          <Button
            variant="outlined"
            startIcon={<CloudUpload />}
            onClick={handleClick}
            disabled={disabled || loading}
            fullWidth
          >
            {loading ? 'Uploading...' : 'Choose Files'}
          </Button>
          <HiddenInput
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={(e) => handleFiles(e.target.files)}
            disabled={disabled}
            {...props}
          />
          {helperText && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {helperText}
            </Typography>
          )}
          {error && errorMessage && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {errorMessage}
            </Alert>
          )}
          {renderFilePreviews()}
        </Box>
      );
    }

    // Render compact variant
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<CloudUpload />}
          onClick={handleClick}
          disabled={disabled || loading}
        >
          Upload
        </Button>
        {value.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {value.length} file{value.length > 1 ? 's' : ''} selected
          </Typography>
        )}
        <HiddenInput
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={(e) => handleFiles(e.target.files)}
          disabled={disabled}
          {...props}
        />
      </Box>
    );
  }
);

FileUpload.displayName = 'FileUpload';

export default FileUpload;