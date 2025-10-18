const axios = require('axios');
require('dotenv').config();

async function testRegistration() {
  try {
    console.log('Testing user registration...');
    
    const response = await axios.post('http://localhost:3000/api/v1/auth/register', {
      email: 'test@example.com',
      password: 'TestPassword123!',
      name: 'Test User'
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('✅ Registration successful!');
    console.log('Status:', response.status);
    console.log('User:', response.data.user);
    console.log('Token received:', response.data.access_token ? 'YES' : 'NO');
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.log('❌ Request timeout');
    } else if (error.response) {
      console.log('❌ Registration failed');
      console.log('Status:', error.response.status);
      console.log('Message:', error.response.data?.message);
      console.log('Full error:', error.response.data);
    } else {
      console.log('❌ Network error:', error.message);
    }
  }
}

testRegistration();