const { chromium } = require('playwright');

async function testSnapURLIntegration() {
  console.log('🚀 Starting SnapURL Integration Test...\n');
  
  const browser = await chromium.launch({ 
    headless: false, // Set to true for headless mode
    slowMo: 1000 // Slow down actions for better visibility
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Navigate to the application
    console.log('📱 Navigating to SnapURL application...');
    await page.goto('http://localhost:8081');
    await page.waitForLoadState('networkidle');
    
    // Take initial screenshot
    await page.screenshot({ path: 'test-screenshots/01-homepage.png' });
    console.log('✅ Homepage loaded successfully');
    
    // Test 1: Check if the page loads correctly
    const title = await page.title();
    console.log(`📄 Page title: ${title}`);
    
    // Test 2: Look for signup/login buttons
    console.log('\n🔍 Looking for authentication elements...');
    
    // Try to find signup button
    const signupButton = await page.locator('text=Sign Up').first();
    const loginButton = await page.locator('text=Login').first();
    const getStartedButton = await page.locator('text=Get Started').first();
    
    let authButton = null;
    if (await signupButton.isVisible()) {
      authButton = signupButton;
      console.log('✅ Found Sign Up button');
    } else if (await loginButton.isVisible()) {
      authButton = loginButton;
      console.log('✅ Found Login button');
    } else if (await getStartedButton.isVisible()) {
      authButton = getStartedButton;
      console.log('✅ Found Get Started button');
    }
    
    if (authButton) {
      await authButton.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'test-screenshots/02-auth-page.png' });
      console.log('✅ Navigated to authentication page');
    }
    
    // Test 3: Try to fill signup form
    console.log('\n📝 Testing signup process...');
    
    // Generate unique test data
    const timestamp = Date.now();
    const testEmail = `test${timestamp}@example.com`;
    const testPassword = 'TestPassword123!';
    const testName = `Test User ${timestamp}`;
    
    // Look for email input
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.isVisible()) {
      await emailInput.fill(testEmail);
      console.log(`✅ Filled email: ${testEmail}`);
    }
    
    // Look for password input
    const passwordInput = page.locator('input[type="password"]').first();
    if (await passwordInput.isVisible()) {
      await passwordInput.fill(testPassword);
      console.log('✅ Filled password');
    }
    
    // Look for name input
    const nameInput = page.locator('input[name="name"], input[placeholder*="name"], input[placeholder*="Name"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill(testName);
      console.log(`✅ Filled name: ${testName}`);
    }
    
    // Look for submit button
    const submitButton = page.locator('button[type="submit"], button:has-text("Sign Up"), button:has-text("Create Account")').first();
    if (await submitButton.isVisible()) {
      await page.screenshot({ path: 'test-screenshots/03-signup-form-filled.png' });
      
      // Monitor network requests
      page.on('response', response => {
        if (response.url().includes('/api/')) {
          console.log(`🌐 API Response: ${response.status()} ${response.url()}`);
        }
      });
      
      await submitButton.click();
      console.log('✅ Clicked signup button');
      
      // Wait for response
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'test-screenshots/04-after-signup.png' });
    }
    
    // Test 4: Check for success/error messages
    console.log('\n🔍 Checking for response messages...');
    
    const successMessage = await page.locator('text=success, text=Success, text=created, text=registered').first();
    const errorMessage = await page.locator('text=error, text=Error, text=failed, text=invalid').first();
    
    if (await successMessage.isVisible()) {
      const message = await successMessage.textContent();
      console.log(`✅ Success message: ${message}`);
    } else if (await errorMessage.isVisible()) {
      const message = await errorMessage.textContent();
      console.log(`❌ Error message: ${message}`);
    }
    
    // Test 5: Try to access dashboard or main functionality
    console.log('\n🏠 Looking for main application features...');
    
    // Look for URL shortening interface
    const urlInput = page.locator('input[placeholder*="url"], input[placeholder*="URL"], input[placeholder*="link"]').first();
    if (await urlInput.isVisible()) {
      console.log('✅ Found URL input field');
      
      // Test URL shortening
      const testUrl = 'https://www.example.com/very-long-url-that-needs-to-be-shortened';
      await urlInput.fill(testUrl);
      console.log(`✅ Filled URL: ${testUrl}`);
      
      const shortenButton = page.locator('button:has-text("Shorten"), button:has-text("Create"), button:has-text("Generate")').first();
      if (await shortenButton.isVisible()) {
        await page.screenshot({ path: 'test-screenshots/05-url-form-filled.png' });
        
        await shortenButton.click();
        console.log('✅ Clicked shorten button');
        
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'test-screenshots/06-after-shorten.png' });
        
        // Look for shortened URL result
        const shortUrl = await page.locator('input[readonly], code, pre, [data-testid*="short"], [class*="short"]').first();
        if (await shortUrl.isVisible()) {
          const result = await shortUrl.textContent();
          console.log(`✅ Generated short URL: ${result}`);
        }
      }
    }
    
    // Look for analytics/dashboard elements
    console.log('\n📊 Looking for analytics features...');
    
    const analyticsElements = await page.locator('text=Analytics, text=Stats, text=Dashboard, text=Clicks').count();
    if (analyticsElements > 0) {
      console.log(`✅ Found ${analyticsElements} analytics-related elements`);
    }
    
    // Final screenshot
    await page.screenshot({ path: 'test-screenshots/07-final-state.png' });
    
    console.log('\n🎉 Integration test completed successfully!');
    console.log('📸 Screenshots saved in test-screenshots/ directory');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'test-screenshots/error-state.png' });
  } finally {
    await browser.close();
  }
}

// Create screenshots directory
const fs = require('fs');
if (!fs.existsSync('test-screenshots')) {
  fs.mkdirSync('test-screenshots');
}

// Run the test
testSnapURLIntegration().catch(console.error);