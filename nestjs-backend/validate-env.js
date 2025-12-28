#!/usr/bin/env node

/**
 * Environment validation script
 * Run this script to validate environment configuration before deployment
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
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
 * Check if required files exist
 */
function checkRequiredFiles() {
  logHeader('Checking Required Files');
  
  const requiredFiles = [
    'package.json',
    'src/main.ts',
    'src/app.module.ts',
    'src/config/environment.module.ts',
    'src/config/environment-validation.service.ts',
    'src/config/environment-configs.ts',
    'src/config/secrets-management.service.ts',
  ];
  
  let allFilesExist = true;
  
  for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
      logSuccess(`${file} exists`);
    } else {
      logError(`${file} is missing`);
      allFilesExist = false;
    }
  }
  
  return allFilesExist;
}

/**
 * Check environment files
 */
function checkEnvironmentFiles() {
  logHeader('Checking Environment Files');
  
  const nodeEnv = process.env.NODE_ENV || 'development';
  const envFiles = [
    '.env.example',
    `.env.${nodeEnv}`,
    '.env.local',
    '.env',
  ];
  
  let hasValidEnvFile = false;
  
  for (const file of envFiles) {
    if (fs.existsSync(file)) {
      logSuccess(`${file} exists`);
      hasValidEnvFile = true;
    } else {
      logWarning(`${file} not found`);
    }
  }
  
  if (!hasValidEnvFile) {
    logError('No environment files found');
    return false;
  }
  
  return true;
}

/**
 * Validate TypeScript compilation
 */
function validateTypeScript() {
  logHeader('Validating TypeScript Compilation');
  
  try {
    execSync('npx tsc --noEmit', { stdio: 'pipe' });
    logSuccess('TypeScript compilation successful');
    return true;
  } catch (error) {
    logError('TypeScript compilation failed');
    log(error.stdout?.toString() || error.message, 'red');
    return false;
  }
}

/**
 * Check dependencies
 */
function checkDependencies() {
  logHeader('Checking Dependencies');
  
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const requiredDeps = [
      '@nestjs/common',
      '@nestjs/config',
      '@nestjs/core',
      'joi',
      'class-validator',
      'class-transformer',
    ];
    
    let allDepsPresent = true;
    
    for (const dep of requiredDeps) {
      if (packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep]) {
        logSuccess(`${dep} is installed`);
      } else {
        logError(`${dep} is missing`);
        allDepsPresent = false;
      }
    }
    
    return allDepsPresent;
  } catch (error) {
    logError('Failed to read package.json');
    return false;
  }
}

/**
 * Test environment validation service
 */
function testEnvironmentValidation() {
  logHeader('Testing Environment Validation');
  
  try {
    // Create a temporary test script
    const testScript = `
      const { EnvironmentValidationService } = require('./dist/config/environment-validation.service');
      const { ConfigService } = require('@nestjs/config');
      
      const mockConfig = {
        NODE_ENV: 'test',
        PORT: '3000',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        DATABASE_HOST: 'localhost',
        DATABASE_PORT: '5432',
        DATABASE_USERNAME: 'test',
        DATABASE_PASSWORD: 'testpassword',
        DATABASE_NAME: 'test',
        MONGODB_URI: 'mongodb://localhost:27017/test',
        MONGODB_HOST: 'localhost',
        MONGODB_PORT: '27017',
        MONGODB_DATABASE: 'test',
        REDIS_URL: 'redis://localhost:6379',
        REDIS_HOST: 'localhost',
        REDIS_PORT: '6379',
        REDIS_DB: '0',
        JWT_SECRET: 'test-jwt-secret-with-sufficient-length',
        JWT_REFRESH_SECRET: 'test-refresh-secret-with-sufficient-length',
        SESSION_SECRET: 'test-session-secret-with-sufficient-length',
        BASE_URL: 'http://localhost:3000',
        FRONTEND_URL: 'http://localhost:3001',
        LOG_LEVEL: 'info',
        BCRYPT_SALT_ROUNDS: '10',
        RATE_LIMIT_TTL: '60000',
        RATE_LIMIT_MAX: '100',
        CACHE_TTL_URL: '3600',
        CACHE_TTL_SESSION: '900',
        CACHE_TTL_ANALYTICS: '300',
      };
      
      const configService = new ConfigService(mockConfig);
      const validationService = new EnvironmentValidationService(configService);
      
      try {
        const result = validationService.validate(mockConfig);
        console.log('✅ Environment validation test passed');
        process.exit(0);
      } catch (error) {
        console.error('❌ Environment validation test failed:', error.message);
        process.exit(1);
      }
    `;
    
    // First, build the project
    execSync('npm run build', { stdio: 'pipe' });
    
    // Write and execute test script
    fs.writeFileSync('temp-validation-test.js', testScript);
    execSync('node temp-validation-test.js', { stdio: 'inherit' });
    fs.unlinkSync('temp-validation-test.js');
    
    logSuccess('Environment validation service test passed');
    return true;
  } catch (error) {
    logError('Environment validation service test failed');
    log(error.message, 'red');
    
    // Clean up temp file if it exists
    if (fs.existsSync('temp-validation-test.js')) {
      fs.unlinkSync('temp-validation-test.js');
    }
    
    return false;
  }
}

/**
 * Check Docker configuration
 */
function checkDockerConfiguration() {
  logHeader('Checking Docker Configuration');
  
  const dockerFiles = [
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.dev.yml',
    'docker-compose.prod.yml',
    '.dockerignore',
  ];
  
  let allDockerFilesExist = true;
  
  for (const file of dockerFiles) {
    if (fs.existsSync(file)) {
      logSuccess(`${file} exists`);
    } else {
      logWarning(`${file} not found`);
      if (file === 'Dockerfile') {
        allDockerFilesExist = false;
      }
    }
  }
  
  return allDockerFilesExist;
}

/**
 * Check Kubernetes configuration
 */
function checkKubernetesConfiguration() {
  logHeader('Checking Kubernetes Configuration');
  
  const k8sDir = 'k8s';
  
  if (!fs.existsSync(k8sDir)) {
    logWarning('k8s directory not found');
    return false;
  }
  
  const requiredK8sFiles = [
    'namespace.yaml',
    'configmap.yaml',
    'secrets.yaml',
    'app-deployment.yaml',
    'postgres.yaml',
    'mongodb.yaml',
    'redis.yaml',
  ];
  
  let allK8sFilesExist = true;
  
  for (const file of requiredK8sFiles) {
    const filePath = path.join(k8sDir, file);
    if (fs.existsSync(filePath)) {
      logSuccess(`k8s/${file} exists`);
    } else {
      logWarning(`k8s/${file} not found`);
      allK8sFilesExist = false;
    }
  }
  
  return allK8sFilesExist;
}

/**
 * Main validation function
 */
async function main() {
  log('🚀 Starting Environment Validation', 'magenta');
  log(`Environment: ${process.env.NODE_ENV || 'development'}`, 'blue');
  
  const checks = [
    { name: 'Required Files', fn: checkRequiredFiles },
    { name: 'Environment Files', fn: checkEnvironmentFiles },
    { name: 'Dependencies', fn: checkDependencies },
    { name: 'TypeScript Compilation', fn: validateTypeScript },
    { name: 'Environment Validation Service', fn: testEnvironmentValidation },
    { name: 'Docker Configuration', fn: checkDockerConfiguration },
    { name: 'Kubernetes Configuration', fn: checkKubernetesConfiguration },
  ];
  
  const results = [];
  
  for (const check of checks) {
    try {
      const result = await check.fn();
      results.push({ name: check.name, passed: result });
    } catch (error) {
      logError(`${check.name} check failed: ${error.message}`);
      results.push({ name: check.name, passed: false });
    }
  }
  
  // Summary
  logHeader('Validation Summary');
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  results.forEach(result => {
    if (result.passed) {
      logSuccess(`${result.name}: PASSED`);
    } else {
      logError(`${result.name}: FAILED`);
    }
  });
  
  log(`\nOverall: ${passed}/${total} checks passed`, passed === total ? 'green' : 'red');
  
  if (passed === total) {
    logSuccess('🎉 All validation checks passed! Environment is ready for deployment.');
    process.exit(0);
  } else {
    logError('❌ Some validation checks failed. Please fix the issues before deployment.');
    process.exit(1);
  }
}

// Run validation
main().catch(error => {
  logError(`Validation script failed: ${error.message}`);
  process.exit(1);
});