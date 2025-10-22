// Re-export all types for easy importing
export * from './auth';
export * from './url';
export * from './analytics';

// Import types for internal use
import { PaginationData } from './url';

// Common types
export interface APIResponse<T = any> {
  data: T;
  message?: string;
  success: boolean;
}

export interface APIError {
  status: number;
  message: string;
  data?: any;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  params?: Record<string, any>;
  body?: any;
}

export interface LoadingState {
  isLoading: boolean;
  error: string | null;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface TableColumn<T = any> {
  key: keyof T;
  label: string;
  sortable?: boolean;
  render?: (value: any, row: T) => React.ReactNode;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
}

export interface TableProps<T = any> {
  data: T[];
  columns: TableColumn<T>[];
  loading?: boolean;
  pagination?: PaginationData;
  onPageChange?: (page: number) => void;
  onSort?: (column: keyof T, direction: 'asc' | 'desc') => void;
  selectedRows?: string[];
  onRowSelect?: (ids: string[]) => void;
  actions?: Array<{
    label: string;
    onClick: (row: T) => void;
    icon?: React.ReactNode;
    color?: string;
  }>;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  fullWidth?: boolean;
  actions?: React.ReactNode;
}

export interface ToastOptions {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
  position?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';
}

export interface Theme {
  mode: 'light' | 'dark';
  primaryColor: string;
  secondaryColor: string;
}

export interface UserPreferences {
  theme: Theme;
  language: string;
  timezone: string;
  notifications: {
    email: boolean;
    push: boolean;
    marketing: boolean;
  };
  dashboard: {
    defaultView: 'grid' | 'list';
    itemsPerPage: number;
  };
}
