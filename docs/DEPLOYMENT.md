# SnapURL 2.0 - Deployment Guide

> **Production-Ready**: Step-by-step deployment instructions for multiple platforms

## Pre-Deployment Checklist

Before deploying to production, ensure:

- [ ] All tests pass (`npm run test`)
- [ ] Environment variables configured
- [ ] Database migrations are up to date
- [ ] SSL certificates are ready
- [ ] Monitoring and logging configured
- [ ] Backup strategy in place
- [ ] Security audit completed
- [ ] Performance testing done
- [ ] Documentation updated

## Deployment Architecture

### Current Production Setup

```
┌─────────────────────────────────────────────────┐
│            Production Architecture               │
└─────────────────────────────────────────────────┘

Internet
   │
   ├──> Netlify (Frontend)
   │    └──> app.snapurl.in
   │         - React Static Files
   │         - CDN Distribution
   │         - Auto HTTPS
   │
   └──> AWS EC2 (Backend)
        └──> snapurl.in
             - NestJS API
             - Nginx Reverse Proxy
             - PM2 Process Manager
             - Let's Encrypt SSL
             │
             ├──> AWS RDS PostgreSQL
             │    - User data
             │    - Automated backups
             │
             ├──> MongoDB Atlas
             │    - URL data & analytics
             │    - Replica set
             │
             └──> Redis Cloud
                  - Session cache
                  - Rate limiting
```

## Frontend Deployment

### Option 1: Netlify (Recommended - Current)

**Automatic Deployment:**

1. **Connect Repository**
   ```bash
   # Already configured in netlify.toml
   ```

2. **Build Settings** (in Netlify dashboard):
   - Build command: `cd frontend && npm run build`
   - Publish directory: `frontend/dist`
   - Node version: 20

3. **Environment Variables** (Netlify dashboard):
   ```
   NEXT_PUBLIC_API_URL=https://snapurl.in/api/v1
   NEXT_PUBLIC_APP_URL=https://app.snapurl.in
   NODE_VERSION=20
   ```

4. **Deploy**:
   ```bash
   # Push to main branch
   git push origin main
   # Netlify auto-deploys
   ```

**Manual Deployment:**
```bash
cd frontend

# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Deploy
netlify deploy --prod
```

**Custom Domain Setup:**
1. Go to Netlify Dashboard > Domain settings
2. Add custom domain: `app.snapurl.in`
3. Update DNS records:
   ```
   Type: A
   Name: app
   Value: 75.2.60.5 (Netlify IP)
   
   Type: CNAME
   Name: www
   Value: snapurl-app.netlify.app
   ```
4. Enable HTTPS (automatic with Let's Encrypt)

---

### Option 2: Vercel

**Setup:**

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Deploy**:
   ```bash
   cd frontend
   vercel
   ```

3. **Production Deploy**:
   ```bash
   vercel --prod
   ```

4. **Environment Variables**:
   ```bash
   vercel env add NEXT_PUBLIC_API_URL production
   # Enter: https://snapurl.in/api/v1
   
   vercel env add NEXT_PUBLIC_APP_URL production
   # Enter: https://app.snapurl.in
   ```

---

### Option 3: Docker (Self-Hosted)

**Dockerfile** (frontend/Dockerfile):
```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**nginx.conf**:
```nginx
server {
    listen 80;
    server_name app.snapurl.in;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Caching for static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Deploy**:
```bash
cd frontend
docker build -t snapurl-frontend .
docker run -d -p 80:80 snapurl-frontend
```

## Backend Deployment

### Option 1: AWS EC2 (Current Production)

#### Step 1: Launch EC2 Instance

1. **Instance Configuration**:
   - AMI: Ubuntu 22.04 LTS
   - Type: t3.small (minimum) or t3.medium (recommended)
   - Storage: 20 GB SSD
   - Security Group:
     ```
     Port 22 (SSH) - Your IP
     Port 80 (HTTP) - 0.0.0.0/0
     Port 443 (HTTPS) - 0.0.0.0/0
     Port 3000 (API) - 0.0.0.0/0 (or restrict to Nginx)
     ```

2. **Connect to Instance**:
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   ```

#### Step 2: Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2
sudo npm install -g pm2

# Install Nginx
sudo apt install -y nginx

# Install Git
sudo apt install -y git
```

#### Step 3: Deploy Application

```bash
# Clone repository
cd /var/www
sudo git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
cd URL-Shortener-App/backend

# Install dependencies
sudo npm ci --production

# Build application
sudo npm run build

# Create environment file
sudo nano .env
# Paste production environment variables

# Start with PM2
sudo pm2 start dist/main.js --name snapurl-api
sudo pm2 startup
sudo pm2 save
```

#### Step 4: Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/snapurl
```

```nginx
server {
    listen 80;
    server_name snapurl.in www.snapurl.in;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Redirect short URLs
    location ~ ^/[a-zA-Z0-9]{6,}$ {
        proxy_pass http://localhost:3000;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/snapurl /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### Step 5: Setup SSL with Let's Encrypt

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d snapurl.in -d www.snapurl.in

# Auto-renewal is configured by default
# Test renewal
sudo certbot renew --dry-run
```

#### Step 6: Setup Monitoring

```bash
# PM2 monitoring
pm2 monitor

# Setup log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

#### Updates and Maintenance

```bash
# Update application
cd /var/www/URL-Shortener-App/backend
sudo git pull origin main
sudo npm ci --production
sudo npm run build
sudo pm2 restart snapurl-api

# View logs
pm2 logs snapurl-api
pm2 logs snapurl-api --lines 100

# Monitor
pm2 monit
```

---

### Option 2: Heroku

**Prerequisites**:
```bash
# Install Heroku CLI
curl https://cli-assets.heroku.com/install.sh | sh

# Login
heroku login
```

**Deploy**:
```bash
cd backend

# Create Heroku app
heroku create snapurl-api

# Add buildpack
heroku buildpacks:set heroku/nodejs

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set DATABASE_URL=<postgres-url>
heroku config:set MONGODB_URI=<mongo-url>
heroku config:set REDIS_URL=<redis-url>
heroku config:set JWT_SECRET=<secret>
# ... (all other env vars)

# Add PostgreSQL
heroku addons:create heroku-postgresql:mini

# Add Redis
heroku addons:create heroku-redis:mini

# Deploy
git push heroku main

# Run migrations
heroku run npm run migration:run

# View logs
heroku logs --tail
```

**Procfile**:
```
web: npm run start:prod
```

---

### Option 3: DigitalOcean App Platform

**app.yaml**:
```yaml
name: snapurl-backend
region: nyc
services:
  - name: api
    github:
      repo: DhananjayThomble/URL-Shortener-App
      branch: main
      deploy_on_push: true
    source_dir: /backend
    build_command: npm run build
    run_command: npm run start:prod
    envs:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: "8080"
      - key: DATABASE_URL
        type: SECRET
      - key: MONGODB_URI
        type: SECRET
      - key: REDIS_URL
        type: SECRET
    instance_size_slug: basic-xxs
    instance_count: 1
    http_port: 8080
    health_check:
      http_path: /health

databases:
  - name: postgres
    engine: PG
    version: "15"
    size: db-s-1vcpu-1gb

  - name: redis
    engine: REDIS
    version: "7"
```

**Deploy**:
```bash
# Install doctl
brew install doctl

# Authenticate
doctl auth init

# Create app
doctl apps create --spec app.yaml

# Update app
doctl apps update <app-id> --spec app.yaml
```

---

### Option 4: Docker + Docker Compose

**Production docker-compose.yml**:
```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/url_shortener
      - MONGODB_URI=mongodb://mongo:27017/url_shortener
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - mongo
      - redis
    restart: always

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: url_shortener
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: always

  mongo:
    image: mongo:6
    volumes:
      - mongo_data:/data/db
    restart: always

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: always

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/nginx/certs
    depends_on:
      - backend
    restart: always

volumes:
  postgres_data:
  mongo_data:
  redis_data:
```

**Deploy**:
```bash
# Production deployment
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose logs -f

# Update
docker-compose pull
docker-compose up -d
```

## Database Setup

### PostgreSQL (AWS RDS)

1. **Create RDS Instance**:
   - Engine: PostgreSQL 15
   - Instance class: db.t3.micro (free tier) or db.t3.small
   - Storage: 20 GB GP2
   - Enable automated backups (7 days)
   - Enable encryption

2. **Security Group**:
   - Port 5432 from EC2 security group

3. **Connect**:
   ```bash
   DATABASE_URL=postgresql://admin:password@snapurl-db.xyz.us-east-1.rds.amazonaws.com:5432/url_shortener
   ```

### MongoDB Atlas

1. **Create Cluster**:
   - Cloud: AWS
   - Region: Same as backend
   - Tier: M0 (free) or M10 (production)

2. **Database User**:
   - Username: snapurl
   - Password: (generate secure password)

3. **Network Access**:
   - Add EC2 IP or 0.0.0.0/0 (with strong password)

4. **Connection String**:
   ```bash
   MONGODB_URI=mongodb+srv://snapurl:password@cluster.mongodb.net/url_shortener?retryWrites=true&w=majority
   ```

### Redis Cloud

1. **Create Database**:
   - Cloud: AWS
   - Region: Same as backend
   - Plan: Free (30 MB) or paid

2. **Connection**:
   ```bash
   REDIS_URL=redis://default:password@redis-12345.cloud.redislabs.com:12345
   ```

## Environment Variables

### Production Backend (.env)

```bash
# Environment
NODE_ENV=production
PORT=3000

# URLs
FRONTEND_URL=https://app.snapurl.in
BACKEND_URL=https://snapurl.in
SHORT_URL_BASE=https://snapurl.in

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db
MONGODB_URI=mongodb+srv://user:pass@host/db
REDIS_URL=redis://host:6379

# JWT (use strong secrets!)
JWT_SECRET=<64-character-random-string>
JWT_REFRESH_SECRET=<64-character-random-string>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Email
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=noreply@snapurl.in
EMAIL_PASS=<app-specific-password>
EMAIL_FROM=SnapURL <noreply@snapurl.in>

# Security
BCRYPT_ROUNDS=12
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=100

# Monitoring (optional)
SENTRY_DSN=<sentry-dsn>
LOG_LEVEL=info
```

**Generate Secrets**:
```bash
# Generate 64-character random string
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## CI/CD Pipeline

### GitHub Actions

**.github/workflows/deploy.yml**:
```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - name: Install dependencies
        run: |
          cd backend && npm ci
          cd ../frontend && npm ci
      - name: Run tests
        run: |
          cd backend && npm test
          cd ../frontend && npm test
      - name: Build
        run: |
          cd backend && npm run build
          cd ../frontend && npm run build

  deploy-frontend:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to Netlify
        uses: netlify/actions/cli@master
        with:
          args: deploy --prod --dir=frontend/dist
        env:
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}

  deploy-backend:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to EC2
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ubuntu
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd /var/www/URL-Shortener-App/backend
            git pull origin main
            npm ci --production
            npm run build
            pm2 restart snapurl-api
```

## Monitoring & Logging

### PM2 Monitoring

```bash
# Real-time monitoring
pm2 monit

# Web dashboard
pm2 web
# Access at http://localhost:9615

# Logs
pm2 logs
pm2 logs --lines 100
pm2 logs --json
```

### Application Monitoring

**Sentry Setup**:
```bash
npm install @sentry/node

# In main.ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

### Health Checks

**Uptime Monitoring** (UptimeRobot, Pingdom):
- Monitor: https://snapurl.in/health
- Frequency: Every 5 minutes
- Alerts: Email, SMS, Slack

## Backup Strategy

### Database Backups

**Automated Backups**:
```bash
# PostgreSQL (AWS RDS)
# Automated backups enabled (7-day retention)

# MongoDB Atlas
# Point-in-time restore enabled

# Manual backup script
cd backend
npm run db:backup
# Stores in backups/ directory
```

**Backup Schedule**:
- Daily automated backups (AWS RDS, MongoDB Atlas)
- Weekly manual snapshots
- 30-day retention period
- Offsite storage (S3)

## Rollback Procedure

**Quick Rollback**:
```bash
# SSH to EC2
ssh ubuntu@your-ec2-ip

# View PM2 apps
pm2 list

# Restore previous version
cd /var/www/URL-Shortener-App/backend
git log --oneline -5
git checkout <previous-commit-hash>
npm ci --production
npm run build
pm2 restart snapurl-api

# Verify
curl https://snapurl.in/health
```

**Database Rollback**:
```bash
# Revert migrations
npm run migration:revert
```

## Performance Optimization

### Production Optimizations

1. **Enable Compression** (Nginx):
   ```nginx
   gzip on;
   gzip_types text/plain text/css application/json application/javascript;
   ```

2. **Caching Headers**:
   ```nginx
   location /api/ {
       add_header Cache-Control "no-cache, must-revalidate";
   }
   ```

3. **Connection Pooling**:
   ```typescript
   // Already configured in backend
   poolSize: 20
   ```

4. **CDN** (CloudFlare):
   - Frontend assets via CloudFlare CDN
   - DDoS protection
   - WAF rules

## Security Hardening

### Production Security

1. **Firewall Rules**:
   ```bash
   sudo ufw enable
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```

2. **Fail2Ban**:
   ```bash
   sudo apt install fail2ban
   sudo systemctl enable fail2ban
   ```

3. **Security Headers** (Nginx):
   ```nginx
   add_header X-Frame-Options "SAMEORIGIN";
   add_header X-Content-Type-Options "nosniff";
   add_header X-XSS-Protection "1; mode=block";
   ```

4. **Rate Limiting**:
   - Already configured in backend
   - Additional Nginx rate limiting for public endpoints

## Cost Estimation

### Monthly Costs (Production)

| Service | Plan | Cost |
|---------|------|------|
| **Netlify** | Free/Pro | $0-$19 |
| **AWS EC2** | t3.small | $15 |
| **AWS RDS PostgreSQL** | db.t3.micro | $13 |
| **MongoDB Atlas** | M10 | $57 |
| **Redis Cloud** | 1GB | $10 |
| **Domain** | .in domain | $10/year |
| **SSL** | Let's Encrypt | Free |
| **CloudFlare CDN** | Free | $0 |
| **Total** | | **~$105/month** |

**Cost Optimization**:
- Use free tiers during development
- Scale databases based on usage
- Consider reserved instances for EC2

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for deployment issues.

## Cross-References

- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Development**: [DEVELOPMENT.md](./DEVELOPMENT.md)
- **Security**: [SECURITY.md](./SECURITY.md)

---

**Last Updated**: 2025-12-28  
**Version**: 2.0.0  
**Maintainer**: SnapURL Team
