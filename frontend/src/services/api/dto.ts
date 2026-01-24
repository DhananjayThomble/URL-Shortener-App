/**
 * TypeScript interfaces matching NestJS backend DTOs
 * These interfaces ensure type safety between frontend and backend
 */

// ============================================================================
// Authentication DTOs
// ============================================================================

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface VerifyEmailRequest {
  token: string;
}

// ============================================================================
// URL Management DTOs
// ============================================================================

export interface TagDto {
  name: string;
  value: string;
}

export interface CreateUrlRequest {
  originalUrl: string;
  customBackHalf?: string;
  category?: string;
  expiresAt?: string; // ISO date string
  tags?: TagDto[];
  customDomain?: string;
}

export interface UTMParameters {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export interface TrackingPixels {
  metaPixelId?: string;
  googleAnalyticsId?: string;
  tiktokPixelId?: string;
}

export interface GeoTargetingRule {
  countryCode: string;
  redirectUrl: string;
}

export interface EnhancedCreateUrlRequest {
  originalUrl: string;
  customAlias?: string;
  title?: string;
  expiresAt?: string; // ISO date string
  password?: string;
  passwordHint?: string;
  iosUrl?: string;
  androidUrl?: string;
  utmParameters?: UTMParameters;
  trackingPixels?: TrackingPixels;
  geoTargetingRules?: GeoTargetingRule[];
}

export interface UpdateUrlRequest {
  originalUrl?: string;
  customAlias?: string;
  title?: string;
  expiresAt?: string; // ISO date string
  password?: string;
  passwordHint?: string;
  iosUrl?: string;
  androidUrl?: string;
  utmParameters?: UTMParameters;
  trackingPixels?: TrackingPixels;
  geoTargetingRules?: GeoTargetingRule[];
  isActive?: boolean;
}

// ============================================================================
// Response DTOs
// ============================================================================

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export interface URL {
  id: string;
  shortCode: string;
  shortUrl: string;
  originalUrl: string;
  customAlias?: string;
  title?: string;
  description?: string;
  tags: TagDto[];
  clickCount: number;
  isActive: boolean;
  expiresAt?: string;
  password?: string;
  passwordHint?: string;
  iosUrl?: string;
  androidUrl?: string;
  utmParameters?: UTMParameters;
  trackingPixels?: TrackingPixels;
  geoTargetingRules?: GeoTargetingRule[];
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  value: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Analytics DTOs
// ============================================================================

export interface AnalyticsParams {
  limit?: number;
  offset?: number;
}

export interface DashboardAnalyticsParams {
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface AnalyticsSummary {
  totalClicks: number;
  uniqueVisitors: number;
  averageClicksPerDay: number;
  conversionRate: number;
}

export interface DateClickData {
  date: string;
  clicks: number;
  uniqueVisitors: number;
}

export interface DeviceBreakdown {
  desktop: number;
  mobile: number;
  tablet: number;
}

export interface GeographicData {
  country: string;
  countryCode: string;
  clicks: number;
  percentage: number;
}

export interface ReferrerData {
  referrer: string;
  clicks: number;
  percentage: number;
}

export interface UTMAnalytics {
  source: Record<string, number>;
  medium: Record<string, number>;
  campaign: Record<string, number>;
  term: Record<string, number>;
  content: Record<string, number>;
}

export interface AnalyticsData {
  summary: AnalyticsSummary;
  clicksByDate: DateClickData[];
  deviceBreakdown: DeviceBreakdown;
  browserBreakdown: Record<string, number>;
  osBreakdown: Record<string, number>;
  geographicData: GeographicData[];
  topReferrers: ReferrerData[];
  utmAnalytics: UTMAnalytics;
}

export interface DashboardAnalytics {
  summary: AnalyticsSummary;
  recentClicks: DateClickData[];
  topUrls: Array<{
    id: string;
    shortCode: string;
    title?: string;
    clicks: number;
  }>;
  deviceBreakdown: DeviceBreakdown;
}

export interface RealTimeAnalytics {
  activeVisitors: number;
  recentClicks: Array<{
    timestamp: string;
    country: string;
    device: string;
    referrer?: string;
  }>;
}

export interface RealTimeUpdate {
  type: 'click' | 'visitor';
  data: {
    urlId: string;
    timestamp: string;
    country: string;
    device: string;
    referrer?: string;
  };
}

// ============================================================================
// Bio Pages DTOs
// ============================================================================

export interface CreateBioPageRequest {
  username: string;
  title?: string;
  bio?: string;
  avatarUrl?: string;
  theme: string;
  backgroundColor?: string;
  textColor?: string;
  buttonStyle?: string;
  isPublic: boolean;
}

export interface CreateBioLinkRequest {
  title: string;
  url: string;
  icon?: string;
  position: number;
  isActive: boolean;
}

export interface LinkOrder {
  id: string;
  position: number;
}

export interface BioLink {
  id: string;
  title: string;
  url: string;
  icon?: string;
  position: number;
  isActive: boolean;
  clickCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BioPage {
  id: string;
  username: string;
  title?: string;
  bio?: string;
  avatarUrl?: string;
  theme: string;
  backgroundColor?: string;
  textColor?: string;
  buttonStyle?: string;
  isPublic: boolean;
  bioPageUrl: string;
  userId: string;
  links: BioLink[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicBioPage {
  username: string;
  title?: string;
  bio?: string;
  avatarUrl?: string;
  theme: string;
  backgroundColor?: string;
  textColor?: string;
  buttonStyle?: string;
  bioPageUrl: string;
  links: Array<{
    id: string;
    title: string;
    url: string;
    icon?: string;
    position: number;
  }>;
}

// ============================================================================
// Bulk Operations DTOs
// ============================================================================

export interface BulkImportRequest {
  file: File;
  format: 'csv' | 'json';
}

export interface BulkExportRequest {
  format: 'csv' | 'json';
  filters?: {
    startDate?: string;
    endDate?: string;
    tags?: string[];
    isActive?: boolean;
  };
}

export interface BulkOperationJob {
  id: string;
  type: 'import' | 'export';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  totalItems?: number;
  processedItems?: number;
  failedItems?: number;
  resultUrl?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Common DTOs
// ============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

export interface URLListParams extends PaginationParams {
  search?: string;
  tags?: string[];
  tagOperator?: 'AND' | 'OR';
  isActive?: boolean;
  category?: string;
}

export interface QRCodeOptions {
  size?: number;
  format?: 'png' | 'svg';
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  margin?: number;
  color?: {
    dark?: string;
    light?: string;
  };
}

export interface QRCodeResponse {
  qrCodeUrl: string;
  format: string;
  size: number;
}

// ============================================================================
// Health Check DTOs
// ============================================================================

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  info: Record<string, any>;
  error: Record<string, any>;
  details: Record<string, any>;
}
