#!/bin/bash

# Git Hooks Setup Script
# This script sets up git hooks for code quality automation

set -e

echo "🪝 Setting up Git hooks for code quality automation..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in a git repository
if [ ! -d .git ]; then
    print_error "Not a git repository. Please run this script from the root of a git repository."
    exit 1
fi

# Install husky
print_status "Installing Husky..."
npx husky install

# Make sure .husky directory exists
if [ ! -d .husky ]; then
    print_error ".husky directory not found after installation"
    exit 1
fi

# Set up pre-commit hook
print_status "Setting up pre-commit hook..."
npx husky add .husky/pre-commit "npx lint-staged"
chmod +x .husky/pre-commit

# Set up commit-msg hook
print_status "Setting up commit-msg hook..."
npx husky add .husky/commit-msg "npx commitlint --edit \$1"
chmod +x .husky/commit-msg

# Set up pre-push hook
print_status "Setting up pre-push hook..."
cat > .husky/pre-push << 'EOF'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run tests before pushing
echo "🧪 Running tests before push..."
npm run test:ci

# Check for TypeScript compilation errors
echo "🔍 Checking TypeScript compilation..."
npm run build

echo "✅ Pre-push checks passed!"
EOF
chmod +x .husky/pre-push

# Verify hooks are set up correctly
print_status "Verifying git hooks setup..."

if [ -f .husky/pre-commit ] && [ -x .husky/pre-commit ]; then
    print_success "Pre-commit hook installed and executable"
else
    print_error "Pre-commit hook not properly installed"
    exit 1
fi

if [ -f .husky/commit-msg ] && [ -x .husky/commit-msg ]; then
    print_success "Commit-msg hook installed and executable"
else
    print_error "Commit-msg hook not properly installed"
    exit 1
fi

if [ -f .husky/pre-push ] && [ -x .husky/pre-push ]; then
    print_success "Pre-push hook installed and executable"
else
    print_error "Pre-push hook not properly installed"
    exit 1
fi

# Test lint-staged configuration
print_status "Testing lint-staged configuration..."
if [ -f .lintstagedrc.json ]; then
    print_success "Lint-staged configuration found"
else
    print_warning "Lint-staged configuration not found"
fi

# Test commitlint configuration
print_status "Testing commitlint configuration..."
if [ -f .commitlintrc.json ]; then
    print_success "Commitlint configuration found"
else
    print_warning "Commitlint configuration not found"
fi

echo
echo "=============================================="
print_success "Git hooks setup completed successfully!"
echo "=============================================="
echo
echo "Installed hooks:"
echo "  📝 pre-commit  - Runs linting and formatting on staged files"
echo "  💬 commit-msg  - Validates commit message format"
echo "  🚀 pre-push    - Runs tests and build before pushing"
echo
echo "Commit message format:"
echo "  type(scope): description"
echo
echo "Examples:"
echo "  feat(auth): add JWT token validation"
echo "  fix(links): resolve short code generation issue"
echo "  docs(readme): update installation instructions"
echo
echo "Available types:"
echo "  feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert"
echo