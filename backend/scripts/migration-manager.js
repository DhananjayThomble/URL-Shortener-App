#!/usr/bin/env node

/**
 * Migration Management Script
 * Provides utilities for managing database migrations
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

// Migration commands
const commands = {
  async generate() {
    log.info('Generating new migration...');
    
    const name = await question('Enter migration name: ');
    if (!name || name.trim().length === 0) {
      throw new Error('Migration name is required');
    }
    
    const migrationName = name.trim().replace(/\s+/g, '-');
    
    try {
      const command = `npm run migration:generate -- -n ${migrationName}`;
      log.info(`Executing: ${command}`);
      execSync(command, { stdio: 'inherit' });
      log.success(`Migration generated: ${migrationName}`);
    } catch (error) {
      throw new Error(`Failed to generate migration: ${error.message}`);
    }
  },
  
  async run() {
    log.info('Running pending migrations...');
    
    try {
      const command = 'npm run migration:run';
      log.info(`Executing: ${command}`);
      execSync(command, { stdio: 'inherit' });
      log.success('Migrations executed successfully');
    } catch (error) {
      throw new Error(`Failed to run migrations: ${error.message}`);
    }
  },
  
  async revert() {
    log.warning('This will revert the last migration');
    const confirm = await question('Are you sure? (y/N): ');
    
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      log.info('Migration revert cancelled');
      return;
    }
    
    try {
      const command = 'npm run migration:revert';
      log.info(`Executing: ${command}`);
      execSync(command, { stdio: 'inherit' });
      log.success('Migration reverted successfully');
    } catch (error) {
      throw new Error(`Failed to revert migration: ${error.message}`);
    }
  },
  
  async status() {
    log.info('Checking migration status...');
    
    try {
      // This would need to be implemented with a custom TypeORM command
      // For now, we'll show the migrations directory
      const migrationsDir = path.join(process.cwd(), 'src', 'migrations');
      
      if (!fs.existsSync(migrationsDir)) {
        log.warning('Migrations directory not found');
        return;
      }
      
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.ts'))
        .sort();
      
      if (migrationFiles.length === 0) {
        log.info('No migration files found');
        return;
      }
      
      console.log('\nMigration files:');
      migrationFiles.forEach((file, index) => {
        const stats = fs.statSync(path.join(migrationsDir, file));
        console.log(`  ${index + 1}. ${file} (${stats.mtime.toLocaleString()})`);
      });
      
      log.info(`Total migrations: ${migrationFiles.length}`);
    } catch (error) {
      throw new Error(`Failed to check migration status: ${error.message}`);
    }
  },
  
  async create() {
    log.info('Creating empty migration...');
    
    const name = await question('Enter migration name: ');
    if (!name || name.trim().length === 0) {
      throw new Error('Migration name is required');
    }
    
    const migrationName = name.trim().replace(/\s+/g, '-');
    const timestamp = Date.now();
    const fileName = `${timestamp}-${migrationName}.ts`;
    const migrationsDir = path.join(process.cwd(), 'src', 'migrations');
    
    // Ensure migrations directory exists
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }
    
    const migrationTemplate = `import { MigrationInterface, QueryRunner } from 'typeorm';

export class ${migrationName.replace(/-/g, '')}${timestamp} implements MigrationInterface {
  name = '${migrationName.replace(/-/g, '')}${timestamp}';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add your migration logic here
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add your rollback logic here
  }
}
`;
    
    const filePath = path.join(migrationsDir, fileName);
    fs.writeFileSync(filePath, migrationTemplate);
    
    log.success(`Empty migration created: ${fileName}`);
  },
  
  async validate() {
    log.info('Validating migrations...');
    
    try {
      const migrationsDir = path.join(process.cwd(), 'src', 'migrations');
      
      if (!fs.existsSync(migrationsDir)) {
        log.warning('Migrations directory not found');
        return;
      }
      
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.ts'));
      
      let hasErrors = false;
      
      for (const file of migrationFiles) {
        const filePath = path.join(migrationsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Basic validation checks
        if (!content.includes('implements MigrationInterface')) {
          log.error(`${file}: Missing MigrationInterface implementation`);
          hasErrors = true;
        }
        
        if (!content.includes('public async up(')) {
          log.error(`${file}: Missing up() method`);
          hasErrors = true;
        }
        
        if (!content.includes('public async down(')) {
          log.error(`${file}: Missing down() method`);
          hasErrors = true;
        }
        
        // Check for TypeScript syntax errors
        try {
          execSync(`npx tsc --noEmit "${filePath}"`, { stdio: 'pipe' });
        } catch (error) {
          log.error(`${file}: TypeScript compilation error`);
          hasErrors = true;
        }
      }
      
      if (hasErrors) {
        throw new Error('Migration validation failed');
      } else {
        log.success('All migrations are valid');
      }
    } catch (error) {
      throw new Error(`Failed to validate migrations: ${error.message}`);
    }
  },
  
  async fresh() {
    log.warning('This will drop all tables and run all migrations from scratch');
    const confirm = await question('Are you sure? This is destructive! (y/N): ');
    
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      log.info('Fresh migration cancelled');
      return;
    }
    
    try {
      // This would need custom implementation to drop all tables
      // For now, we'll just run migrations
      log.warning('Fresh migration not fully implemented. Running normal migrations...');
      await commands.run();
    } catch (error) {
      throw new Error(`Failed to run fresh migrations: ${error.message}`);
    }
  },
};

// Show help
function showHelp() {
  console.log(`
Migration Manager - Database Migration Utilities

Usage: node migration-manager.js [command]

Commands:
  generate    Generate a new migration based on entity changes
  create      Create an empty migration file
  run         Run all pending migrations
  revert      Revert the last migration
  status      Show migration status
  validate    Validate migration files
  fresh       Drop all tables and run all migrations (destructive)
  help        Show this help message

Examples:
  node migration-manager.js generate
  node migration-manager.js run
  node migration-manager.js status
`);
}

// Interactive mode
async function interactiveMode() {
  console.log('\nMigration Manager - Interactive Mode');
  console.log('Available commands: generate, create, run, revert, status, validate, fresh, help, exit');
  
  while (true) {
    try {
      const command = await question('\nEnter command: ');
      
      if (command === 'exit' || command === 'quit') {
        break;
      }
      
      if (command === 'help') {
        showHelp();
        continue;
      }
      
      if (commands[command]) {
        await commands[command]();
      } else {
        log.error(`Unknown command: ${command}`);
        log.info('Type "help" for available commands');
      }
    } catch (error) {
      log.error(error.message);
    }
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  console.log('='.repeat(50));
  console.log('  Migration Manager');
  console.log('='.repeat(50));
  console.log('');
  
  try {
    if (!command) {
      await interactiveMode();
    } else if (command === 'help' || command === '--help' || command === '-h') {
      showHelp();
    } else if (commands[command]) {
      await commands[command]();
    } else {
      log.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
    }
  } catch (error) {
    log.error(error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Handle script interruption
process.on('SIGINT', () => {
  log.warning('Migration manager interrupted');
  rl.close();
  process.exit(1);
});

process.on('SIGTERM', () => {
  log.warning('Migration manager terminated');
  rl.close();
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main, commands };