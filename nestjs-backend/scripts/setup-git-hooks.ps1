# Git Hooks Setup Script for Windows
# This script sets up git hooks for code quality automation

param(
    [switch]$Verbose
)

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

function Test-GitRepository {
    if (-not (Test-Path ".git")) {
        Write-Error "Not a git repository. Please run this script from the root of a git repository."
        exit 1
    }
}

function Install-Husky {
    Write-Status "Installing Husky..."
    
    try {
        npx husky install
        
        if (-not (Test-Path ".husky")) {
            Write-Error ".husky directory not found after installation"
            exit 1
        }
        
        Write-Success "Husky installed successfully"
    }
    catch {
        Write-Error "Failed to install Husky: $($_.Exception.Message)"
        exit 1
    }
}

function Setup-PreCommitHook {
    Write-Status "Setting up pre-commit hook..."
    
    try {
        npx husky add .husky/pre-commit "npx lint-staged"
        Write-Success "Pre-commit hook installed"
    }
    catch {
        Write-Error "Failed to set up pre-commit hook: $($_.Exception.Message)"
        exit 1
    }
}

function Setup-CommitMsgHook {
    Write-Status "Setting up commit-msg hook..."
    
    try {
        npx husky add .husky/commit-msg "npx commitlint --edit `$1"
        Write-Success "Commit-msg hook installed"
    }
    catch {
        Write-Error "Failed to set up commit-msg hook: $($_.Exception.Message)"
        exit 1
    }
}

function Setup-PrePushHook {
    Write-Status "Setting up pre-push hook..."
    
    $prePushContent = @'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run tests before pushing
echo "🧪 Running tests before push..."
npm run test:ci

# Check for TypeScript compilation errors
echo "🔍 Checking TypeScript compilation..."
npm run build

echo "✅ Pre-push checks passed!"
'@
    
    try {
        $prePushContent | Out-File -FilePath ".husky/pre-push" -Encoding UTF8
        Write-Success "Pre-push hook installed"
    }
    catch {
        Write-Error "Failed to set up pre-push hook: $($_.Exception.Message)"
        exit 1
    }
}

function Test-HooksSetup {
    Write-Status "Verifying git hooks setup..."
    
    $hooks = @("pre-commit", "commit-msg", "pre-push")
    $allHooksValid = $true
    
    foreach ($hook in $hooks) {
        $hookPath = ".husky/$hook"
        if (Test-Path $hookPath) {
            Write-Success "$hook hook installed"
        }
        else {
            Write-Error "$hook hook not properly installed"
            $allHooksValid = $false
        }
    }
    
    if (-not $allHooksValid) {
        exit 1
    }
}

function Test-Configurations {
    Write-Status "Testing configuration files..."
    
    if (Test-Path ".lintstagedrc.json") {
        Write-Success "Lint-staged configuration found"
    }
    else {
        Write-Warning "Lint-staged configuration not found"
    }
    
    if (Test-Path ".commitlintrc.json") {
        Write-Success "Commitlint configuration found"
    }
    else {
        Write-Warning "Commitlint configuration not found"
    }
}

function Show-Summary {
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor $Colors.White
    Write-Success "Git hooks setup completed successfully!"
    Write-Host "==============================================" -ForegroundColor $Colors.White
    Write-Host ""
    Write-Host "Installed hooks:" -ForegroundColor $Colors.White
    Write-Host "  📝 pre-commit  - Runs linting and formatting on staged files"
    Write-Host "  💬 commit-msg  - Validates commit message format"
    Write-Host "  🚀 pre-push    - Runs tests and build before pushing"
    Write-Host ""
    Write-Host "Commit message format:" -ForegroundColor $Colors.White
    Write-Host "  type(scope): description"
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor $Colors.White
    Write-Host "  feat(auth): add JWT token validation"
    Write-Host "  fix(links): resolve short code generation issue"
    Write-Host "  docs(readme): update installation instructions"
    Write-Host ""
    Write-Host "Available types:" -ForegroundColor $Colors.White
    Write-Host "  feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert"
    Write-Host ""
}

function Main {
    Write-Host "🪝 Setting up Git hooks for code quality automation..." -ForegroundColor $Colors.Blue
    Write-Host ""
    
    Test-GitRepository
    Install-Husky
    Setup-PreCommitHook
    Setup-CommitMsgHook
    Setup-PrePushHook
    Test-HooksSetup
    Test-Configurations
    Show-Summary
}

# Run main function
try {
    Main
}
catch {
    Write-Error "Git hooks setup failed: $($_.Exception.Message)"
    exit 1
}