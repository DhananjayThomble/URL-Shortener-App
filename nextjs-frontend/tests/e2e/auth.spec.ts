import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should display home page and navigate to login', async ({ page }) => {
    await page.goto('/');
    
    // Wait for page to load completely
    await page.waitForLoadState('networkidle');
    
    // Check if home page loads
    await expect(page.locator('h1:has-text("SnapURL")')).toBeVisible();
    await expect(page.locator('text=Shorten URLs with Style')).toBeVisible();
    
    // Click Sign In button
    await page.click('text=Sign In');
    
    // Should navigate to login page
    await expect(page).toHaveURL('/login');
  });

  test('should display login page', async ({ page }) => {
    await page.goto('/login');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Check if login page elements are visible
    await expect(page.locator('text=Welcome Back')).toBeVisible();
    await expect(page.locator('text=Sign in to your SnapURL account')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible();
  });

  test('should navigate from home to register page', async ({ page }) => {
    await page.goto('/');
    
    // Click Get Started button
    await page.click('text=Get Started');
    
    // Should navigate to register page
    await expect(page).toHaveURL('/register');
  });

  test('should display register page with all fields', async ({ page }) => {
    await page.goto('/register');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Check if registration form is present
    await expect(page.locator('text=Create Account')).toBeVisible();
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Create Account")')).toBeVisible();
  });

  test('should display forgot password page', async ({ page }) => {
    await page.goto('/forgot-password');
    
    // Check if forgot password form is present
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('should display verify email page', async ({ page }) => {
    await page.goto('/verify-email');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Check if verify email page loads (it might have different content)
    const hasVerifyText = await page.locator('text=Verify').isVisible();
    const hasEmailText = await page.locator('text=Email').isVisible();
    const hasVerificationText = await page.locator('text=Verification').isVisible();
    
    expect(hasVerifyText || hasEmailText || hasVerificationText).toBeTruthy();
  });

  test('should navigate between auth pages', async ({ page }) => {
    // Start at login
    await page.goto('/login');
    
    // Navigate to register
    await page.click('text=Sign up');
    await expect(page).toHaveURL('/register');
    
    // Navigate back to login
    await page.click('text=Sign in');
    await expect(page).toHaveURL('/login');
  });
});