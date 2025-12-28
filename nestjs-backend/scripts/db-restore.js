#!/usr/bin/env node

/**
 * Database Restore Script
 * Restores PostgreSQL and MongoDB databases from backup files
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
};

// Configuration
const config = {
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER || 'urlshortener',
    password: process.env.POSTGRES_PASSWORD || 'password123',
    database: process.env.POSTGRES_DB || 'urlshortener_dev',
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/urlshortener_dev',
  },
  backupDir: process.env.BACKUP_DIR || './backups',
};

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Promisify readline question
function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}

// List available backup files
function listBackupFiles() {
  if (!fs.existsSync(config.backupDir)) {
    throw new Error(`Backup directory does not exist: ${config.backupDir}`);
  }
  
  const files = fs.readdirSync(config.backupDir)
    .filter(file => file.endsWith('.tar.gz') || file.endsWith('.sql'))
    .map(file => ({
      name: file,
      path: path.join(config.backupDir, file),
      mtime: fs.statSync(path.join(config.backupDir, file)).mtime,
      size: fs.statSync(path.join(config.backupDir, file)).size,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  return files;
}

// Extract archive if needed
function extractArchive(archivePath) {
  log.info('Extracting backup archive...');
  
  const extractDir = path.join(config.backupDir, 'temp-restore');
  
  // Clean up any existing temp directory
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  
  fs.mkdirSync(extractDir, { recursive: true });
  
  try {
    const command = `tar -xzf "${archivePath}" -C "${extractDir}"`;
    execSync(command, { stdio: 'inherit' });
    
    log.success('Archive extracted successfully');
    return extractDir;
  } catch (error) {
    log.error(`Failed to extract archive: ${error.message}`);
    throw error;
  }
}

// Restore PostgreSQL database
async function restorePostgreSQL(backupFile) {
  log.info('Starting PostgreSQL restore...');
  
  try {
    // Confirm destructive operation
    const confirm = await question(
      `${colors.yellow}WARNING: This will replace the current PostgreSQL database. Continue? (y/N): ${colors.reset}`
    );
    
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      log.info('PostgreSQL restore cancelled');
      return;
    }
    
    // Set PGPASSWORD environment variable for authentication
    const env = { ...process.env, PGPASSWORD: config.postgres.password };
    
    const command = `psql -h ${config.postgres.host} -p ${config.postgres.port} -U ${config.postgres.user} -d ${config.postgres.database} -f "${backupFile}" --quiet`;
    
    log.info(`Executing restore command...`);
    execSync(command, { env, stdio: 'inherit' });
    
    log.success('PostgreSQL restore completed successfully');
  } catch (error) {
    log.error(`PostgreSQL restore failed: ${error.message}`);
    throw error;
  }
}

// Restore MongoDB database
async function restoreMongoDB(backupDir) {
  log.info('Starting MongoDB restore...');
  
  try {
    // Confirm destructive operation
    const confirm = await question(
      `${colors.yellow}WARNING: This will replace the current MongoDB database. Continue? (y/N): ${colors.reset}`
    );
    
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      log.info('MongoDB restore cancelled');
      return;
    }
    
    const command = `mongorestore --uri="${config.mongodb.uri}" --drop "${backupDir}"`;
    
    log.info(`Executing restore command...`);
    execSync(command, { stdio: 'inherit' });
    
    log.success('MongoDB restore completed successfully');
  } catch (error) {
    log.error(`MongoDB restore failed: ${error.message}`);
    throw error;
  }
}

// Find backup files in directory
function findBackupFiles(directory) {
  const files = fs.readdirSync(directory, { recursive: true });
  
  const postgresFiles = files.filter(file => 
    file.endsWith('.sql') && file.includes('postgres')
  );
  
  const mongoDirectories = files.filter(file => {
    const fullPath = path.join(directory, file);
    return fs.lstatSync(fullPath).isDirectory() && file.includes('mongodb');
  });
  
  return {
    postgres: postgresFiles.map(file => path.join(directory, file)),
    mongodb: mongoDirectories.map(dir => path.join(directory, dir)),
  };
}

// Interactive backup selection
async function selectBackupFile() {
  const backupFiles = listBackupFiles();
  
  if (backupFiles.length === 0) {
    throw new Error('No backup files found');
  }
  
  console.log('\nAvailable backup files:');
  backupFiles.forEach((file, index) => {
    const sizeKB = (file.size / 1024).toFixed(2);
    const date = file.mtime.toLocaleString();
    console.log(`  ${index + 1}. ${file.name} (${sizeKB} KB, ${date})`);
  });
  
  const selection = await question('\nSelect backup file (number): ');
  const selectedIndex = parseInt(selection) - 1;
  
  if (selectedIndex < 0 || selectedIndex >= backupFiles.length) {
    throw new Error('Invalid selection');
  }
  
  return backupFiles[selectedIndex];
}

// Main restore function
async function main() {
  const startTime = Date.now();
  
  console.log('='.repeat(50));
  console.log('  Database Restore Script');
  console.log('='.repeat(50));
  console.log('');
  
  try {
    // Select backup file
    const selectedBackup = await selectBackupFile();
    log.info(`Selected backup: ${selectedBackup.name}`);
    
    let workingDir = config.backupDir;
    let backupFiles = {};
    
    // Extract archive if it's a compressed backup
    if (selectedBackup.name.endsWith('.tar.gz')) {
      workingDir = extractArchive(selectedBackup.path);
      backupFiles = findBackupFiles(workingDir);
    } else if (selectedBackup.name.endsWith('.sql')) {
      // Direct SQL file
      backupFiles.postgres = [selectedBackup.path];
    }
    
    // Restore databases
    if (backupFiles.postgres && backupFiles.postgres.length > 0) {
      await restorePostgreSQL(backupFiles.postgres[0]);
    }
    
    if (backupFiles.mongodb && backupFiles.mongodb.length > 0) {
      await restoreMongoDB(backupFiles.mongodb[0]);
    }
    
    // Clean up temporary extraction directory
    if (workingDir !== config.backupDir && fs.existsSync(workingDir)) {
      fs.rmSync(workingDir, { recursive: true, force: true });
      log.info('Cleaned up temporary files');
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('');
    console.log('='.repeat(50));
    log.success(`Database restore completed successfully in ${duration}s!`);
    console.log('='.repeat(50));
    console.log('');
    
  } catch (error) {
    log.error(`Restore failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Handle script interruption
process.on('SIGINT', () => {
  log.warning('Restore interrupted');
  rl.close();
  process.exit(1);
});

process.on('SIGTERM', () => {
  log.warning('Restore terminated');
  rl.close();
  process.exit(1);
});

// Run the restore script
if (require.main === module) {
  main();
}

module.exports = { main };