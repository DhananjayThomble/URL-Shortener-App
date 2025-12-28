/**
 * Manual integration test for authentication service
 * This can be run in the browser console to test the auth service
 * Note: This is not a Jest test - it's for manual browser testing
 */

import { authService } from './auth.service';

// Test data
const testUser = {
  email: 'test@example.com',
  password: 'testpassword123',
  name: 'Test User'
};

/**
 * Manual test function that can be called from browser console
 * Usage: window.testAuthService()
 */
export const testAuthService = async () => {
  console.log('🧪 Starting Authentication Service Integration Test...');
  
  try {
    // Test 1: Check initial state
    console.log('📋 Test 1: Initial authentication state');
    console.log('Is authenticated:', authService.isAuthenticated());
    console.log('Current user:', authService.getCurrentUser());
    
    // Test 2: Test login with mock data (will fail with real backend, but tests the flow)
    console.log('\n📋 Test 2: Login flow test');
    try {
      const loginResult = await authService.login(testUser.email, testUser.password);
      console.log('Login result:', loginResult);
      
      if (loginResult.success) {
        console.log('✅ Login successful');
        console.log('User:', loginResult.data?.user);
        console.log('Tokens:', loginResult.data?.tokens);
        
        // Test 3: Check authenticated state
        console.log('\n📋 Test 3: Post-login authentication state');
        console.log('Is authenticated:', authService.isAuthenticated());
        console.log('Current user:', authService.getCurrentUser());
        
        // Test 4: Test logout
        console.log('\n📋 Test 4: Logout flow test');
        await authService.logout();
        console.log('✅ Logout completed');
        console.log('Is authenticated after logout:', authService.isAuthenticated());
        console.log('Current user after logout:', authService.getCurrentUser());
        
      } else {
        console.log('❌ Login failed (expected with mock backend):', loginResult.error);
      }
    } catch (error) {
      console.log('❌ Login error (expected with mock backend):', error);
    }
    
    // Test 5: Test registration flow
    console.log('\n📋 Test 5: Registration flow test');
    try {
      const registerResult = await authService.register(testUser.email, testUser.password, testUser.name);
      console.log('Registration result:', registerResult);
      
      if (registerResult.success) {
        console.log('✅ Registration successful');
      } else {
        console.log('❌ Registration failed (expected with mock backend):', registerResult.error);
      }
    } catch (error) {
      console.log('❌ Registration error (expected with mock backend):', error);
    }
    
    // Test 6: Test token refresh (will fail without valid tokens)
    console.log('\n📋 Test 6: Token refresh test');
    try {
      const refreshResult = await authService.refreshToken();
      console.log('✅ Token refresh successful:', refreshResult);
    } catch (error) {
      console.log('❌ Token refresh failed (expected without valid tokens):', error);
    }
    
    console.log('\n🎉 Authentication Service Integration Test Complete!');
    console.log('Note: Some failures are expected when testing without a real backend connection.');
    
  } catch (error) {
    console.error('💥 Test suite failed:', error);
  }
};

// Make test function available globally for browser console testing
if (typeof window !== 'undefined') {
  (window as any).testAuthService = testAuthService;
}

// Export for potential use in other tests
export default testAuthService;