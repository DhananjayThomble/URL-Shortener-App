import { test, expect } from '@playwright/test';

test.describe('URL Shortener', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication
    await page.addInitScript(() => {
      localStorage.setItem('auth-token', 'mock-jwt-token');
    });
  });

  test('should shorten a URL successfully', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Find URL input and enter a URL
    const urlInput = page.locator('input[placeholder*="Enter URL"]');
    await urlInput.fill('https://www.example.com');
    
    // Mock the API response
    await page.route('**/api/urls/shorten', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'abc123',
            originalUrl: 'https://www.example.com',
            shortUrl: 'https://snapurl.com/abc123',
            shortCode: 'abc123',
            clicks: 0,
            createdAt: new Date().toISOString()
          }
        })
      });
    });
    
    // Click shorten button
    await page.click('button:has-text("Shorten")');
    
    // Check if shortened URL is displayed
    await expect(page.locator('text=https://snapurl.com/abc123')).toBeVisible();
  });

  test('should show validation error for invalid URL', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Enter invalid URL
    const urlInput = page.locator('input[placeholder*="Enter URL"]');
    await urlInput.fill('invalid-url');
    
    // Click shorten button
    await page.click('button:has-text("Shorten")');
    
    // Check for validation error
    await expect(page.locator('text=Please enter a valid URL')).toBeVisible();
  });

  test('should copy shortened URL to clipboard', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Mock clipboard API
    await page.addInitScript(() => {
      Object.assign(navigator, {
        clipboard: {
          writeText: () => Promise.resolve(),
        },
      });
    });
    
    // First shorten a URL (mock the response)
    await page.route('**/api/urls/shorten', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            shortUrl: 'https://snapurl.com/abc123',
            shortCode: 'abc123'
          }
        })
      });
    });
    
    const urlInput = page.locator('input[placeholder*="Enter URL"]');
    await urlInput.fill('https://www.example.com');
    await page.click('button:has-text("Shorten")');
    
    // Wait for result and click copy button
    await page.waitForSelector('button:has-text("Copy")');
    await page.click('button:has-text("Copy")');
    
    // Check for success message
    await expect(page.locator('text=Copied to clipboard')).toBeVisible();
  });

  test('should generate QR code for shortened URL', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Mock API response for URL shortening
    await page.route('**/api/urls/shorten', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            shortUrl: 'https://snapurl.com/abc123',
            shortCode: 'abc123'
          }
        })
      });
    });
    
    // Shorten URL first
    const urlInput = page.locator('input[placeholder*="Enter URL"]');
    await urlInput.fill('https://www.example.com');
    await page.click('button:has-text("Shorten")');
    
    // Click QR code button
    await page.click('button:has-text("QR Code")');
    
    // Check if QR code is displayed
    await expect(page.locator('canvas')).toBeVisible();
  });
});