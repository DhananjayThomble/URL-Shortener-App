# Multi-stage build for production optimization
# Use specific Node.js version for reproducible builds
FROM node:20-alpine3.19 AS base

# Set environment variables for optimization
ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=warn
ENV NPM_CONFIG_COLOR=false

# Install security updates and required packages
RUN apk update && apk upgrade && \
    apk add --no-cache \
    libc6-compat \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Create app directory with proper permissions
WORKDIR /app

# Install dependencies only when needed
FROM base AS deps

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies with optimizations
RUN npm ci --only=production --no-audit --no-fund && \
    npm cache clean --force && \
    rm -rf ~/.npm

# Build stage - install all dependencies and build
FROM base AS builder

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies) for building
RUN npm ci --no-audit --no-fund

# Copy source code
COPY . .

# Build the application with optimizations
RUN npm run build && \
    npm prune --production && \
    npm cache clean --force && \
    rm -rf ~/.npm

# Production runtime stage
FROM base AS runner

# Create non-root user with specific UID/GID for security
RUN addgroup --system --gid 1001 nestjs && \
    adduser --system --uid 1001 --ingroup nestjs nestjs

# Create necessary directories with proper permissions
RUN mkdir -p /app/logs /app/tmp && \
    chown -R nestjs:nestjs /app

# Copy built application and production dependencies
COPY --from=builder --chown=nestjs:nestjs /app/dist ./dist
COPY --from=builder --chown=nestjs:nestjs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nestjs /app/package.json ./package.json

# Copy health check script
COPY --chown=nestjs:nestjs healthcheck.js ./

# Switch to non-root user
USER nestjs

# Expose the port the app runs on
EXPOSE 3000

# Add labels for better container management
LABEL maintainer="SnapURL Team" \
      version="1.0.0" \
      description="NestJS URL Shortener Backend" \
      org.opencontainers.image.source="https://github.com/your-org/url-shortener" \
      org.opencontainers.image.title="NestJS URL Shortener" \
      org.opencontainers.image.description="Enterprise-grade URL shortener backend built with NestJS"

# Health check with custom script for better reliability
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node healthcheck.js || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application with optimized Node.js flags
CMD ["node", "--max-old-space-size=512", "--optimize-for-size", "dist/main.js"]