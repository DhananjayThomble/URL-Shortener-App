const { chromium } = require('playwright');

async function testURLCreation() {
  console.log('🚀 Testing URL Creation Flow...\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000
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

  // Track console messages
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`❌ Console Error: ${msg.text()}`);
    } else if (msg.type() === 'warn') {
      console.log(`⚠️ Console Warning: ${msg.text()}`);
    }
  });

  try {
    // Step 1: Navigate and login
    console.log('📱 Step 1: Loading and logging in...');
    await page.goto('http://localhost:8081');
    await page.waitForLoadState('networkidle');
    
    // Find and click auth button
    const authButton = page.locator('text=Get Started').first();
    if (await authButton.isVisible()) {
      await authButton.click();
      await page.waitForTimeout(1000);
    }

    // Login
    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const submitButton = page.locator('button[type="submit"]').first();

    if (await emailInput.isVisible() && await passwordInput.isVisible()) {
      await emailInput.fill('test@example.com');
      await passwordInput.fill('TestPassword123!');
      await submitButton.click();
      await page.waitForTimeout(3000);
      console.log('✅ Login completed');
    }

    await page.screenshot({ path: 'test-screenshots/url-01-logged-in.png' });

    // Step 2: Test URL creation
    console.log('\n🔗 Step 2: Testing URL creation...');
    
    const testUrl = 'https://www.example.com/very-long-test-url-for-integration-testing';
    
    // Find URL input
    const urlInputSelectors = [
      'input[placeholder*="url" i]',
      'input[placeholder*="link" i]',
      'input[name="url"]',
      'input[type="url"]',
      '[data-testid="url-input"]'
    ];

    let urlInput = null;
    for (const selector of urlInputSelectors) {
      try {
        const input = page.locator(selector).first();
        if (await input.isVisible({ timeout: 2000 })) {
          urlInput = input;
          console.log(`✅ Found URL input: ${selector}`);
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (urlInput) {
      await urlInput.fill(testUrl);
      console.log(`✅ Filled URL: ${testUrl}`);
      
      await page.screenshot({ path: 'test-screenshots/url-02-form-filled.png' });

      // Find and click create button
      const createButtonSelectors = [
        'button:has-text("Create")',
        'button:has-text("Shorten")',
        'button:has-text("Generate")',
        'button[type="submit"]',
        '[data-testid="create-button"]'
      ];

      let createButton = null;
      for (const selector of createButtonSelectors) {
        try {
          const button = page.locator(selector).first();
          if (await button.isVisible({ timeout: 1000 })) {
            createButton = button;
            console.log(`✅ Found create button: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (createButton) {
        console.log('🔄 Clicking create button...');
        await createButton.click();
        
        // Wait for response
        await page.waitForTimeout(5000);
        
        await page.screenshot({ path: 'test-screenshots/url-03-after-create.png' });

        // Check for success or error messages
        const successSelectors = [
          'text=created',
          'text=success',
          'text=generated',
          '[data-testid="success-message"]'
        ];

        const errorSelectors = [
          'text=error',
          'text=failed',
          'text=unavailable',
          '[data-testid="error-message"]'
        ];

        let result = 'unknown';
        
        // Check for success
        for (const selector of successSelectors) {
          try {
            const element = page.locator(selector).first();
            if (await element.isVisible({ timeout: 1000 })) {
              const text = await element.textContent();
              console.log(`✅ Success message: ${text}`);
              result = 'success';
              break;
            }
          } catch (e) {
            // Continue
          }
        }

        // Check for errors if no success found
        if (result === 'unknown') {
          for (const selector of errorSelectors) {
            try {
              const element = page.locator(selector).first();
              if (await element.isVisible({ timeout: 1000 })) {
                const text = await element.textContent();
                console.log(`❌ Error message: ${text}`);
                result = 'error';
                break;
              }
            } catch (e) {
              // Continue
            }
          }
        }

        // Look for shortened URL result
        const shortUrlSelectors = [
          'input[readonly]',
          'code',
          'pre',
          '[data-testid*="short"]',
          '[class*="short"]'
        ];

        for (const selector of shortUrlSelectors) {
          try {
            const element = page.locator(selector).first();
            if (await element.isVisible({ timeout: 1000 })) {
              const value = await element.inputValue().catch(() => element.textContent());
              if (value && (value.includes('http') || value.includes('snap.url'))) {
                console.log(`✅ Generated short URL: ${value}`);
                result = 'success';
                break;
              }
            }
          } catch (e) {
            // Continue
          }
        }

        console.log(`\n📊 URL Creation Result: ${result}`);
      } else {
        console.log('❌ Could not find create button');
      }
    } else {
      console.log('❌ Could not find URL input field');
    }

    // Step 3: Check dashboard state
    console.log('\n📈 Step 3: Checking dashboard state...');
    
    // Look for analytics data or fallback messages
    const analyticsElements = await page.locator('text=analytics, text=Analytics, text=clicks, text=Clicks').count();
    console.log(`📊 Found ${analyticsElements} analytics-related elements`);

    // Check for error boundaries or fallback UI
    const errorBoundaries = await page.locator('text=something went wrong, text=error occurred, text=try again').count();
    if (errorBoundaries > 0) {
      console.log(`⚠️ Found ${errorBoundaries} error boundary elements`);
    }

    await page.screenshot({ path: 'test-screenshots/url-04-final-dashboard.png' });

    // Final analysis
    console.log('\n📋 Final Analysis:');
    
    const urlCreationCalls = apiCalls.filter(call => call.url.includes('/urls') && call.method === 'POST');
    const analyticsCalls = apiCalls.filter(call => call.url.includes('/analytics'));
    
    console.log(`- URL creation attempts: ${urlCreationCalls.length}`);
    console.log(`- Analytics calls: ${analyticsCalls.length}`);
    console.log(`- Total API calls: ${apiCalls.length}`);
    
    if (urlCreationCalls.length > 0) {
      const lastUrlCall = urlCreationCalls[urlCreationCalls.length - 1];
      console.log(`- Last URL creation status: ${lastUrlCall.status}`);
    }

    const successfulCalls = apiCalls.filter(call => call.status >= 200 && call.status < 300);
    const errorCalls = apiCalls.filter(call => call.status >= 400);
    
    console.log(`- Successful calls: ${successfulCalls.length}`);
    console.log(`- Error calls: ${errorCalls.length}`);

    return {
      success: true,
      urlCreationAttempted: urlCreationCalls.length > 0,
      urlCreationSuccessful: urlCreationCalls.some(call => call.status >= 200 && call.status < 300),
      analyticsWorking: analyticsCalls.some(call => call.status >= 200 && call.status < 300),
      totalApiCalls: apiCalls.length,
      successfulCalls: successfulCalls.length,
      errorCalls: errorCalls.length
    };

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'test-screenshots/url-error-state.png' });
    return {
      success: false,
      error: error.message
    };
  } finally {
    await browser.close();
  }
}

// Run the test
testURLCreation()
  .then(result => {
    console.log('\n🎯 Test Results:', JSON.stringify(result, null, 2));
  })
  .catch(console.error);