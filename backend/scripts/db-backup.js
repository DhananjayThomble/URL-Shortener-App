#!/usr/bin/env node

/**
 * Database Backup Script
 * Creates backups of PostgreSQL and MongoDB databases
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
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

// Ensure backup directory exists
function ensureBackupDirectory() {
  if (!fs.existsSync(config.backupDir)) {
    fs.mkdirSync(config.backupDir, { recursive: true });
    log.info(`Created backup directory: ${config.backupDir}`);
  }
}

// Generate timestamp for backup files
function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

// Backup PostgreSQL database
async function backupPostgreSQL() {
  log.info('Starting PostgreSQL backup...');
  
  const timestamp = getTimestamp();
  const backupFile = path.join(config.backupDir, `postgres-backup-${timestamp}.sql`);
  
  try {
    // Set PGPASSWORD environment variable for authentication
    const env = { ...process.env, PGPASSWORD: config.postgres.password };
    
    const command = `pg_dump -h ${config.postgres.host} -p ${config.postgres.port} -U ${config.postgres.user} -d ${config.postgres.database} -f "${backupFile}" --verbose --clean --if-exists --create`;
    
    log.info(`Executing: ${command.replace(config.postgres.password, '***')}`);
    execSync(command, { env, stdio: 'inherit' });
    
    // Verify backup file was created and has content
    if (fs.existsSync(backupFile)) {
      const stats = fs.statSync(backupFile);
      if (stats.size > 0) {
        log.success(`PostgreSQL backup completed: ${backupFile} (${(stats.size / 1024).toFixed(2)} KB)`);
        return backupFile;
      } else {
        throw new Error('Backup file is empty');
      }
    } else {
      throw new Error('Backup file was not created');
    }
  } catch (error) {
    log.error(`PostgreSQL backup failed: ${error.message}`);
    throw error;
  }
}

// Backup MongoDB database
async function backupMongoDB() {
  log.info('Starting MongoDB backup...');
  
  const timestamp = getTimestamp();
  const backupDir = path.join(config.backupDir, `mongodb-backup-${timestamp}`);
  
  try {
    const command = `mongodump --uri="${config.mongodb.uri}" --out="${backupDir}"`;
    
    log.info(`Executing: ${command.replace(/\/\/.*@/, '//***@')}`);
    execSync(command, { stdio: 'inherit' });
    
    // Verify backup directory was created and has content
    if (fs.existsSync(backupDir)) {
      const files = fs.readdirSync(backupDir, { recursive: true });
      if (files.length > 0) {
        log.success(`MongoDB backup completed: ${backupDir} (${files.length} files)`);
        return backupDir;
      } else {
        throw new Error('Backup directory is empty');
      }
    } else {
      throw new Error('Backup directory was not created');
    }
  } catch (error) {
    log.error(`MongoDB backup failed: ${error.message}`);
    throw error;
  }
}

// Compress backup files
function compressBackups(backupFiles) {
  log.info('Compressing backup files...');
  
  const timestamp = getTimestamp();
  const archiveName = `database-backup-${timestamp}.tar.gz`;
  const archivePath = path.join(config.backupDir, archiveName);
  
  try {
    const filesToCompress = backupFiles.map(file => path.basename(file)).join(' ');
    const command = `tar -czf "${archivePath}" -C "${config.backupDir}" ${filesToCompress}`;
    
    execSync(command, { stdio: 'inherit' });
    
    if (fs.existsSync(archivePath)) {
      const stats = fs.statSync(archivePath);
      log.success(`Backup archive created: ${archivePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      
      // Clean up individual backup files
      backupFiles.forEach(file => {
        if (fs.existsSync(file)) {
          if (fs.lstatSync(file).isDirectory()) {
            fs.rmSync(file, { recursive: true, force: true });
          } else {
            fs.unlinkSync(file);
          }
        }
      });
      
      return archivePath;
    } else {
      throw new Error('Archive was not created');
    }
  } catch (error) {
    log.error(`Compression failed: ${error.message}`);
    throw error;
  }
}

// Clean up old backups (keep last N backups)
function cleanupOldBackups(keepCount = 5) {
  log.info(`Cleaning up old backups (keeping last ${keepCount})...`);
  
  try {
    const files = fs.readdirSync(config.backupDir)
      .filter(file => file.startsWith('database-backup-') && file.endsWith('.tar.gz'))
      .map(file => ({
        name: file,
        path: path.join(config.backupDir, file),
        mtime: fs.statSync(path.join(config.backupDir, file)).mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    
    if (files.length > keepCount) {
      const filesToDelete = files.slice(keepCount);
      
      filesToDelete.forEach(file => {
        fs.unlinkSync(file.path);
        log.info(`Deleted old backup: ${file.name}`);
      });
      
      log.success(`Cleaned up ${filesToDelete.length} old backup(s)`);
    } else {
      log.info('No old backups to clean up');
    }
  } catch (error) {
    log.warning(`Cleanup failed: ${error.message}`);
  }
}

// Main backup function
async function main() {
  const startTime = Date.now();
  
  console.log('='.repeat(50));
  console.log('  Database Backup Script');
  console.log('='.repeat(50));
  console.log('');
  
  try {
    ensureBackupDirectory();
    
    const backupFiles = [];
    
    // Backup PostgreSQL
    try {
      const pgBackup = await backupPostgreSQL();
      backupFiles.push(pgBackup);
    } catch (error) {
      log.warning('PostgreSQL backup failed, continuing with MongoDB...');
    }
    
    // Backup MongoDB
    try {
      const mongoBackup = await backupMongoDB();
      backupFiles.push(mongoBackup);
    } catch (error) {
      log.warning('MongoDB backup failed, continuing...');
    }
    
    if (backupFiles.length === 0) {
      throw new Error('All database backups failed');
    }
    
    // Compress backups
    const archive = compressBackups(backupFiles);
    
    // Clean up old backups
    cleanupOldBackups();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('');
    console.log('='.repeat(50));
    log.success(`Database backup completed successfully in ${duration}s!`);
    console.log('='.repeat(50));
    console.log('');
    console.log(`Backup archive: ${archive}`);
    console.log('');
    
  } catch (error) {
    log.error(`Backup failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Handle script interruption
process.on('SIGINT', () => {
  log.warning('Backup interrupted');
  process.exit(1);
});

process.on('SIGTERM', () => {
  log.warning('Backup terminated');
  process.exit(1);
});

// Run the backup script
if (require.main === module) {
  main();
}

module.exports = { main };