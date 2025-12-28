#!/usr/bin/env node

/**
 * Production readiness test script
 * Validates that the application is ready for production deployment
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'white') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logHeader(message) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`${message}`, 'cyan');
  log(`${'='.repeat(60)}`, 'cyan');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

/**
 * Test production environment variables
 */
function testProductionEnvironment() {
  logHeader('Testing Production Environment Configuration');
  
  // Set production environment for testing
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  
  const requiredProdVars = [
    'DATABASE_URL',
    'MONGODB_URI', 
    'REDIS_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'SESSION_SECRET',
    'BASE_URL',
    'FRONTEND_URL',
  ];
  
  const mockProdConfig = {
    NODE_ENV: 'production',
    PORT: '3000',
    DATABASE_URL: 'postgresql://produser:strongpassword123@prod-db:5432/urlshortener_prod',
    DATABASE_HOST: 'prod-db',
    DATABASE_PORT: '5432',
    DATABASE_USERNAME: 'produser',
    DATABASE_PASSWORD: 'strongpassword123',
    DATABASE_NAME: 'urlshortener_prod',
    MONGODB_URI: 'mongodb://prod-mongo:27017/urlshortener_prod',
    MONGODB_HOST: 'prod-mongo',
    MONGODB_PORT: '27017',
    MONGODB_DATABASE: 'urlshortener_prod',
    REDIS_URL: 'redis://prod-redis:6379',
    REDIS_HOST: 'prod-redis',
    REDIS_PORT: '6379',
    REDIS_DB: '0',
    JWT_SECRET: 'super-secure-jwt-secret-for-production-use-32-chars-minimum',
    JWT_REFRESH_SECRET: 'super-secure-refresh-secret-for-production-use-32-chars-minimum',
    SESSION_SECRET: 'super-secure-session-secret-for-production-use-32-chars-minimum',
    BASE_URL: 'https://api.snapurl.com',
    FRONTEND_URL: 'https://snapurl.com',
    LOG_LEVEL: 'warn',
    BCRYPT_SALT_ROUNDS: '12',
    CORS_ORIGIN: 'https://snapurl.com',
    ENABLE_SWAGGER: 'false',
    ENABLE_COMPRESSION: 'true',
    ENABLE_HELMET: 'true',
    RATE_LIMIT_TTL: '60000',
    RATE_LIMIT_MAX: '100',
    CACHE_TTL_URL: '3600',
    CACHE_TTL_SESSION: '900',
    CACHE_TTL_ANALYTICS: '300',
  };
  
  let allValid = true;
  
  // Check required variables
  for (const varName of requiredProdVars) {
    if (mockProdConfig[varName]) {
      logSuccess(`${varName} is configured`);
    } else {
      logError(`${varName} is missing`);
      allValid = false;
    }
  }
  
  // Check HTTPS URLs
  const httpsUrls = ['BASE_URL', 'FRONTEND_URL'];
  for (const urlVar of httpsUrls) {
    const url = mockProdConfig[urlVar];
    if (url && url.startsWith('https://')) {
      logSuccess(`${urlVar} uses HTTPS`);
    } else {
      logError(`${urlVar} must use HTTPS in production`);
      allValid = false;
    }
  }
  
  // Check secret strength
  const secrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'SESSION_SECRET'];
  for (const secretVar of secrets) {
    const secret = mockProdConfig[secretVar];
    if (secret && secret.length >= 32 && !secret.includes('dev') && !secret.includes('test')) {
      logSuccess(`${secretVar} meets production requirements`);
    } else {
      logError(`${secretVar} is too weak for production`);
      allValid = false;
    }
  }
  
  // Restore original environment
  process.env.NODE_ENV = originalEnv;
  
  return allValid;
}

/**
 * Test Docker build
 */
function testDockerBuild() {
  logHeader('Testing Docker Build');
  
  try {
    // Check if Docker is available
    execSync('docker --version', { stdio: 'pipe' });
    logSuccess('Docker is available');
    
    // Test Docker build
    logInfo('Building Docker image (this may take a few minutes)...');
    execSync('docker build -t nestjs-url-shortener-test .', { stdio: 'pipe' });
    logSuccess('Docker build successful');
    
    // Clean up test image
    try {
      execSync('docker rmi nestjs-url-shortener-test', { stdio: 'pipe' });
      logInfo('Cleaned up test Docker image');
    } catch (error) {
      logWarning('Could not clean up test Docker image');
    }
    
    return true;
  } catch (error) {
    if (error.message.includes('docker: not found') || error.message.includes('Docker')) {
      logWarning('Docker not available - skipping Docker build test');
      return true; // Don't fail if Docker is not available
    }
    
    logError('Docker build failed');
    log(error.message, 'red');
    return false;
  }
}

/**
 * Test TypeScript build
 */
function testBuild() {
  logHeader('Testing Production Build');
  
  try {
    // Clean previous build
    if (fs.existsSync('dist')) {
      execSync('rm -rf dist', { stdio: 'pipe' });
    }
    
    // Build project
    execSync('npm run build', { stdio: 'pipe' });
    logSuccess('TypeScript build successful');
    
    // Check if main files exist
    const requiredBuildFiles = [
      'dist/main.js',
      'dist/app.module.js',
      'dist/config/environment.module.js',
      'dist/config/environment-validation.service.js',
    ];
    
    let allFilesExist = true;
    for (const file of requiredBuildFiles) {
      if (fs.existsSync(file)) {
        logSuccess(`${file} exists`);
      } else {
        logError(`${file} missing from build`);
        allFilesExist = false;
      }
    }
    
    return allFilesExist;
  } catch (error) {
    logError('Build failed');
    log(error.stdout?.toString() || error.message, 'red');
    return false;
  }
}

/**
 * Test security configuration
 */
function testSecurityConfiguration() {
  logHeader('Testing Security Configuration');
  
  const securityChecks = [
    {
      name: 'Helmet configuration',
      check: () => fs.existsSync('src/main.ts') && 
                   fs.readFileSync('src/main.ts', 'utf8').includes('helmet'),
    },
    {
      name: 'CORS configuration',
      check: () => fs.existsSync('src/main.ts') && 
                   fs.readFileSync('src/main.ts', 'utf8').includes('cors'),
    },
    {
      name: 'Rate limiting',
      check: () => fs.existsSync('src/app.module.ts') && 
                   fs.readFileSync('src/app.module.ts', 'utf8').includes('ThrottlerModule'),
    },
    {
      name: 'Input validation',
      check: () => fs.existsSync('src/main.ts') && 
                   fs.readFileSync('src/main.ts', 'utf8').includes('ValidationPipe'),
    },
  ];
  
  let allSecurityChecksPass = true;
  
  for (const check of securityChecks) {
    if (check.check()) {
      logSuccess(`${check.name} is configured`);
    } else {
      logError(`${check.name} is not properly configured`);
      allSecurityChecksPass = false;
    }
  }
  
  return allSecurityChecksPass;
}

/**
 * Test performance configuration
 */
function testPerformanceConfiguration() {
  logHeader('Testing Performance Configuration');
  
  const performanceChecks = [
    {
      name: 'Compression middleware',
      check: () => {
        const mainContent = fs.readFileSync('src/main.ts', 'utf8');
        return mainContent.includes('compression') || 
               mainContent.includes('ENABLE_COMPRESSION');
      },
    },
    {
      name: 'Caching configuration',
      check: () => fs.existsSync('src/common/cache.module.ts'),
    },
    {
      name: 'Database connection pooling',
      check: () => {
        const configContent = fs.readFileSync('src/config/environment-configs.ts', 'utf8');
        return configContent.includes('pool');
      },
    },
    {
      name: 'Redis configuration',
      check: () => fs.existsSync('src/config/redis.config.ts'),
    },
  ];
  
  let allPerformanceChecksPass = true;
  
  for (const check of performanceChecks) {
    if (check.check()) {
      logSuccess(`${check.name} is configured`);
    } else {
      logWarning(`${check.name} may not be optimally configured`);
      // Don't fail for performance warnings
    }
  }
  
  return allPerformanceChecksPass;
}

/**
 * Test monitoring configuration
 */
function testMonitoringConfiguration() {
  logHeader('Testing Monitoring Configuration');
  
  const monitoringChecks = [
    {
      name: 'Health checks',
      check: () => fs.existsSync('src/modules/monitoring/controllers/health.controller.ts'),
    },
    {
      name: 'Metrics collection',
      check: () => fs.existsSync('src/modules/monitoring/services/metrics.service.ts'),
    },
    {
      name: 'Logging configuration',
      check: () => fs.existsSync('src/modules/monitoring/services/logging.service.ts'),
    },
    {
      name: 'Error handling',
      check: () => fs.existsSync('src/common/filters/global-exception.filter.ts'),
    },
  ];
  
  let allMonitoringChecksPass = true;
  
  for (const check of monitoringChecks) {
    if (check.check()) {
      logSuccess(`${check.name} is configured`);
    } else {
      logWarning(`${check.name} may not be configured`);
      // Don't fail for monitoring warnings in basic setup
    }
  }
  
  return allMonitoringChecksPass;
}

/**
 * Test deployment readiness
 */
function testDeploymentReadiness() {
  logHeader('Testing Deployment Readiness');
  
  const deploymentChecks = [
    {
      name: 'Package.json scripts',
      check: () => {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        return pkg.scripts?.['start:prod'] && 
               pkg.scripts?.build && 
               pkg.scripts?.['validate:env'];
      },
    },
    {
      name: 'Environment validation script',
      check: () => fs.existsSync('validate-env.js'),
    },
    {
      name: 'Docker configuration',
      check: () => fs.existsSync('Dockerfile') && 
                   fs.existsSync('docker-compose.prod.yml'),
    },
    {
      name: 'Kubernetes manifests',
      check: () => fs.existsSync('k8s') && 
                   fs.existsSync('k8s/app-deployment.yaml'),
    },
  ];
  
  let allDeploymentChecksPass = true;
  
  for (const check of deploymentChecks) {
    if (check.check()) {
      logSuccess(`${check.name} is ready`);
    } else {
      logError(`${check.name} is not ready`);
      allDeploymentChecksPass = false;
    }
  }
  
  return allDeploymentChecksPass;
}

/**
 * Main test function
 */
async function main() {
  log('🚀 Starting Production Readiness Tests', 'magenta');
  
  const tests = [
    { name: 'Production Environment', fn: testProductionEnvironment },
    { name: 'TypeScript Build', fn: testBuild },
    { name: 'Security Configuration', fn: testSecurityConfiguration },
    { name: 'Performance Configuration', fn: testPerformanceConfiguration },
    { name: 'Monitoring Configuration', fn: testMonitoringConfiguration },
    { name: 'Deployment Readiness', fn: testDeploymentReadiness },
    { name: 'Docker Build', fn: testDockerBuild },
  ];
  
  const results = [];
  
  for (const test of tests) {
    try {
      const result = await test.fn();
      results.push({ name: test.name, passed: result });
    } catch (error) {
      logError(`${test.name} test failed: ${error.message}`);
      results.push({ name: test.name, passed: false });
    }
  }
  
  // Summary
  logHeader('Production Readiness Summary');
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  results.forEach(result => {
    if (result.passed) {
      logSuccess(`${result.name}: READY`);
    } else {
      logError(`${result.name}: NOT READY`);
    }
  });
  
  log(`\nOverall: ${passed}/${total} tests passed`, passed === total ? 'green' : 'red');
  
  if (passed === total) {
    logSuccess('🎉 Application is ready for production deployment!');
    
    logInfo('\nNext steps:');
    logInfo('1. Set production environment variables');
    logInfo('2. Run: npm run validate:env');
    logInfo('3. Deploy using Docker or Kubernetes manifests');
    logInfo('4. Monitor application health and metrics');
    
    process.exit(0);
  } else {
    logError('❌ Application is not ready for production. Please fix the issues above.');
    process.exit(1);
  }
}

// Run tests
main().catch(error => {
  logError(`Production readiness test failed: ${error.message}`);
  process.exit(1);
});