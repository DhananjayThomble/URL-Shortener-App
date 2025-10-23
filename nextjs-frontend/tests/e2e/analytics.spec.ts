import { test, expect } from '@playwright/test';

test.describe('Analytics Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication
    await page.addInitScript(() => {
      localStorage.setItem('auth-token', 'mock-jwt-token');
    });
    
    // Mock analytics API responses
    await page.route('**/api/analytics/**', async route => {
      const url = route.request().url();
      
      if (url.includes('/overview')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            totalClicks: 1250,
            totalUrls: 45,
            clicksToday: 89,
            topCountries: [
              { country: 'United States', clicks: 450 },
              { country: 'United Kingdom', clicks: 320 },
              { country: 'Canada', clicks: 180 }
            ]
          })
        });
      } else if (url.includes('/charts')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            clicksOverTime: [
              { date: '2024-01-01', clicks: 45 },
              { date: '2024-01-02', clicks: 67 },
              { date: '2024-01-03', clicks: 89 }
            ]
          })
        });
      }
    });
  });

  test('should display analytics overview', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    
    // Check if analytics components are visible
    await expect(page.locator('text=Analytics Dashboard')).toBeVisible();
    await expect(page.locator('[data-testid="analytics-overview"]')).toBeVisible();
  });

  test('should show key metrics cards', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    
    // Check for metrics cards
    await expect(page.locator('text=Total Clicks')).toBeVisible();
    await expect(page.locator('text=Total URLs')).toBeVisible();
    await expect(page.locator('text=Clicks Today')).toBeVisible();
    
    // Check if numbers are displayed
    await expect(page.locator('text=1,250')).toBeVisible();
    await expect(page.locator('text=45')).toBeVisible();
    await expect(page.locator('text=89')).toBeVisible();
  });

  test('should display interactive charts', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    
    // Check if chart container is present
    await expect(page.locator('[data-testid="analytics-chart"]')).toBeVisible();
    
    // Check if chart elements are rendered (SVG or Canvas)
    const chartElement = page.locator('svg, canvas').first();
    await expect(chartElement).toBeVisible();
  });

  test('should show geographic analytics', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    
    // Check for geographic data
    await expect(page.locator('text=Top Countries')).toBeVisible();
    await expect(page.locator('text=United States')).toBeVisible();
    await expect(page.locator('text=United Kingdom')).toBeVisible();
    await expect(page.locator('text=Canada')).toBeVisible();
  });

  test('should filter analytics by date range', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    
    // Click on date range picker
    await page.click('[data-testid="date-range-picker"]');
    
    // Select a date range (this depends on your date picker implementation)
    await page.click('text=Last 7 days');
    
    // Check if data updates (you might need to mock different API responses)
    await expect(page.locator('[data-testid="analytics-chart"]')).toBeVisible();
  });

  test('should export analytics data', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    
    // Mock download
    const downloadPromise = page.waitForEvent('download');
    
    // Click export button
    await page.click('button:has-text("Export")');
    
    // Wait for download to start
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('analytics');
  });

  test('should display real-time metrics', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    
    // Check if real-time widget is present
    await expect(page.locator('[data-testid="real-time-metrics"]')).toBeVisible();
    
    // Check for live indicator
    await expect(page.locator('text=Live')).toBeVisible();
  });
});