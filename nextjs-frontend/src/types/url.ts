export interface URLData {
  id: string;
  userId: string;
  shortCode: string;
  originalUrl: string;
  customBackHalf?: string;
  category?: string;
  visitCount: number;
  isActive: boolean;
  expiresAt?: string;
  metadata?: URLMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface URLMetadata {
  title?: string;
  description?: string;
  favicon?: string;
  ogImage?: string;
}

export interface CreateURLData {
  originalUrl: string;
  customBackHalf?: string;
  category?: string;
  expiresAt?: string;
  tags?: string[];
}

export interface UpdateURLData {
  originalUrl?: string;
  customBackHalf?: string;
  category?: string;
  isActive?: boolean;
  expiresAt?: string;
  tags?: string[];
}

export interface URLListParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  sortBy?: 'createdAt' | 'visitCount' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface URLFilters {
  category?: string;
  isActive?: boolean;
  dateRange?: {
    start: string;
    end: string;
  };
  search?: string;
}

export interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationData;
}

export interface URLAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  color?: 'primary' | 'secondary' | 'error' | 'warning' | 'success';
  disabled?: boolean;
}

export interface BulkURLOperation {
  action: 'delete' | 'activate' | 'deactivate' | 'export';
  urlIds: string[];
}
