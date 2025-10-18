#!/usr/bin/env node

const colors = require('colors');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

console.log('🔍 Environment Configuration Validation'.bold.cyan);
console.log('====================================='.cyan);

let hasErrors = false;
let hasWarnings = false;

function logError(message) {
  console.log(`❌ ERROR: ${message}`.red);
  hasErrors = true;
}

function logWarning(message) {
  console.log(`⚠️  WARNING: ${message}`.yellow);
  hasWarnings = true;
}

function logSuccess(message) {
  console.log(`✅ ${message}`.green);
}

function logInfo(message) {
  console.log(`ℹ️  ${message}`.blue);
}

// Required environment variables
const requiredVars = [
  {
    name: 'DATABASE_URL',
    description: 'PostgreSQL connection string',
    example: 'postgresql://user:password@localhost:5432/dbname'
  },
  {
    name: 'MONGODB_URI',
    description: 'MongoDB connection string',
    example: 'mongodb://localhost:27017/urlshortener'
  },
  {
    name: 'REDIS_URL',
    description: 'Redis connection string',
    example: 'redis://localhost:6379'
  },
  {
    name: 'JWT_SECRET',
    description: 'JWT signing secret (should be long and random)',
    example: 'your-super-secret-jwt-key-at-least-32-characters'
  },
  {
    name: 'JWT_REFRESH_SECRET',
    description: 'JWT refresh token secret',
    example: 'your-refresh-token-secret-different-from-jwt-secret'
  }
];

// Optional but recommended variables
const recommendedVars = [
  {
    name: 'NODE_ENV',
    description: 'Environment mode',
    example: 'production',
    defaultValue: 'development'
  },
  {
    name: 'PORT',
    description: 'Application port',
    example: '3000',
    defaultValue: '3000'
  },
  {
    name: 'API_PREFIX',
    description: 'API route prefix',
    example: 'api/v1',
    defaultValue: 'api/v1'
  },
  {
    name: 'BASE_URL',
    description: 'Application base URL',
    example: 'https://your-domain.com',
    defaultValue: 'http://localhost:3000'
  },
  {
    name: 'CORS_ORIGIN',
    description: 'Allowed CORS origins',
    example: 'https://your-frontend.com,https://admin.your-domain.com',
    defaultValue: '*'
  }
];

console.log('\n📋 Required Environment Variables:'.bold);
console.log('==================================');

requiredVars.forEach(variable => {
  const value = process.env[variable.name];
  
  if (!value) {
    logError(`${variable.name} is not set`);
    logInfo(`   Description: ${variable.description}`);
    logInfo(`   Example: ${variable.example}`);
  } else {
    // Additional validation for specific variables
    if (variable.name === 'JWT_SECRET' && value.length < 32) {
      logWarning(`${variable.name} should be at least 32 characters long for security`);
    } else if (variable.name === 'JWT_REFRESH_SECRET' && value === process.env.JWT_SECRET) {
      logWarning(`${variable.name} should be different from JWT_SECRET`);
    } else if (variable.name.includes('URL') && !value.match(/^(mongodb|postgresql|redis):\/\//)) {
      logWarning(`${variable.name} format may be incorrect`);
    } else {
      logSuccess(`${variable.name} is set`);
    }
  }
});

console.log('\n📋 Recommended Environment Variables:'.bold);
console.log('====================================');

recommendedVars.forEach(variable => {
  const value = process.env[variable.name];
  
  if (!value) {
    logWarning(`${variable.name} is not set (will use default: ${variable.defaultValue})`);
    logInfo(`   Description: ${variable.description}`);
    logInfo(`   Example: ${variable.example}`);
  } else {
    logSuccess(`${variable.name} is set: ${value}`);
  }
});

// Check for .env file
console.log('\n📄 Environment File Check:'.bold);
console.log('==========================');

const envFiles = ['.env', '.env.local', '.env.production'];
let envFileFound = false;

envFiles.forEach(filename => {
  const filePath = path.join(process.cwd(), filename);
  if (fs.existsSync(filePath)) {
    logSuccess(`${filename} file found`);
    envFileFound = true;
  }
});

if (!envFileFound) {
  logWarning('No .env files found. Make sure environment variables are set via other means.');
}

// Check Node.js version
console.log('\n🚀 Runtime Environment:'.bold);
console.log('======================');

const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

if (majorVersion >= 18) {
  logSuccess(`Node.js version: ${nodeVersion} (supported)`);
} else if (majorVersion >= 16) {
  logWarning(`Node.js version: ${nodeVersion} (minimum supported, recommend 18+)`);
} else {
  logError(`Node.js version: ${nodeVersion} (unsupported, requires 16+)`);
}

// Check if in production mode
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  logSuccess('Running in production mode');
  
  // Additional production checks
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.includes('example')) {
    logError('JWT_SECRET appears to be a default/example value in production');
  }
  
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')) {
    logWarning('DATABASE_URL points to localhost in production mode');
  }
} else {
  logInfo(`Running in ${process.env.NODE_ENV || 'development'} mode`);
}

// Security checks
console.log('\n🔒 Security Configuration:'.bold);
console.log('=========================');

const securityVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'SESSION_SECRET'];
securityVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    if (value.length < 32) {
      logWarning(`${varName} should be at least 32 characters for security`);
    } else if (value.includes('secret') || value.includes('password') || value.includes('123')) {
      logWarning(`${varName} appears to contain common words - use a random string`);
    } else {
      logSuccess(`${varName} appears to be properly configured`);
    }
  }
});

// Database connection format validation
console.log('\n🗄️  Database Configuration:'.bold);
console.log('==========================');

const dbConnections = [
  { name: 'DATABASE_URL', protocol: 'postgresql' },
  { name: 'MONGODB_URI', protocol: 'mongodb' },
  { name: 'REDIS_URL', protocol: 'redis' }
];

dbConnections.forEach(({ name, protocol }) => {
  const url = process.env[name];
  if (url) {
    if (url.startsWith(`${protocol}://`)) {
      logSuccess(`${name} format appears correct`);
    } else {
      logError(`${name} should start with ${protocol}://`);
    }
  }
});

// Summary
console.log('\n📊 Validation Summary:'.bold);
console.log('=====================');

if (hasErrors) {
  console.log('❌ Configuration has ERRORS that must be fixed before deployment'.red.bold);
  process.exit(1);
} else if (hasWarnings) {
  console.log('⚠️  Configuration has warnings - review before production deployment'.yellow.bold);
  process.exit(0);
} else {
  console.log('✅ Configuration looks good!'.green.bold);
  process.exit(0);
}