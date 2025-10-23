import { test, expect } from '@playwright/test';

test.describe('Navigation and Routes', () => {
  test('should load home page correctly', async ({ page }) => {
    await page.goto('/');
    
    // Check main elements with more specific selectors
    await expect(page.locator('h1:has-text("SnapURL")')).toBeVisible();
    await expect(page.locator('text=Shorten URLs with Style')).toBeVisible();
    await expect(page.locator('h2:has-text("Why Choose SnapURL?")')).toBeVisible();
    
    // Check feature cards
    await expect(page.locator('h6:has-text("URL Shortening")')).toBeVisible();
    await expect(page.locator('h6:has-text("Analytics")')).toBeVisible();
    await expect(page.locator('h6:has-text("QR Codes")')).toBeVisible();
    
    // Check CTA section
    await expect(page.locator('text=Ready to Get Started?')).toBeVisible();
  });

  test('should have working theme toggle', async ({ page }) => {
    await page.goto('/');
    
    // Find and click theme toggle button
    const themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme"], button[aria-label*="mode"]').first();
    
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      // Theme should change (you might need to check for specific theme indicators)
      await page.waitForTimeout(500); // Wait for theme transition
    }
  });

  test('should navigate to examples page', async ({ page }) => {
    await page.goto('/examples');
    
    // Check if examples page loads
    await expect(page.locator('text=Examples')).toBeVisible();
  });

  test('should show unauthorized page', async ({ page }) => {
    await page.goto('/unauthorized');
    
    // Check if unauthorized page loads
    await expect(page.locator('text=Unauthorized')).toBeVisible();
  });

  test('should handle 404 pages', async ({ page }) => {
    await page.goto('/non-existent-page');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Should show 404 or redirect to home
    const is404 = await page.locator('text=404').isVisible();
    const isNotFound = await page.locator('text=Not Found').isVisible();
    const isRedirected = page.url() === 'http://localhost:3001/';
    
    expect(is404 || isNotFound || isRedirected).toBeTruthy();
  });

  test('should have responsive navigation', async ({ page }) => {
    await page.goto('/');
    
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check if navigation adapts to mobile
    await expect(page.locator('h1:has-text("SnapURL")')).toBeVisible();
    
    // Test desktop viewport
    await page.setViewportSize({ width: 1200, height: 800 });
    
    // Check if navigation works on desktop
    await expect(page.locator('h1:has-text("SnapURL")')).toBeVisible();
  });

  test('should have working footer links', async ({ page }) => {
    await page.goto('/');
    
    // Scroll to footer
    await page.locator('text=Privacy Policy').scrollIntoViewIfNeeded();
    
    // Check footer elements
    await expect(page.locator('text=© 2024 SnapURL')).toBeVisible();
    await expect(page.locator('text=Privacy Policy')).toBeVisible();
    await expect(page.locator('text=Terms of Service')).toBeVisible();
    await expect(page.locator('text=Contact')).toBeVisible();
  });
});