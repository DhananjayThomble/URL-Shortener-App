const { chromium } = require('playwright');

async function testAPIIntegration() {
  console.log('🚀 Starting SnapURL API Integration Test...\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Track API calls
  const apiCalls = [];
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      apiCalls.push({
        url: response.url(),
        status: response.status(),
        method: response.request().method()
      });
      console.log(`🌐 API ${response.request().method()}: ${response.status()} ${response.url()}`);
    }
  });

  // Track console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`❌ Console Error: ${msg.text()}`);
    }
  });

  try {
    // Step 1: Navigate to application
    console.log('📱 Step 1: Loading SnapURL application...');
    await page.goto('http://localhost:8081');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-screenshots/api-01-homepage.png' });
    console.log('✅ Homepage loaded');

    // Step 2: Navigate to login/signup
    console.log('\n🔐 Step 2: Testing authentication flow...');
    
    // Look for auth buttons
    const authButtons = [
      'text=Sign Up',
      'text=Login', 
      'text=Get Started',
      'button:has-text("Sign Up")',
      'button:has-text("Login")',
      'button:has-text("Get Started")',
      '[data-testid="auth-button"]',
      'a[href*="login"]',
      'a[href*="signup"]'
    ];

    let foundAuthButton = false;
    for (const selector of authButtons) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 1000 })) {
          console.log(`✅ Found auth button: ${selector}`);
          await button.click();
          foundAuthButton = true;
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (!foundAuthButton) {
      console.log('⚠️ No auth button found, checking if already on auth page...');
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-screenshots/api-02-auth-page.png' });

    // Step 3: Test login with existing user
    console.log('\n📝 Step 3: Testing login with existing user...');
    
    // Generate unique test data
    const testEmail = 'test@example.com'; // Use existing user
    const testPassword = 'TestPassword123!';

    // Fill login form
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      '[data-testid="email-input"]'
    ];

    let emailFilled = false;
    for (const selector of emailSelectors) {
      try {
        const input = page.locator(selector).first();
        if (await input.isVisible({ timeout: 1000 })) {
          await input.fill(testEmail);
          console.log(`✅ Filled email using: ${selector}`);
          emailFilled = true;
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      '[data-testid="password-input"]'
    ];

    let passwordFilled = false;
    for (const selector of passwordSelectors) {
      try {
        const input = page.locator(selector).first();
        if (await input.isVisible({ timeout: 1000 })) {
          await input.fill(testPassword);
          console.log(`✅ Filled password using: ${selector}`);
          passwordFilled = true;
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (!emailFilled || !passwordFilled) {
      console.log('⚠️ Could not find login form fields');
    }

    await page.screenshot({ path: 'test-screenshots/api-03-login-form-filled.png' });

    // Submit login form
    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Sign In")',
      'button:has-text("Submit")',
      '[data-testid="login-button"]'
    ];

    let loginSubmitted = false;
    for (const selector of submitSelectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 1000 })) {
          console.log(`✅ Found submit button: ${selector}`);
          await button.click();
          loginSubmitted = true;
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (loginSubmitted) {
      console.log('✅ Login form submitted');
      await page.waitForTimeout(3000); // Wait for API response
      await page.screenshot({ path: 'test-screenshots/api-04-after-login.png' });
    }

    // Step 4: Check for successful authentication
    console.log('\n🔍 Step 4: Checking authentication result...');
    
    // Look for success indicators
    const successIndicators = [
      'text=Dashboard',
      'text=Welcome',
      'text=Logout',
      'text=Profile',
      '[data-testid="user-menu"]',
      '[data-testid="dashboard"]'
    ];

    let authSuccess = false;
    for (const selector of successIndicators) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          console.log(`✅ Authentication success indicator found: ${selector}`);
          authSuccess = true;
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Step 5: Test URL shortening functionality
    if (authSuccess) {
      console.log('\n🔗 Step 5: Testing URL shortening...');
      
      const urlInputSelectors = [
        'input[placeholder*="url" i]',
        'input[placeholder*="link" i]',
        'input[name="url"]',
        'input[type="url"]',
        '[data-testid="url-input"]'
      ];

      const testUrl = 'https://www.example.com/very-long-url-that-needs-to-be-shortened-for-testing';
      
      let urlInputFound = false;
      for (const selector of urlInputSelectors) {
        try {
          const input = page.locator(selector).first();
          if (await input.isVisible({ timeout: 2000 })) {
            await input.fill(testUrl);
            console.log(`✅ Filled URL input using: ${selector}`);
            urlInputFound = true;
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (urlInputFound) {
        const shortenButtonSelectors = [
          'button:has-text("Shorten")',
          'button:has-text("Create")',
          'button:has-text("Generate")',
          'button[type="submit"]',
          '[data-testid="shorten-button"]'
        ];

        for (const selector of shortenButtonSelectors) {
          try {
            const button = page.locator(selector).first();
            if (await button.isVisible({ timeout: 1000 })) {
              console.log(`✅ Found shorten button: ${selector}`);
              await button.click();
              await page.waitForTimeout(3000);
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }

        await page.screenshot({ path: 'test-screenshots/api-05-url-shortened.png' });
      }
    }

    // Step 6: Final analysis
    console.log('\n📊 Step 6: API Integration Analysis...');
    
    const loginCalls = apiCalls.filter(call => call.url.includes('/auth/login'));
    const registerCalls = apiCalls.filter(call => call.url.includes('/auth/register'));
    const urlCalls = apiCalls.filter(call => call.url.includes('/urls'));
    const healthCalls = apiCalls.filter(call => call.url.includes('/health'));

    console.log(`\n📈 API Call Summary:`);
    console.log(`- Health checks: ${healthCalls.length}`);
    console.log(`- Login attempts: ${loginCalls.length}`);
    console.log(`- Register attempts: ${registerCalls.length}`);
    console.log(`- URL operations: ${urlCalls.length}`);
    console.log(`- Total API calls: ${apiCalls.length}`);

    // Check for successful API responses
    const successfulCalls = apiCalls.filter(call => call.status >= 200 && call.status < 300);
    const errorCalls = apiCalls.filter(call => call.status >= 400);

    console.log(`\n✅ Successful API calls: ${successfulCalls.length}`);
    console.log(`❌ Error API calls: ${errorCalls.length}`);

    if (errorCalls.length > 0) {
      console.log('\n❌ API Errors detected:');
      errorCalls.forEach(call => {
        console.log(`  - ${call.method} ${call.url}: ${call.status}`);
      });
    }

    await page.screenshot({ path: 'test-screenshots/api-06-final-state.png' });

    console.log('\n🎉 API Integration test completed!');
    
    // Return test results
    return {
      success: true,
      apiCalls: apiCalls.length,
      successfulCalls: successfulCalls.length,
      errorCalls: errorCalls.length,
      authenticationTested: loginCalls.length > 0,
      urlShorteningTested: urlCalls.length > 0
    };

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'test-screenshots/api-error-state.png' });
    return {
      success: false,
      error: error.message,
      apiCalls: apiCalls.length
    };
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
testAPIIntegration()
  .then(result => {
    console.log('\n📋 Test Results:', JSON.stringify(result, null, 2));
  })
  .catch(console.error);