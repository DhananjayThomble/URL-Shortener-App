# Production Deployment Script for NestJS URL Shortener (PowerShell)
# This script handles the complete deployment process on Windows

param(
    [Parameter(Position=0)]
    [ValidateSet("deploy", "rollback", "backup", "health-check")]
    [string]$Action = "deploy"
)

# Configuration
$APP_NAME = "nestjs-url-shortener"
$DOCKER_IMAGE = "$APP_NAME:latest"
$BACKUP_DIR = ".\backups"
$LOG_FILE = ".\logs\deploy.log"

# Ensure log directory exists
if (!(Test-Path ".\logs")) {
    New-Item -ItemType Directory -Path ".\logs" -Force | Out-Null
}

# Logging functions
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    
    switch ($Level) {
        "ERROR" { Write-Host $logMessage -ForegroundColor Red }
        "SUCCESS" { Write-Host $logMessage -ForegroundColor Green }
        "WARNING" { Write-Host $logMessage -ForegroundColor Yellow }
        default { Write-Host $logMessage -ForegroundColor Blue }
    }
    
    Add-Content -Path $LOG_FILE -Value $logMessage
}

function Write-Error-Exit {
    param([string]$Message)
    Write-Log $Message "ERROR"
    exit 1
}

# Check prerequisites
function Test-Prerequisites {
    Write-Log "Checking prerequisites..."
    
    # Check if Docker is installed and running
    try {
        docker --version | Out-Null
    } catch {
        Write-Error-Exit "Docker is not installed or not in PATH"
    }
    
    try {
        docker info | Out-Null
    } catch {
        Write-Error-Exit "Docker daemon is not running"
    }
    
    # Check if Docker Compose is installed
    try {
        docker-compose --version | Out-Null
    } catch {
        Write-Error-Exit "Docker Compose is not installed or not in PATH"
    }
    
    # Check if .env.production exists
    if (!(Test-Path ".env.production")) {
        Write-Error-Exit ".env.production file not found"
    }
    
    Write-Log "Prerequisites check passed" "SUCCESS"
}

# Create backup
function New-Backup {
    Write-Log "Creating backup..."
    
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupName = "backup_$timestamp"
    
    # Create backup directory if it doesn't exist
    if (!(Test-Path $BACKUP_DIR)) {
        New-Item -ItemType Directory -Path $BACKUP_DIR -Force | Out-Null
    }
    
    # Load environment variables
    Get-Content ".env.production" | ForEach-Object {
        if ($_ -match "^([^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
    
    # Backup databases
    Write-Log "Backing up PostgreSQL database..."
    $postgresBackup = "$BACKUP_DIR\postgres_$backupName.sql"
    docker-compose exec -T postgres pg_dump -U $env:POSTGRES_USER $env:POSTGRES_DB > $postgresBackup
    
    Write-Log "Backing up MongoDB database..."
    $mongoBackup = "$BACKUP_DIR\mongodb_$backupName.archive"
    docker-compose exec -T mongodb mongodump --db $env:MONGO_DATABASE --archive > $mongoBackup
    
    # Backup application data
    Write-Log "Backing up application data..."
    if (Test-Path "logs") {
        Compress-Archive -Path "logs\*" -DestinationPath "$BACKUP_DIR\app_data_$backupName.zip" -Force
    }
    
    Write-Log "Backup created: $backupName" "SUCCESS"
    Set-Content -Path "$BACKUP_DIR\latest_backup.txt" -Value $backupName
}

# Build new image
function Build-Image {
    Write-Log "Building new Docker image..."
    
    # Build the image
    docker build -t $DOCKER_IMAGE .
    if ($LASTEXITCODE -ne 0) {
        Write-Error-Exit "Docker build failed"
    }
    
    # Tag with timestamp for rollback capability
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    docker tag $DOCKER_IMAGE "$APP_NAME:$timestamp"
    
    Write-Log "Docker image built successfully" "SUCCESS"
}

# Health check function
function Test-Health {
    param([string]$Url)
    
    $maxAttempts = 30
    $attempt = 1
    
    Write-Log "Performing health check on $Url..."
    
    while ($attempt -le $maxAttempts) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                Write-Log "Health check passed" "SUCCESS"
                return $true
            }
        } catch {
            # Continue to retry
        }
        
        Write-Log "Health check attempt $attempt/$maxAttempts failed, retrying in 10 seconds..."
        Start-Sleep -Seconds 10
        $attempt++
    }
    
    Write-Error-Exit "Health check failed after $maxAttempts attempts"
}

# Deploy application
function Start-Deployment {
    Write-Log "Starting deployment..."
    
    # Copy production environment file
    Copy-Item ".env.production" ".env" -Force
    
    # Pull latest images for dependencies
    Write-Log "Pulling latest dependency images..."
    docker-compose -f docker-compose.prod.yml pull postgres mongodb redis nginx
    
    # Start the application with zero-downtime deployment
    Write-Log "Starting new application containers..."
    docker-compose -f docker-compose.prod.yml up -d --no-deps app
    
    # Wait for application to be ready
    Start-Sleep -Seconds 30
    
    # Perform health check
    Test-Health "http://localhost:3000/health/simple"
    
    # Update other services if needed
    Write-Log "Updating other services..."
    docker-compose -f docker-compose.prod.yml up -d
    
    # Clean up old images (keep last 3)
    Write-Log "Cleaning up old Docker images..."
    $images = docker images $APP_NAME --format "{{.Repository}}:{{.Tag}}" | Select-Object -Skip 3
    if ($images) {
        $images | ForEach-Object { docker rmi $_ 2>$null }
    }
    
    Write-Log "Deployment completed successfully" "SUCCESS"
}

# Rollback function
function Start-Rollback {
    Write-Log "Starting rollback process..."
    
    # Get the latest backup
    if (!(Test-Path "$BACKUP_DIR\latest_backup.txt")) {
        Write-Error-Exit "No backup found for rollback"
    }
    
    $backupName = Get-Content "$BACKUP_DIR\latest_backup.txt"
    
    # Stop current application
    docker-compose -f docker-compose.prod.yml stop app
    
    # Load environment variables
    Get-Content ".env.production" | ForEach-Object {
        if ($_ -match "^([^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
    
    # Restore databases
    Write-Log "Restoring PostgreSQL database..."
    Get-Content "$BACKUP_DIR\postgres_$backupName.sql" | docker-compose -f docker-compose.prod.yml exec -T postgres psql -U $env:POSTGRES_USER -d $env:POSTGRES_DB
    
    Write-Log "Restoring MongoDB database..."
    Get-Content "$BACKUP_DIR\mongodb_$backupName.archive" | docker-compose -f docker-compose.prod.yml exec -T mongodb mongorestore --db $env:MONGO_DATABASE --archive
    
    # Get previous image
    $images = docker images $APP_NAME --format "{{.Repository}}:{{.Tag}}"
    if ($images.Count -lt 2) {
        Write-Error-Exit "No previous image found for rollback"
    }
    $previousImage = $images[1]
    
    # Update docker-compose to use previous image
    $composeContent = Get-Content "docker-compose.prod.yml"
    $composeContent = $composeContent -replace "image: $DOCKER_IMAGE", "image: $previousImage"
    Set-Content "docker-compose.prod.yml" $composeContent
    
    # Start with previous image
    docker-compose -f docker-compose.prod.yml up -d app
    
    # Health check
    Test-Health "http://localhost:3000/health/simple"
    
    Write-Log "Rollback completed successfully" "SUCCESS"
}

# Run database migrations
function Start-Migrations {
    Write-Log "Running database migrations..."
    
    # Wait for databases to be ready
    Start-Sleep -Seconds 10
    
    # Run TypeORM migrations
    docker-compose -f docker-compose.prod.yml exec app npm run migration:run
    
    Write-Log "Database migrations completed" "SUCCESS"
}

# Performance test
function Test-Performance {
    Write-Log "Running performance tests..."
    
    # Test health endpoint
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-WebRequest -Uri "http://localhost:3000/health/simple" -UseBasicParsing | Out-Null
        $stopwatch.Stop()
        Write-Log "Health endpoint response time: $($stopwatch.ElapsedMilliseconds)ms"
    } catch {
        Write-Log "Health endpoint test failed" "WARNING"
    }
    
    # Test main API
    $stopwatch.Restart()
    try {
        Invoke-WebRequest -Uri "http://localhost:3000/info" -UseBasicParsing | Out-Null
        $stopwatch.Stop()
        Write-Log "API endpoint response time: $($stopwatch.ElapsedMilliseconds)ms"
    } catch {
        Write-Log "API endpoint test failed" "WARNING"
    }
    
    Write-Log "Performance tests completed" "SUCCESS"
}

# Main execution
Write-Log "Starting deployment process for $APP_NAME"

switch ($Action) {
    "deploy" {
        Test-Prerequisites
        New-Backup
        Build-Image
        Start-Deployment
        Start-Migrations
        Test-Performance
        Write-Log "Deployment process completed successfully!" "SUCCESS"
    }
    "rollback" {
        Start-Rollback
    }
    "backup" {
        New-Backup
    }
    "health-check" {
        Test-Health "http://localhost:3000/health/simple"
    }
}

Write-Log "Script execution completed" "SUCCESS"