# Development Environment Setup Script for Windows
# This script sets up the complete development environment with one command

param(
    [switch]$SkipDocker,
    [switch]$Verbose
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Colors for output
$Colors = @{
    Red = "Red"
    Green = "Green"
    Yellow = "Yellow"
    Blue = "Blue"
    White = "White"
}

function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor $Colors.Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor $Colors.Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor $Colors.Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor $Colors.Red
}

function Test-NodeJs {
    Write-Status "Checking Node.js installation..."
    
    try {
        $nodeVersion = node --version
        $versionNumber = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
        
        if ($versionNumber -lt 18) {
            Write-Error "Node.js version 18+ is required. Current version: $nodeVersion"
            exit 1
        }
        
        Write-Success "Node.js $nodeVersion is installed"
    }
    catch {
        Write-Error "Node.js is not installed. Please install Node.js 18+ and try again."
        exit 1
    }
}

function Test-Docker {
    if ($SkipDocker) {
        Write-Warning "Skipping Docker check as requested"
        return
    }
    
    Write-Status "Checking Docker installation..."
    
    try {
        docker --version | Out-Null
        docker info | Out-Null
        Write-Success "Docker is installed and running"
    }
    catch {
        Write-Error "Docker is not installed or not running. Please install Docker and try again, or use -SkipDocker flag."
        exit 1
    }
}

function Install-Dependencies {
    Write-Status "Installing Node.js dependencies..."
    
    try {
        npm ci
        Write-Success "Dependencies installed"
    }
    catch {
        Write-Error "Failed to install dependencies"
        exit 1
    }
}

function Setup-Environment {
    Write-Status "Setting up environment configuration..."
    
    if (-not (Test-Path ".env")) {
        if (Test-Path ".env.example") {
            Copy-Item ".env.example" ".env"
            Write-Success "Created .env from .env.example"
        }
        else {
            Write-Warning ".env.example not found, creating basic .env file"
            
            $envContent = @"
# Database Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=urlshortener
POSTGRES_PASSWORD=password123
POSTGRES_DB=urlshortener_dev

MONGODB_URI=mongodb://localhost:27017/urlshortener_dev

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this-in-production
JWT_REFRESH_EXPIRES_IN=30d

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=noreply@urlshortener.com

# Application Configuration
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

# Rate Limiting
RATE_LIMIT_TTL=60
RATE_LIMIT_LIMIT=100

# Monitoring
ENABLE_METRICS=true
ENABLE_TRACING=false
"@
            
            $envContent | Out-File -FilePath ".env" -Encoding UTF8
            Write-Success "Created basic .env file"
        }
    }
    else {
        Write-Success ".env file already exists"
    }
}

function Start-Databases {
    if ($SkipDocker) {
        Write-Warning "Skipping database startup as Docker is disabled"
        return
    }
    
    Write-Status "Starting database services with Docker Compose..."
    
    if (-not (Test-Path "docker-compose.dev.yml")) {
        Write-Error "docker-compose.dev.yml not found. Please ensure it exists."
        exit 1
    }
    
    try {
        # Start only database services
        docker-compose -f docker-compose.dev.yml up -d postgres mongodb redis
        
        Write-Status "Waiting for databases to be ready..."
        Start-Sleep -Seconds 10
        
        # Wait for PostgreSQL
        Write-Status "Waiting for PostgreSQL to be ready..."
        do {
            Start-Sleep -Seconds 2
            $pgReady = docker-compose -f docker-compose.dev.yml exec -T postgres pg_isready -U urlshortener 2>$null
        } while ($LASTEXITCODE -ne 0)
        
        # Wait for MongoDB
        Write-Status "Waiting for MongoDB to be ready..."
        do {
            Start-Sleep -Seconds 2
            $mongoReady = docker-compose -f docker-compose.dev.yml exec -T mongodb mongosh --eval "db.adminCommand('ping')" 2>$null
        } while ($LASTEXITCODE -ne 0)
        
        # Wait for Redis
        Write-Status "Waiting for Redis to be ready..."
        do {
            Start-Sleep -Seconds 2
            $redisReady = docker-compose -f docker-compose.dev.yml exec -T redis redis-cli ping 2>$null
        } while ($LASTEXITCODE -ne 0)
        
        Write-Success "All databases are ready"
    }
    catch {
        Write-Error "Failed to start database services"
        exit 1
    }
}

function Invoke-Migrations {
    Write-Status "Running database migrations..."
    
    try {
        # Validate environment first
        npm run validate:env
        
        # Run TypeORM migrations
        npm run migration:run
        
        Write-Success "Database migrations completed"
    }
    catch {
        Write-Error "Failed to run database migrations"
        exit 1
    }
}

function Invoke-DatabaseSeeding {
    Write-Status "Seeding database with initial data..."
    
    if (Test-Path "scripts/seed-database.js") {
        try {
            node scripts/seed-database.js
            Write-Success "Database seeded successfully"
        }
        catch {
            Write-Warning "Database seeding failed, but setup can continue"
        }
    }
    else {
        Write-Warning "No seeding script found, skipping database seeding"
    }
}

function Setup-GitHooks {
    Write-Status "Setting up Git hooks..."
    
    if (Test-Path ".git") {
        try {
            npx husky install
            Write-Success "Git hooks installed"
        }
        catch {
            Write-Warning "Failed to install Git hooks, but setup can continue"
        }
    }
    else {
        Write-Warning "Not a Git repository, skipping Git hooks setup"
    }
}

function Test-Setup {
    Write-Status "Validating development setup..."
    
    # Check if we can connect to databases
    try {
        npm run test:simple 2>$null
    }
    catch {
        Write-Warning "Simple connectivity test failed, but setup may still be valid"
    }
    
    # Run linting
    try {
        npm run lint --silent
    }
    catch {
        Write-Warning "Linting found issues, run 'npm run lint' to see details"
    }
    
    Write-Success "Setup validation completed"
}

function Main {
    Write-Host "==============================================" -ForegroundColor $Colors.White
    Write-Host "  NestJS URL Shortener Development Setup" -ForegroundColor $Colors.White
    Write-Host "==============================================" -ForegroundColor $Colors.White
    Write-Host ""
    
    Test-NodeJs
    Test-Docker
    Install-Dependencies
    Setup-Environment
    Start-Databases
    Invoke-Migrations
    Invoke-DatabaseSeeding
    Setup-GitHooks
    Test-Setup
    
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor $Colors.White
    Write-Success "Development environment setup completed!"
    Write-Host "==============================================" -ForegroundColor $Colors.White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor $Colors.White
    Write-Host "1. Review and update .env file with your specific configuration"
    Write-Host "2. Start the development server: npm run start:dev"
    Write-Host "3. Visit http://localhost:3000/api/docs for API documentation"
    Write-Host ""
    Write-Host "Useful commands:" -ForegroundColor $Colors.White
    Write-Host "  npm run start:dev     - Start development server with hot reload"
    Write-Host "  npm run test          - Run unit tests"
    Write-Host "  npm run test:e2e      - Run end-to-end tests"
    Write-Host "  npm run lint          - Run ESLint"
    Write-Host "  npm run format        - Format code with Prettier"
    Write-Host ""
    Write-Host "Database management:" -ForegroundColor $Colors.White
    Write-Host "  npm run migration:generate -- -n MigrationName  - Generate new migration"
    Write-Host "  npm run migration:run                           - Run pending migrations"
    Write-Host "  npm run migration:revert                        - Revert last migration"
    Write-Host ""
}

# Handle script interruption
trap {
    Write-Error "Setup interrupted"
    exit 1
}

# Run main function
try {
    Main
}
catch {
    Write-Error "Setup failed: $($_.Exception.Message)"
    exit 1
}