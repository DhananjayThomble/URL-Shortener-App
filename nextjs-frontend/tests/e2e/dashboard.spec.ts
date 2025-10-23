import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  // Mock authentication for dashboard tests
  test.beforeEach(async ({ page }) => {
    // Mock authentication token
    await page.addInitScript(() => {
      localStorage.setItem('auth-token', 'mock-jwt-token');
    });
  });

  test('should display dashboard overview', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Check if dashboard components are visible
    await expect(page.locator('text=Dashboard')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-stats"]')).toBeVisible();
    await expect(page.locator('[data-testid="quick-url-widget"]')).toBeVisible();
  });

  test('should show URL shortener widget', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Check URL shortener form
    await expect(page.locator('input[placeholder*="Enter URL"]')).toBeVisible();
    await expect(page.locator('button:has-text("Shorten")')).toBeVisible();
  });

  test('should display recent activity feed', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Check if recent activity section exists
    await expect(page.locator('[data-testid="recent-activity"]')).toBeVisible();
  });

  test('should show top performing URLs', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Check if top URLs section exists
    await expect(page.locator('[data-testid="top-performing-urls"]')).toBeVisible();
  });

  test('should navigate to URL management', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Click on manage URLs link/button
    await page.click('text=Manage URLs');
    
    // Should navigate to URL management page
    await expect(page).toHaveURL('/dashboard/urls');
  });
});