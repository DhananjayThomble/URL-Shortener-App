import { test, expect } from '@playwright/test';

/**
 * E2E Integration Tests with Backend API
 * 
 * These tests verify the integration between the Next.js frontend and NestJS backend
 * by making real API calls to the backend services.
 * 
 * Prerequisites:
 * - Backend server should be running on http://localhost:3000
 * - Frontend dev server should be running on http://localhost:3001
 * - Database should be accessible
 */

const API_BASE_URL = 'http://localhost:3000/api/v1';
const TEST_USER = {
  email: `test-${Date.now()}@example.com`,
  password: 'Test123!@#',
  name: 'E2E Test User',
};

test.describe('API Integration Tests', () => {
  test.describe.configure({ mode: 'serial' }); // Run tests in order
  
  let authToken: string;
  let refreshToken: string;
  let userId: string;
  let urlId: string;

  test('1. User Registration', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/auth/register`, {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
        name: TEST_USER.name,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data).toHaveProperty('access_token');
    expect(data).toHaveProperty('refresh_token');
    expect(data).toHaveProperty('user');
    expect(data.user.email).toBe(TEST_USER.email);
    
    authToken = data.access_token;
    refreshToken = data.refresh_token;
    userId = data.user.id;
    
    console.log('✓ User registered successfully');
  });

  test('2. User Login', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/auth/login`, {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data).toHaveProperty('access_token');
    expect(data).toHaveProperty('refresh_token');
    expect(data).toHaveProperty('user');
    
    authToken = data.access_token;
    refreshToken = data.refresh_token;
    
    console.log('✓ User logged in successfully');
  });

  test('3. Get User Profile (POST /auth/profile)', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/auth/profile`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const user = await response.json();
    
    expect(user.email).toBe(TEST_USER.email);
    expect(user.name).toBe(TEST_USER.name);
    
    console.log('✓ User profile retrieved successfully');
  });

  test('4. Create URL', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/urls`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: {
        originalUrl: 'https://www.example.com',
        title: 'Example Website',
        tags: ['example', 'test'],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('shortCode');
    expect(data.originalUrl).toBe('https://www.example.com');
    
    urlId = data.id;
    
    console.log('✓ URL created successfully:', data.shortCode);
  });

  test('5. Get URL by ID', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/urls/${urlId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.id).toBe(urlId);
    expect(data.originalUrl).toBe('https://www.example.com');
    
    console.log('✓ URL retrieved by ID successfully');
  });

  test('6. Update URL (PATCH)', async ({ request }) => {
    const response = await request.patch(`${API_BASE_URL}/urls/${urlId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: {
        title: 'Updated Example Website',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.title).toBe('Updated Example Website');
    
    console.log('✓ URL updated successfully');
  });

  test('7. Get User URLs List', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/urls?page=1&limit=10`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data).toHaveProperty('data');
    expect(Array.isArray(data.data)).toBeTruthy();
    expect(data.data.length).toBeGreaterThan(0);
    
    console.log('✓ URLs list retrieved successfully');
  });

  test('8. Set URL Password', async ({ request }) => {
    const response = await request.put(`${API_BASE_URL}/urls/${urlId}/password`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: {
        password: 'SecurePass123',
      },
    });

    expect(response.ok()).toBeTruthy();
    
    console.log('✓ URL password set successfully');
  });

  test('9. Get URL Analytics', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/urls/${urlId}/analytics?period=7d`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data).toHaveProperty('clicks');
    
    console.log('✓ URL analytics retrieved successfully');
  });

  test('10. Deactivate URL', async ({ request }) => {
    const response = await request.put(`${API_BASE_URL}/urls/${urlId}/deactivate`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    
    console.log('✓ URL deactivated successfully');
  });

  test('11. Reactivate URL', async ({ request }) => {
    const response = await request.put(`${API_BASE_URL}/urls/${urlId}/reactivate`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    
    console.log('✓ URL reactivated successfully');
  });

  test('12. Update User Profile', async ({ request }) => {
    const response = await request.patch(`${API_BASE_URL}/users/profile`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: {
        name: 'Updated Test User',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.name).toBe('Updated Test User');
    
    console.log('✓ User profile updated successfully');
  });

  test('13. Refresh Access Token', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/auth/refresh`, {
      data: {
        refresh_token: refreshToken,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data).toHaveProperty('access_token');
    
    authToken = data.access_token;
    
    console.log('✓ Access token refreshed successfully');
  });

  test('14. Delete URL', async ({ request }) => {
    const response = await request.delete(`${API_BASE_URL}/urls/${urlId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    
    console.log('✓ URL deleted successfully');
  });

  test('15. Logout', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/auth/logout`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: {
        refresh_token: refreshToken,
      },
    });

    expect(response.ok()).toBeTruthy();
    
    console.log('✓ User logged out successfully');
  });

  test('16. Verify Token is Invalid After Logout', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/auth/profile`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    // Should fail after logout
    expect(response.status()).toBe(401);
    
    console.log('✓ Token correctly invalidated after logout');
  });
});

test.describe('Error Handling Tests', () => {
  test('Invalid Login Credentials', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/auth/login`, {
      data: {
        email: 'nonexistent@example.com',
        password: 'WrongPassword123',
      },
    });

    expect(response.status()).toBe(401);
    
    console.log('✓ Invalid credentials correctly rejected');
  });

  test('Missing Required Fields', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/auth/register`, {
      data: {
        email: 'test@example.com',
        // Missing password and name
      },
    });

    expect(response.status()).toBe(400);
    
    console.log('✓ Missing fields correctly validated');
  });

  test('Unauthorized Access', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/urls`);

    expect(response.status()).toBe(401);
    
    console.log('✓ Unauthorized access correctly blocked');
  });

  test('Invalid URL Format', async ({ request }) => {
    // First login to get a valid token
    const loginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    });

    const { access_token } = await loginResponse.json();

    const response = await request.post(`${API_BASE_URL}/urls`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
      data: {
        originalUrl: 'not-a-valid-url',
      },
    });

    expect(response.status()).toBe(400);
    
    console.log('✓ Invalid URL format correctly rejected');
  });
});

test.describe('Bulk Operations Tests', () => {
  let authToken: string;

  test.beforeAll(async ({ request }) => {
    // Login to get auth token
    const response = await request.post(`${API_BASE_URL}/auth/login`, {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    });

    if (response.ok()) {
      const data = await response.json();
      authToken = data.access_token;
    }
  });

  test('Bulk Create URLs', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }

    const response = await request.post(`${API_BASE_URL}/urls/bulk`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: [
        {
          originalUrl: 'https://www.google.com',
          title: 'Google',
        },
        {
          originalUrl: 'https://www.github.com',
          title: 'GitHub',
        },
      ],
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBe(2);
    
    console.log('✓ Bulk URL creation successful');
  });
});
