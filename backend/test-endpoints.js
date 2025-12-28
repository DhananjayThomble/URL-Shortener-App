const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'http://localhost:3000';
const API_PREFIX = 'api/v1';

async function testEndpoints() {
  console.log('🧪 Testing NestJS URL Shortener Endpoints\n');
  
  let authToken = null;
  let testUserId = null;
  let testUrlId = null;
  let testShortCode = null;

  // Test 1: Health Endpoints
  console.log('1. Testing Health Endpoints:');
  try {
    const health = await axios.get(`${BASE_URL}/${API_PREFIX}/health`);
    console.log('✅ Health endpoint:', health.status === 200 ? 'PASS' : 'FAIL');
    
    const ready = await axios.get(`${BASE_URL}/${API_PREFIX}/health/ready`);
    console.log('✅ Ready endpoint:', ready.status === 200 ? 'PASS' : 'FAIL');
    
    const live = await axios.get(`${BASE_URL}/${API_PREFIX}/health/live`);
    console.log('✅ Live endpoint:', live.status === 200 ? 'PASS' : 'FAIL');
  } catch (error) {
    console.log('❌ Health endpoints failed:', error.message);
  }

  // Test 2: API Info
  console.log('\n2. Testing API Info:');
  try {
    const info = await axios.get(`${BASE_URL}/${API_PREFIX}`);
    console.log('✅ API info endpoint:', info.status === 200 ? 'PASS' : 'FAIL');
    console.log('   Response:', info.data.message);
  } catch (error) {
    console.log('❌ API info failed:', error.message);
  }

  // Test 3: Metrics
  console.log('\n3. Testing Metrics:');
  try {
    const metrics = await axios.get(`${BASE_URL}/${API_PREFIX}/metrics`);
    console.log('✅ Metrics endpoint:', metrics.status === 200 ? 'PASS' : 'FAIL');
    console.log('   Metrics format:', metrics.data.includes('# HELP') ? 'Prometheus format' : 'Custom format');
  } catch (error) {
    console.log('❌ Metrics failed:', error.message);
  }

  // Test 4: User Registration
  console.log('\n4. Testing User Registration:');
  try {
    const registerData = {
      email: 'test@example.com',
      password: 'TestPassword123!',
      name: 'Test User'
    };
    
    const register = await axios.post(`${BASE_URL}/${API_PREFIX}/auth/register`, registerData);
    console.log('✅ User registration:', register.status === 201 ? 'PASS' : 'FAIL');
    
    if (register.data.access_token) {
      authToken = register.data.access_token;
      testUserId = register.data.user.id;
      console.log('   Auth token received:', authToken ? 'YES' : 'NO');
      console.log('   User ID:', testUserId);
    }
  } catch (error) {
    console.log('❌ User registration failed:', error.response?.data?.message || error.message);
    
    // Try login instead if user already exists
    try {
      const loginData = {
        email: 'test@example.com',
        password: 'TestPassword123!'
      };
      
      const login = await axios.post(`${BASE_URL}/${API_PREFIX}/auth/login`, loginData);
      console.log('✅ User login (fallback):', login.status === 200 ? 'PASS' : 'FAIL');
      
      if (login.data.access_token) {
        authToken = login.data.access_token;
        testUserId = login.data.user.id;
        console.log('   Auth token received:', authToken ? 'YES' : 'NO');
      }
    } catch (loginError) {
      console.log('❌ Login fallback failed:', loginError.response?.data?.message || loginError.message);
    }
  }

  // Test 5: User Profile (requires auth)
  if (authToken) {
    console.log('\n5. Testing User Profile:');
    try {
      const profile = await axios.get(`${BASE_URL}/${API_PREFIX}/users/profile`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('✅ User profile:', profile.status === 200 ? 'PASS' : 'FAIL');
      console.log('   User email:', profile.data.email);
    } catch (error) {
      console.log('❌ User profile failed:', error.response?.data?.message || error.message);
    }
  }

  // Test 6: URL Creation (requires auth)
  if (authToken) {
    console.log('\n6. Testing URL Creation:');
    try {
      const urlData = {
        originalUrl: 'https://www.example.com',
        category: 'test'
      };
      
      const createUrl = await axios.post(`${BASE_URL}/${API_PREFIX}/urls`, urlData, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('✅ URL creation:', createUrl.status === 201 ? 'PASS' : 'FAIL');
      
      if (createUrl.data) {
        testUrlId = createUrl.data._id;
        testShortCode = createUrl.data.shortCode;
        console.log('   Short code:', testShortCode);
        console.log('   URL ID:', testUrlId);
      }
    } catch (error) {
      console.log('❌ URL creation failed:', error.response?.data?.message || error.message);
    }
  }

  // Test 7: URL Listing (requires auth)
  if (authToken) {
    console.log('\n7. Testing URL Listing:');
    try {
      const urls = await axios.get(`${BASE_URL}/${API_PREFIX}/urls`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('✅ URL listing:', urls.status === 200 ? 'PASS' : 'FAIL');
      console.log('   URLs count:', urls.data.urls?.length || 0);
    } catch (error) {
      console.log('❌ URL listing failed:', error.response?.data?.message || error.message);
    }
  }

  // Test 8: URL Redirection (public)
  if (testShortCode) {
    console.log('\n8. Testing URL Redirection:');
    try {
      const redirect = await axios.get(`${BASE_URL}/${API_PREFIX}/${testShortCode}`, {
        maxRedirects: 0,
        validateStatus: (status) => status === 302 || status === 301
      });
      console.log('✅ URL redirection:', redirect.status === 302 ? 'PASS' : 'FAIL');
      console.log('   Redirect location:', redirect.headers.location);
    } catch (error) {
      if (error.response && (error.response.status === 301 || error.response.status === 302)) {
        console.log('✅ URL redirection: PASS');
        console.log('   Redirect location:', error.response.headers.location);
      } else {
        console.log('❌ URL redirection failed:', error.response?.data?.message || error.message);
      }
    }
  }

  // Test 9: URL Analytics (requires auth)
  if (authToken && testUrlId) {
    console.log('\n9. Testing URL Analytics:');
    try {
      const analytics = await axios.get(`${BASE_URL}/${API_PREFIX}/urls/${testUrlId}/analytics`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('✅ URL analytics:', analytics.status === 200 ? 'PASS' : 'FAIL');
      console.log('   Total clicks:', analytics.data.url?.totalClicks || 0);
    } catch (error) {
      console.log('❌ URL analytics failed:', error.response?.data?.message || error.message);
    }
  }

  // Test 10: Cache Endpoints
  console.log('\n10. Testing Cache Endpoints:');
  try {
    const cacheHealth = await axios.get(`${BASE_URL}/${API_PREFIX}/cache/health`);
    console.log('✅ Cache health:', cacheHealth.status === 200 ? 'PASS' : 'FAIL');
    
    const cacheStats = await axios.get(`${BASE_URL}/${API_PREFIX}/cache/stats`);
    console.log('✅ Cache stats:', cacheStats.status === 200 ? 'PASS' : 'FAIL');
  } catch (error) {
    console.log('❌ Cache endpoints failed:', error.response?.data?.message || error.message);
  }

  // Test 11: Admin Endpoints (without auth - should fail)
  console.log('\n11. Testing Admin Endpoints (unauthorized):');
  try {
    const adminDashboard = await axios.get(`${BASE_URL}/${API_PREFIX}/admin/dashboard`);
    console.log('❌ Admin dashboard should be protected:', adminDashboard.status === 200 ? 'SECURITY ISSUE' : 'PASS');
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.log('✅ Admin dashboard properly protected: PASS');
    } else {
      console.log('❌ Admin dashboard test failed:', error.message);
    }
  }

  // Test 12: Rate Limiting
  console.log('\n12. Testing Rate Limiting:');
  try {
    const requests = [];
    for (let i = 0; i < 20; i++) {
      requests.push(axios.get(`${BASE_URL}/${API_PREFIX}/health`, { validateStatus: () => true }));
    }
    
    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status === 429);
    
    if (rateLimited.length > 0) {
      console.log('✅ Rate limiting working:', rateLimited.length, 'requests rate limited');
    } else {
      console.log('⚠️  Rate limiting not triggered (may be configured with high limits)');
    }
  } catch (error) {
    console.log('❌ Rate limiting test failed:', error.message);
  }

  console.log('\n🎯 Endpoint Testing Complete!');
}

testEndpoints().catch(console.error);