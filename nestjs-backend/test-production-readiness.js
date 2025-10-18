const axios = require('axios');
const colors = require('colors');
require('dotenv').config();

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_PREFIX = process.env.API_PREFIX || 'api/v1';
const TIMEOUT = 10000; // 10 seconds

// Test results tracking
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// Helper functions
function log(message, type = 'info') {
    totalTests++;
    const timestamp = new Date().toISOString();

    switch (type) {
        case 'success':
            console.log(`[${timestamp}] ✅ ${message}`.green);
            passedTests++;
            break;
        case 'error':
            console.log(`[${timestamp}] ❌ ${message}`.red);
            failedTests++;
            break;
        case 'warning':
            console.log(`[${timestamp}] ⚠️  ${message}`.yellow);
            break;
        case 'info':
        default:
            console.log(`[${timestamp}] ℹ️  ${message}`.blue);
            break;
    }
}

function logSection(title) {
    console.log(`\n${'='.repeat(60)}`.cyan);
    console.log(`${title.toUpperCase()}`.cyan.bold);
    console.log(`${'='.repeat(60)}`.cyan);
}

// Test functions
async function testHealthEndpoints() {
    logSection('Health Check Endpoints');

    try {
        // Basic health check
        const healthResponse = await axios.get(`${BASE_URL}/health`, { timeout: TIMEOUT });
        if (healthResponse.status === 200) {
            log('Basic health endpoint is accessible', 'success');
        } else {
            log(`Health endpoint returned status ${healthResponse.status}`, 'error');
        }
    } catch (error) {
        log(`Health endpoint failed: ${error.message}`, 'error');
    }

    try {
        // Readiness check
        const readyResponse = await axios.get(`${BASE_URL}/health/ready`, { timeout: TIMEOUT });
        if (readyResponse.status === 200) {
            log('Readiness endpoint is accessible', 'success');
        } else {
            log(`Readiness endpoint returned status ${readyResponse.status}`, 'error');
        }
    } catch (error) {
        log(`Readiness endpoint failed: ${error.message}`, 'error');
    }

    try {
        // Liveness check
        const liveResponse = await axios.get(`${BASE_URL}/health/live`, { timeout: TIMEOUT });
        if (liveResponse.status === 200) {
            log('Liveness endpoint is accessible', 'success');
        } else {
            log(`Liveness endpoint returned status ${liveResponse.status}`, 'error');
        }
    } catch (error) {
        log(`Liveness endpoint failed: ${error.message}`, 'error');
    }
}

async function testSecurityHeaders() {
    logSection('Security Headers');

    try {
        const response = await axios.get(`${BASE_URL}/health`, { timeout: TIMEOUT });
        const headers = response.headers;

        // Check for security headers
        const securityHeaders = [
            'x-frame-options',
            'x-content-type-options',
            'x-xss-protection',
            'strict-transport-security',
            'content-security-policy'
        ];

        securityHeaders.forEach(header => {
            if (headers[header]) {
                log(`Security header ${header} is present: ${headers[header]}`, 'success');
            } else {
                log(`Security header ${header} is missing`, 'warning');
            }
        });

    } catch (error) {
        log(`Security headers test failed: ${error.message}`, 'error');
    }
}

async function testAPIEndpoints() {
    logSection('API Endpoints');

    // Test API base endpoint
    try {
        const response = await axios.get(`${BASE_URL}/${API_PREFIX}`, { timeout: TIMEOUT });
        if (response.status === 200 || response.status === 404) {
            log('API base endpoint is accessible', 'success');
        } else {
            log(`API base endpoint returned unexpected status ${response.status}`, 'warning');
        }
    } catch (error) {
        if (error.response && error.response.status === 404) {
            log('API base endpoint returns 404 (expected for some configurations)', 'success');
        } else {
            log(`API base endpoint test failed: ${error.message}`, 'error');
        }
    }

    // Test auth endpoints
    try {
        const response = await axios.post(`${BASE_URL}/${API_PREFIX}/auth/login`, {
            email: 'test@example.com',
            password: 'wrongpassword'
        }, {
            timeout: TIMEOUT,
            validateStatus: () => true // Accept all status codes
        });

        if (response.status === 401) {
            log('Auth login endpoint properly rejects invalid credentials', 'success');
        } else {
            log(`Auth login endpoint returned unexpected status ${response.status}`, 'warning');
        }
    } catch (error) {
        log(`Auth endpoint test failed: ${error.message}`, 'error');
    }
}

async function testRateLimiting() {
    logSection('Rate Limiting');

    try {
        const requests = [];
        const endpoint = `${BASE_URL}/health`;

        // Send multiple requests quickly
        for (let i = 0; i < 10; i++) {
            requests.push(
                axios.get(endpoint, {
                    timeout: TIMEOUT,
                    validateStatus: () => true
                })
            );
        }

        const responses = await Promise.all(requests);
        const rateLimitedResponses = responses.filter(r => r.status === 429);

        if (rateLimitedResponses.length > 0) {
            log(`Rate limiting is working (${rateLimitedResponses.length} requests rate limited)`, 'success');
        } else {
            log('Rate limiting may not be configured or limits are too high', 'warning');
        }

    } catch (error) {
        log(`Rate limiting test failed: ${error.message}`, 'error');
    }
}

async function testCORS() {
    logSection('CORS Configuration');

    try {
        const response = await axios.options(`${BASE_URL}/health`, {
            headers: {
                'Origin': 'https://example.com',
                'Access-Control-Request-Method': 'GET'
            },
            timeout: TIMEOUT,
            validateStatus: () => true
        });

        const corsHeaders = response.headers['access-control-allow-origin'];
        if (corsHeaders) {
            log(`CORS is configured: ${corsHeaders}`, 'success');
        } else {
            log('CORS headers not found in response', 'warning');
        }

    } catch (error) {
        log(`CORS test failed: ${error.message}`, 'error');
    }
}

async function testCompression() {
    logSection('Response Compression');

    try {
        const response = await axios.get(`${BASE_URL}/health`, {
            headers: {
                'Accept-Encoding': 'gzip, deflate, br'
            },
            timeout: TIMEOUT
        });

        const contentEncoding = response.headers['content-encoding'];
        if (contentEncoding && (contentEncoding.includes('gzip') || contentEncoding.includes('br'))) {
            log(`Response compression is enabled: ${contentEncoding}`, 'success');
        } else {
            log('Response compression may not be enabled', 'warning');
        }

    } catch (error) {
        log(`Compression test failed: ${error.message}`, 'error');
    }
}

async function testResponseTimes() {
    logSection('Response Time Performance');

    const endpoints = [
        '/health',
        '/health/ready',
        '/health/live'
    ];

    for (const endpoint of endpoints) {
        try {
            const startTime = Date.now();
            const response = await axios.get(`${BASE_URL}${endpoint}`, { timeout: TIMEOUT });
            const responseTime = Date.now() - startTime;

            if (response.status === 200) {
                if (responseTime < 100) {
                    log(`${endpoint} response time: ${responseTime}ms (excellent)`, 'success');
                } else if (responseTime < 500) {
                    log(`${endpoint} response time: ${responseTime}ms (good)`, 'success');
                } else if (responseTime < 1000) {
                    log(`${endpoint} response time: ${responseTime}ms (acceptable)`, 'warning');
                } else {
                    log(`${endpoint} response time: ${responseTime}ms (slow)`, 'error');
                }
            }
        } catch (error) {
            log(`Response time test for ${endpoint} failed: ${error.message}`, 'error');
        }
    }
}

async function testDocumentation() {
    logSection('API Documentation');

    try {
        const response = await axios.get(`${BASE_URL}/docs`, {
            timeout: TIMEOUT,
            validateStatus: () => true
        });

        if (response.status === 200) {
            log('Swagger documentation is accessible', 'success');
        } else if (response.status === 404) {
            log('Swagger documentation is disabled (expected in production)', 'info');
        } else {
            log(`Documentation endpoint returned status ${response.status}`, 'warning');
        }
    } catch (error) {
        log(`Documentation test failed: ${error.message}`, 'error');
    }
}

async function testMetrics() {
    logSection('Metrics and Monitoring');

    try {
        const response = await axios.get(`${BASE_URL}/metrics`, {
            timeout: TIMEOUT,
            validateStatus: () => true
        });

        if (response.status === 200) {
            log('Metrics endpoint is accessible', 'success');

            // Check if it looks like Prometheus metrics
            if (response.data && typeof response.data === 'string' && response.data.includes('# HELP')) {
                log('Metrics appear to be in Prometheus format', 'success');
            }
        } else if (response.status === 404) {
            log('Metrics endpoint not found', 'warning');
        } else {
            log(`Metrics endpoint returned status ${response.status}`, 'warning');
        }
    } catch (error) {
        log(`Metrics test failed: ${error.message}`, 'error');
    }
}

async function testEnvironmentConfiguration() {
    logSection('Environment Configuration');

    // Check if we're running in production mode
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
        log('Running in production mode', 'success');
    } else {
        log('Not running in production mode', 'warning');
    }

    // Check required environment variables
    const requiredEnvVars = [
        'DATABASE_URL',
        'MONGODB_URI',
        'REDIS_URL',
        'JWT_SECRET',
        'JWT_REFRESH_SECRET'
    ];

    requiredEnvVars.forEach(envVar => {
        if (process.env[envVar]) {
            log(`Environment variable ${envVar} is set`, 'success');
        } else {
            log(`Environment variable ${envVar} is missing`, 'error');
        }
    });
}

// Main test runner
async function runProductionReadinessTests() {
    console.log('🚀 Starting Production Readiness Tests'.bold.cyan);
    console.log(`Testing application at: ${BASE_URL}`.blue);
    console.log(`API Prefix: ${API_PREFIX}`.blue);
    console.log(`Timeout: ${TIMEOUT}ms`.blue);

    const startTime = Date.now();

    try {
        await testEnvironmentConfiguration();
        await testHealthEndpoints();
        await testSecurityHeaders();
        await testAPIEndpoints();
        await testRateLimiting();
        await testCORS();
        await testCompression();
        await testResponseTimes();
        await testDocumentation();
        await testMetrics();

    } catch (error) {
        log(`Test suite failed with error: ${error.message}`, 'error');
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Summary
    logSection('Test Summary');
    console.log(`Total Tests: ${totalTests}`.blue);
    console.log(`Passed: ${passedTests}`.green);
    console.log(`Failed: ${failedTests}`.red);
    console.log(`Duration: ${duration}ms`.blue);

    const successRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0;
    console.log(`Success Rate: ${successRate}%`.blue);

    if (failedTests === 0) {
        console.log('\n🎉 All tests passed! Application appears to be production ready.'.green.bold);
        process.exit(0);
    } else if (failedTests <= 2) {
        console.log('\n⚠️  Some tests failed, but application may still be deployable. Review failures above.'.yellow.bold);
        process.exit(1);
    } else {
        console.log('\n❌ Multiple tests failed. Application is not ready for production deployment.'.red.bold);
        process.exit(2);
    }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(3);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(3);
});

// Run the tests
if (require.main === module) {
    runProductionReadinessTests();
}

module.exports = {
    runProductionReadinessTests,
    testHealthEndpoints,
    testSecurityHeaders,
    testAPIEndpoints,
    testRateLimiting,
    testCORS,
    testCompression,
    testResponseTimes,
    testDocumentation,
    testMetrics,
    testEnvironmentConfiguration
};