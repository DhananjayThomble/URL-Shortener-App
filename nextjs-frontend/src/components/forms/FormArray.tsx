'use client';
import { forwardRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Typography,
  Stack,
  Card,
  CardContent,
  Divider,
  Collapse,
  Alert,
} from '@mui/material';
import {
  Add,
  Delete,
  DragHandle,
  ExpandMore,
  ExpandLess,
  Warning,
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';

export interface FormArrayItem {
  id: string;
  data: Record<string, any>;
  errors?: Record<string, string>;
  collapsed?: boolean;
}

export interface FormArrayProps {
  items: FormArrayItem[];
  onChange: (items: FormArrayItem[]) => void;
  renderItem: (item: FormArrayItem, index: number, handlers: {
    updateItem: (data: Record<string, any>) => void;
    removeItem: () => void;
    toggleCollapse: () => void;
  }) => React.ReactNode;
  createNewItem: () => Omit<FormArrayItem, 'id'>;
  title?: string;
  description?: string;
  addButtonText?: string;
  minItems?: number;
  maxItems?: number;
  disabled?: boolean;
  collapsible?: boolean;
  sortable?: boolean;
  showItemNumbers?: boolean;
  error?: boolean;
  errorMessage?: string;
  helperText?: string;
}

// Styled components
const ArrayContainer = styled(Box)(({ theme }) => ({
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  padding: theme.spacing(2),
}));

const ItemCard = styled(Card, {
  shouldForwardProp: (prop) => !['hasError', 'isDragging'].includes(prop as string),
})<{ hasError?: boolean; isDragging?: boolean }>(({ theme, hasError, isDragging }) => ({
  marginBottom: theme.spacing(2),
  border: hasError ? `1px solid ${theme.palette.error.main}` : undefined,
  boxShadow: isDragging ? theme.shadows[8] : theme.shadows[1],
  opacity: isDragging ? 0.8 : 1,
  transition: 'all 0.2s ease-in-out',
  '&:last-child': {
    marginBottom: 0,
  },
}));

// Generate unique ID
const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};

export const FormArray = forwardRef<HTMLDivElement, FormArrayProps>(
  (
    {
      items,
      onChange,
      renderItem,
      createNewItem,
      title,
      description,
      addButtonText = 'Add Item',
      minItems = 0,
      maxItems = 10,
      disabled = false,
      collapsible = false,
      sortable = false,
      showItemNumbers = true,
      error = false,
      errorMessage,
      helperText,
      ...props
    },
    ref
  ) => {
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    // Add new item
    const handleAddItem = () => {
      if (items.length >= maxItems || disabled) return;
      const newItem: FormArrayItem = {
        id: generateId(),
        ...createNewItem(),
      };
      onChange([...items, newItem]);
    };

    // Remove item
    const handleRemoveItem = (index: number) => {
      if (items.length <= minItems || disabled) return;
      const newItems = items.filter((_, i) => i !== index);
      onChange(newItems);
    };

    // Update item
    const handleUpdateItem = (index: number, data: Record<string, any>) => {
      if (disabled) return;
      const newItems = [...items];
      newItems[index] = {
        ...newItems[index],
        data: { ...newItems[index].data, ...data },
      };
      onChange(newItems);
    };

    // Toggle item collapse
    const handleToggleCollapse = (index: number) => {
      if (!collapsible) return;
      const newItems = [...items];
      newItems[index] = {
        ...newItems[index],
        collapsed: !newItems[index].collapsed,
      };
      onChange(newItems);
    };

    // Check if item has errors
    const hasItemErrors = (item: FormArrayItem): boolean => {
      return Boolean(item.errors && Object.keys(item.errors).length > 0);
    };

    // Get item title for collapsed view
    const getItemTitle = (item: FormArrayItem, index: number): string => {
      // Try to find a title field in the data
      const titleFields = ['title', 'name', 'label', 'description'];
      const titleField = titleFields.find(field => item.data[field]);
      if (titleField && item.data[titleField]) {
        return item.data[titleField];
      }
      return `Item ${index + 1}`;
    };

    return (
      <ArrayContainer ref={ref} {...props}>
        {/* Header */}
        {(title || description) && (
          <Box sx={{ mb: 2 }}>
            {title && (
              <Typography variant="h6" gutterBottom>
                {title}
              </Typography>
            )}
            {description && (
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
            )}
          </Box>
        )}

        {/* Items */}
        <Stack spacing={2}>
          {items.map((item, index) => {
            const hasErrors = hasItemErrors(item);
            const isCollapsed = collapsible && item.collapsed;
            const isDragging = draggedIndex === index;

            return (
              <ItemCard
                key={item.id}
                hasError={hasErrors}
                isDragging={isDragging}
              >
                <CardContent>
                  {/* Item Header */}
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: isCollapsed ? 0 : 2 }}>
                    {/* Item Number/Title */}
                    <Box sx={{ flex: 1 }}>
                      {showItemNumbers && (
                        <Typography variant="subtitle2" color="text.secondary">
                          {isCollapsed ? getItemTitle(item, index) : `Item ${index + 1}`}
                        </Typography>
                      )}
                    </Box>

                    {/* Error Indicator */}
                    {hasErrors && (
                      <Warning color="error" sx={{ mr: 1 }} />
                    )}

                    {/* Collapse Toggle */}
                    {collapsible && (
                      <IconButton
                        size="small"
                        onClick={() => handleToggleCollapse(index)}
                        disabled={disabled}
                      >
                        {isCollapsed ? <ExpandMore /> : <ExpandLess />}
                      </IconButton>
                    )}

                    {/* Remove Button */}
                    <IconButton
                      size="small"
                      onClick={() => handleRemoveItem(index)}
                      disabled={disabled || items.length <= minItems}
                      color="error"
                    >
                      <Delete />
                    </IconButton>
                  </Box>

                  {/* Item Content */}
                  <Collapse in={!isCollapsed} timeout="auto" unmountOnExit>
                    <Box>
                      {/* Item Errors */}
                      {hasErrors && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                          <Typography variant="body2">
                            Please fix the errors in this item:
                          </Typography>
                          <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                            {Object.entries(item.errors || {}).map(([field, error]) => (
                              <li key={field}>
                                <Typography variant="caption">
                                  {field}: {error}
                                </Typography>
                              </li>
                            ))}
                          </ul>
                        </Alert>
                      )}

                      {/* Render Item Content */}
                      {renderItem(item, index, {
                        updateItem: (data) => handleUpdateItem(index, data),
                        removeItem: () => handleRemoveItem(index),
                        toggleCollapse: () => handleToggleCollapse(index),
                      })}
                    </Box>
                  </Collapse>
                </CardContent>
              </ItemCard>
            );
          })}

          {/* Empty State */}
          {items.length === 0 && (
            <Box
              sx={{
                textAlign: 'center',
                py: 4,
                color: 'text.secondary',
                border: '2px dashed',
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              <Typography variant="body2">
                No items added yet. Click the button below to add your first item.
              </Typography>
            </Box>
          )}
        </Stack>

        {/* Add Button */}
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Button
            variant="outlined"
            startIcon={<Add />}
            onClick={handleAddItem}
            disabled={disabled || items.length >= maxItems}
            fullWidth
          >
            {addButtonText}
          </Button>
          {helperText && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {helperText}
            </Typography>
          )}
        </Box>

        {/* Array Errors */}
        {error && errorMessage && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Alert>
        )}

        {/* Item Count Info */}
        <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {items.length} of {maxItems} items
          </Typography>
          {minItems > 0 && (
            <Typography variant="caption" color="text.secondary">
              Minimum: {minItems} items
            </Typography>
          )}
        </Box>
      </ArrayContainer>
    );
  }
);

FormArray.displayName = 'FormArray';

export default FormArray;