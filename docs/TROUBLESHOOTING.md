# SnapURL 2.0 - Troubleshooting Guide

> **Quick Solutions**: Common issues and their fixes for backend, frontend, and Docker

## Table of Contents

- [Backend Issues](#backend-issues)
- [Frontend Issues](#frontend-issues)
- [Docker Issues](#docker-issues)
- [Database Issues](#database-issues)
- [Authentication Issues](#authentication-issues)
- [Deployment Issues](#deployment-issues)
- [Performance Issues](#performance-issues)

## Backend Issues

### Backend Won't Start

**Problem**: `Error: Cannot find module '@nestjs/core'`

**Solution**:
```bash
cd backend
rm -rf node_modules package-lock.json
npm install
npm run build
npm run start:dev
```

---

**Problem**: `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Cause**: PostgreSQL not running

**Solution**:
```bash
# Check if PostgreSQL is running
pg_isready

# Start PostgreSQL
# macOS
brew services start postgresql@15

# Ubuntu/Linux
sudo systemctl start postgresql

# Docker
docker-compose up -d postgres
```

---

**Problem**: `Error: connect ECONNREFUSED 127.0.0.1:27017`

**Cause**: MongoDB not running

**Solution**:
```bash
# Check if MongoDB is running
mongosh --eval "db.version()"

# Start MongoDB
# macOS
brew services start mongodb-community

# Ubuntu/Linux
sudo systemctl start mongod

# Docker
docker-compose up -d mongo
```

---

**Problem**: `Error: Connection to Redis failed`

**Cause**: Redis not running

**Solution**:
```bash
# Check if Redis is running
redis-cli ping

# Start Redis
# macOS
brew services start redis

# Ubuntu/Linux
sudo systemctl start redis-server

# Docker
docker-compose up -d redis
```

### Migration Issues

**Problem**: `Error: relation "users" does not exist`

**Solution**:
```bash
cd backend
npm run migration:run
```

---

**Problem**: `Error: Migration failed`

**Solution**:
```bash
# Check migration status
npm run migration:show

# Revert last migration
npm run migration:revert

# Try running again
npm run migration:run
```

### JWT Token Issues

**Problem**: `401 Unauthorized: Invalid token`

**Cause**: Token expired or invalid secret

**Solution**:
```bash
# 1. Check JWT_SECRET in .env matches
# 2. Login again to get new token
# 3. Verify token is in Authorization header:
#    Authorization: Bearer <token>
```

---

**Problem**: `Error: jwt malformed`

**Solution**:
```typescript
// Ensure token format is correct
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// NOT just the token without "Bearer "
```

### Rate Limiting Issues

**Problem**: `429 Too Many Requests`

**Solution**:
- Wait 60 seconds and try again
- Reduce request frequency
- Contact admin if limit is too restrictive

**Check Rate Limits**:
```bash
curl -I http://localhost:3000/api/v1/urls
# Look for X-RateLimit-* headers
```

## Frontend Issues

### Frontend Won't Start

**Problem**: `Error: Cannot find module 'vite'`

**Solution**:
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run dev
```

---

**Problem**: `Port 5173 is already in use`

**Solution**:
```bash
# Kill process on port 5173
# macOS/Linux
lsof -ti:5173 | xargs kill -9

# Windows
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# Or change port in vite.config.ts
server: {
  port: 3001
}
```

### API Connection Issues

**Problem**: `Network Error` or `CORS error`

**Cause**: Backend not running or CORS misconfiguration

**Solution**:
```bash
# 1. Verify backend is running
curl http://localhost:3000/health

# 2. Check .env.local has correct API URL
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1

# 3. Restart frontend
npm run dev
```

---

**Problem**: `Failed to fetch` in browser console

**Solution**:
```typescript
// Verify API URL in browser console
console.log(import.meta.env.NEXT_PUBLIC_API_URL);

// Should output: http://localhost:3000/api/v1
```

### Build Issues

**Problem**: `Error: Module build failed`

**Solution**:
```bash
# Clear cache and rebuild
cd frontend
rm -rf node_modules/.vite
npm run build
```

---

**Problem**: `TypeScript errors during build`

**Solution**:
```bash
# Check TypeScript errors
npx tsc --noEmit

# Fix errors or temporarily disable strict mode
# in tsconfig.json (not recommended for production)
```

## Docker Issues

### Docker Compose Won't Start

**Problem**: `Error: Ports are not available`

**Cause**: Ports already in use

**Solution**:
```bash
# Check what's using the ports
lsof -i :3000  # Backend
lsof -i :5432  # PostgreSQL
lsof -i :27017 # MongoDB
lsof -i :6379  # Redis

# Kill processes or change ports in docker-compose.yml
```

---

**Problem**: `Error: No space left on device`

**Solution**:
```bash
# Clean up Docker
docker system prune -a --volumes

# Remove unused images
docker image prune -a

# Check disk space
df -h
```

### Docker Container Crashes

**Problem**: Backend container keeps restarting

**Solution**:
```bash
# Check container logs
docker-compose logs backend

# Common issues:
# 1. Database not ready - add healthcheck
# 2. Missing environment variables
# 3. Port conflicts

# Restart with fresh state
docker-compose down -v
docker-compose up -d
```

---

**Problem**: Cannot connect to database from container

**Solution**:
```bash
# Use service names in DATABASE_URL, not localhost
# ❌ Wrong
DATABASE_URL=postgresql://postgres@localhost:5432/db

# ✅ Correct
DATABASE_URL=postgresql://postgres@postgres:5432/db
```

## Database Issues

### PostgreSQL Connection Failed

**Problem**: `password authentication failed for user "postgres"`

**Solution**:
```bash
# Reset PostgreSQL password
psql -U postgres
ALTER USER postgres PASSWORD 'new_password';
\q

# Update .env
DATABASE_URL=postgresql://postgres:new_password@localhost:5432/url_shortener
```

---

**Problem**: `database "url_shortener" does not exist`

**Solution**:
```bash
# Create database
psql -U postgres
CREATE DATABASE url_shortener;
\q

# Or use createdb command
createdb -U postgres url_shortener
```

### MongoDB Connection Issues

**Problem**: `MongoServerError: Authentication failed`

**Solution**:
```bash
# Connect to MongoDB
mongosh

# Create user
use admin
db.createUser({
  user: "snapurl",
  pwd: "password",
  roles: ["readWrite"]
})

# Update MONGODB_URI in .env
MONGODB_URI=mongodb://snapurl:password@localhost:27017/url_shortener
```

---

**Problem**: `Connection timeout`

**Solution**:
```bash
# Check MongoDB is running
mongosh --eval "db.version()"

# Check firewall/security groups allow port 27017
# For MongoDB Atlas, whitelist your IP
```

### Redis Connection Issues

**Problem**: `Error: Redis connection to localhost:6379 failed`

**Solution**:
```bash
# Check Redis is running
redis-cli ping
# Should return: PONG

# If not running, start it
redis-server
```

---

**Problem**: `Redis OOM (Out of Memory)`

**Solution**:
```bash
# Check Redis memory usage
redis-cli INFO memory

# Increase maxmemory in redis.conf
maxmemory 256mb
maxmemory-policy allkeys-lru

# Or clear Redis
redis-cli FLUSHALL
```

## Authentication Issues

### Cannot Login

**Problem**: `Invalid credentials`

**Solution**:
1. Verify email/password are correct
2. Check if email is verified
3. Try password reset flow

---

**Problem**: Email verification not working

**Solution**:
```bash
# Check email configuration in backend/.env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password  # Not regular password!

# For Gmail, enable "App Passwords":
# Google Account > Security > 2-Step Verification > App Passwords
```

---

**Problem**: Token expired immediately

**Solution**:
```bash
# Check JWT_EXPIRES_IN in .env
JWT_EXPIRES_IN=15m  # 15 minutes

# Check system clock is synchronized
date
# If time is wrong, sync it
```

### Session Issues

**Problem**: Logged out unexpectedly

**Cause**: Session expired or Redis cleared

**Solution**:
- Login again
- Check Redis is running: `redis-cli ping`
- Increase session TTL in backend if needed

## Deployment Issues

### AWS EC2 Deployment

**Problem**: Cannot SSH to EC2 instance

**Solution**:
```bash
# Check security group allows SSH (port 22) from your IP
# Use correct key file with correct permissions
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@your-ec2-ip
```

---

**Problem**: Application not accessible after deployment

**Solution**:
```bash
# Check backend is running
pm2 list

# Check Nginx is running
sudo systemctl status nginx

# Check security group allows HTTP (80) and HTTPS (443)
```

### Netlify Deployment

**Problem**: Build failed on Netlify

**Solution**:
```bash
# Check build logs in Netlify dashboard
# Common issues:
# 1. Wrong build command or directory
# 2. Missing environment variables
# 3. Node version mismatch

# Set correct Node version in Netlify
# Site settings > Build & deploy > Environment
NODE_VERSION=20
```

---

**Problem**: API calls fail in production

**Solution**:
```bash
# Verify environment variables in Netlify
# Site settings > Build & deploy > Environment variables
NEXT_PUBLIC_API_URL=https://snapurl.in/api/v1  # Must start with NEXT_PUBLIC_

# Redeploy after adding variables
```

## Performance Issues

### Slow API Response

**Problem**: Endpoints taking too long

**Diagnosis**:
```bash
# Check database query performance
# PostgreSQL
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'user@example.com';

# MongoDB
db.urls.find({ shortCode: "abc123" }).explain("executionStats");

# Check Redis is caching
redis-cli MONITOR
```

**Solution**:
- Add database indexes
- Enable Redis caching
- Optimize queries
- Increase server resources

---

**Problem**: High memory usage

**Solution**:
```bash
# Check memory usage
free -h  # Linux
top      # Show processes

# Backend (Node.js)
node --max-old-space-size=512 dist/main.js  # Limit memory

# Check for memory leaks
npm install -g clinic
clinic doctor -- node dist/main.js
```

### Slow Frontend Loading

**Problem**: Large bundle size

**Solution**:
```bash
# Analyze bundle
cd frontend
npm run build
npx vite-bundle-analyzer

# Solutions:
# 1. Code splitting
# 2. Lazy loading
# 3. Remove unused dependencies
# 4. Enable compression
```

## Testing Issues

### Tests Failing

**Problem**: `Cannot connect to test database`

**Solution**:
```bash
# Create test database
createdb url_shortener_test

# Set test environment
NODE_ENV=test npm test
```

---

**Problem**: E2E tests timing out

**Solution**:
```typescript
// Increase timeout in test file
test.setTimeout(30000);  // 30 seconds

// Or in Playwright config
timeout: 30 * 1000,
```

## Common Error Messages

### `EADDRINUSE: address already in use`

**Cause**: Port already in use

**Solution**:
```bash
# Find and kill process
lsof -ti:3000 | xargs kill -9

# Or change port in .env
PORT=3001
```

### `Cannot find module`

**Solution**:
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### `Permission denied`

**Solution**:
```bash
# Fix file permissions
chmod +x script.sh

# Or run with sudo (use cautiously)
sudo command
```

## Getting Help

If you can't find a solution here:

1. **Check Logs**:
   ```bash
   # Backend
   cd backend && pm2 logs
   
   # Frontend
   # Check browser console (F12)
   
   # Docker
   docker-compose logs
   ```

2. **Search GitHub Issues**: [GitHub Issues](https://github.com/DhananjayThomble/URL-Shortener-App/issues)

3. **Ask for Help**:
   - [GitHub Discussions](https://github.com/DhananjayThomble/URL-Shortener-App/discussions)
   - Email: support@snapurl.in

4. **Provide Details**:
   - Error message (full stack trace)
   - Steps to reproduce
   - Environment (OS, Node version, etc.)
   - Relevant logs

## Useful Debug Commands

```bash
# Check versions
node --version
npm --version
git --version
docker --version

# Check services
curl http://localhost:3000/health  # Backend health
redis-cli ping                      # Redis
pg_isready                          # PostgreSQL
mongosh --eval "db.version()"      # MongoDB

# Check environment
env | grep -i url                   # Environment variables
npm config list                     # npm configuration

# Check logs
tail -f /var/log/nginx/error.log   # Nginx errors
pm2 logs                            # PM2 logs
journalctl -u nginx -f             # Systemd logs
```

## Cross-References

- **Development Guide**: [DEVELOPMENT.md](./DEVELOPMENT.md)
- **Deployment Guide**: [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Database Guide**: [DATABASE.md](./DATABASE.md)
- **API Documentation**: [API.md](./API.md)

---

**Last Updated**: 2025-12-28  
**Version**: 2.0.0  
**Maintainer**: SnapURL Team
