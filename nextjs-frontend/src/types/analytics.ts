export interface AnalyticsData {
  urlId: string;
  totalClicks: number;
  uniqueClicks: number;
  clicksByDate: ClicksByDate[];
  topCountries: CountryData[];
  topDevices: DeviceData[];
  topBrowsers: BrowserData[];
  topReferrers: ReferrerData[];
  topOperatingSystems: OSData[];
}

export interface ClicksByDate {
  date: string;
  clicks: number;
  uniqueClicks: number;
}

export interface CountryData {
  country: string;
  countryCode: string;
  clicks: number;
  percentage: number;
}

export interface DeviceData {
  device: string;
  clicks: number;
  percentage: number;
}

export interface BrowserData {
  browser: string;
  version?: string;
  clicks: number;
  percentage: number;
}

export interface ReferrerData {
  referrer: string;
  domain: string;
  clicks: number;
  percentage: number;
}

export interface OSData {
  os: string;
  version?: string;
  clicks: number;
  percentage: number;
}

export interface GeographicData {
  country: string;
  countryCode: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  clicks: number;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface AnalyticsFilters {
  period: '24h' | '7d' | '30d' | '90d' | 'custom';
  dateRange?: DateRange;
  country?: string;
  device?: string;
  browser?: string;
  referrer?: string;
}

export interface DashboardMetrics {
  totalUrls: number;
  totalClicks: number;
  uniqueClicks: number;
  topUrl: {
    shortCode: string;
    originalUrl: string;
    clicks: number;
  };
  recentActivity: RecentActivity[];
  clicksOverTime: ClicksByDate[];
}

export interface RecentActivity {
  id: string;
  type: 'url_created' | 'url_clicked' | 'url_updated' | 'url_deleted';
  description: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface SystemAnalytics {
  totalUsers: number;
  totalUrls: number;
  totalClicks: number;
  activeUsers: number;
  newUsersToday: number;
  clicksToday: number;
  topDomains: Array<{
    domain: string;
    count: number;
  }>;
  userGrowth: Array<{
    date: string;
    users: number;
  }>;
  clickGrowth: Array<{
    date: string;
    clicks: number;
  }>;
}
