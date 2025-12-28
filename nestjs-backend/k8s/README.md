# Kubernetes Deployment for URL Shortener

This directory contains Kubernetes manifests for deploying the URL Shortener application in a production-ready environment.

## Architecture Overview

The deployment includes:
- **Application**: NestJS backend with horizontal pod autoscaling
- **Databases**: PostgreSQL (relational data), MongoDB (analytics), Redis (cache)
- **Networking**: Ingress with SSL/TLS, Network policies for security
- **Monitoring**: Prometheus metrics collection and alerting
- **Security**: RBAC, Pod Security Policies, Secret management

## Prerequisites

Before deploying, ensure you have:

1. **Kubernetes cluster** (v1.20+) with sufficient resources
2. **kubectl** configured to access your cluster
3. **Ingress controller** (nginx-ingress recommended)
4. **Cert-manager** for SSL certificate management (optional)
5. **Prometheus Operator** for monitoring (optional)

### Resource Requirements

Minimum cluster requirements:
- **CPU**: 8 cores
- **Memory**: 16GB RAM
- **Storage**: 100GB persistent storage
- **Nodes**: 3+ nodes for high availability

## Quick Start

### 1. Update Configuration

Before deploying, update the following files with your specific values:

**secrets.yaml**:
```bash
# Update all CHANGE_ME_IN_PRODUCTION values
- Database passwords
- JWT secrets
- AWS credentials (if using)
- Email configuration
```

**ingress.yaml**:
```bash
# Update domain names
- Replace yourdomain.com with your actual domain
- Update CORS origins
- Configure SSL certificate names
```

**configmap.yaml**:
```bash
# Update application configuration as needed
- CORS_ORIGIN
- BASE_URL
- Feature flags
```

### 2. Deploy to Kubernetes

#### Option A: Using the deployment script (Recommended)

```bash
# Make script executable (Linux/Mac)
chmod +x deploy.sh

# Deploy to production
./deploy.sh prod deploy

# Check deployment status
./deploy.sh prod status

# Update existing deployment
./deploy.sh prod update

# Delete deployment
./deploy.sh prod delete
```

#### Option B: Manual deployment

```bash
# Create namespace
kubectl apply -f namespace.yaml

# Deploy secrets and config
kubectl apply -f secrets.yaml
kubectl apply -f configmap.yaml

# Deploy databases
kubectl apply -f postgres.yaml
kubectl apply -f mongodb.yaml
kubectl apply -f redis.yaml

# Wait for databases to be ready
kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=database --timeout=300s -n url-shortener

# Deploy application
kubectl apply -f app-deployment.yaml

# Deploy autoscaling
kubectl apply -f hpa.yaml

# Deploy networking
kubectl apply -f ingress.yaml

# Deploy monitoring
kubectl apply -f monitoring.yaml
```

#### Option C: Using Kustomize

```bash
# Deploy with kustomize
kubectl apply -k .

# Or build and apply
kustomize build . | kubectl apply -f -
```

### 3. Verify Deployment

```bash
# Check all resources
kubectl get all -n url-shortener

# Check pod status
kubectl get pods -n url-shortener -o wide

# Check services
kubectl get services -n url-shortener

# Check ingress
kubectl get ingress -n url-shortener

# View application logs
kubectl logs -l app.kubernetes.io/name=url-shortener -n url-shortener --tail=50
```

### 4. Access the Application

Once deployed, the application will be available at:
- **API**: `https://api.yourdomain.com`
- **Short URLs**: `https://yourdomain.com/s/{shortCode}`
- **Metrics**: `https://api.yourdomain.com/metrics`

## Configuration

### Environment Variables

The application configuration is managed through ConfigMaps and Secrets:

- **ConfigMap** (`app-config`): Non-sensitive configuration
- **Secret** (`app-secrets`): Sensitive data like passwords and API keys

### Database Configuration

#### PostgreSQL
- **Purpose**: User data, links, bio pages, tags
- **Storage**: 20GB persistent volume
- **Backup**: Configure automated backups for production

#### MongoDB
- **Purpose**: Analytics data, click events
- **Storage**: 50GB persistent volume
- **Indexing**: Optimized indexes for analytics queries

#### Redis
- **Purpose**: Caching, sessions, rate limiting
- **Storage**: 10GB persistent volume
- **Configuration**: Optimized for high-performance caching

### Scaling Configuration

#### Horizontal Pod Autoscaler (HPA)

The application automatically scales based on:
- **CPU utilization**: Target 70%
- **Memory utilization**: Target 80%
- **HTTP requests per second**: Target 100 RPS per pod

**Scaling limits**:
- **Minimum replicas**: 3
- **Maximum replicas**: 20

#### Database Scaling

Databases can be scaled using the provided HPA configurations:
- **PostgreSQL**: 1-3 replicas
- **MongoDB**: 1-3 replicas  
- **Redis**: 1-5 replicas

### Security

#### Network Policies

Network policies restrict traffic between pods:
- Application pods can only communicate with databases
- Database pods only accept connections from application pods
- Ingress traffic is allowed only from ingress controller

#### Pod Security

- **Non-root user**: All containers run as non-root
- **Read-only filesystem**: Where possible
- **Security contexts**: Proper user/group IDs
- **Resource limits**: CPU and memory limits enforced

#### RBAC

Service accounts with minimal required permissions:
- **Prometheus**: Read-only access to metrics endpoints
- **Application**: No special cluster permissions

### Monitoring and Alerting

#### Prometheus Metrics

The application exposes metrics at `/metrics`:
- **HTTP request metrics**: Response times, status codes
- **Database metrics**: Connection pools, query performance
- **Business metrics**: Link creation, click rates
- **System metrics**: CPU, memory, disk usage

#### Alerting Rules

Pre-configured alerts for:
- **High error rate**: >10% 5xx responses
- **High response time**: >1s 95th percentile
- **High resource usage**: >80% CPU/memory
- **Database connectivity**: Connection failures
- **Pod restarts**: Frequent restart detection

#### Grafana Dashboards

Monitoring includes Grafana dashboards for:
- **Application performance**: Response times, throughput
- **Infrastructure**: CPU, memory, disk, network
- **Business metrics**: Link creation, click analytics
- **Database performance**: Query performance, connections

## Maintenance

### Updates and Rollbacks

```bash
# Update application image
kubectl set image deployment/url-shortener-app url-shortener=nestjs-url-shortener:v1.1.0 -n url-shortener

# Check rollout status
kubectl rollout status deployment/url-shortener-app -n url-shortener

# Rollback if needed
kubectl rollout undo deployment/url-shortener-app -n url-shortener
```

### Database Maintenance

#### PostgreSQL
```bash
# Connect to PostgreSQL
kubectl exec -it postgres-0 -n url-shortener -- psql -U urlshortener_user -d url_shortener_prod

# Run maintenance queries
VACUUM ANALYZE;
REINDEX DATABASE url_shortener_prod;
```

#### MongoDB
```bash
# Connect to MongoDB
kubectl exec -it mongodb-0 -n url-shortener -- mongosh url_shortener_prod

# Run maintenance commands
db.runCommand({compact: "clicks"})
db.clicks.reIndex()
```

#### Redis
```bash
# Connect to Redis
kubectl exec -it redis-0 -n url-shortener -- redis-cli

# Check memory usage
INFO memory

# Clear cache if needed
FLUSHDB
```

### Backup and Recovery

#### Database Backups

**PostgreSQL**:
```bash
# Create backup
kubectl exec postgres-0 -n url-shortener -- pg_dump -U urlshortener_user url_shortener_prod > backup.sql

# Restore backup
kubectl exec -i postgres-0 -n url-shortener -- psql -U urlshortener_user url_shortener_prod < backup.sql
```

**MongoDB**:
```bash
# Create backup
kubectl exec mongodb-0 -n url-shortener -- mongodump --db url_shortener_prod --out /tmp/backup

# Restore backup
kubectl exec mongodb-0 -n url-shortener -- mongorestore --db url_shortener_prod /tmp/backup/url_shortener_prod
```

### Troubleshooting

#### Common Issues

**Pods not starting**:
```bash
# Check pod events
kubectl describe pod <pod-name> -n url-shortener

# Check logs
kubectl logs <pod-name> -n url-shortener --previous
```

**Database connection issues**:
```bash
# Check database pod status
kubectl get pods -l app.kubernetes.io/component=database -n url-shortener

# Test database connectivity
kubectl exec -it url-shortener-app-xxx -n url-shortener -- nc -zv postgres-service 5432
```

**High resource usage**:
```bash
# Check resource usage
kubectl top pods -n url-shortener

# Check HPA status
kubectl get hpa -n url-shortener

# Scale manually if needed
kubectl scale deployment url-shortener-app --replicas=5 -n url-shortener
```

#### Logs and Debugging

```bash
# Application logs
kubectl logs -l app.kubernetes.io/name=url-shortener -n url-shortener --tail=100 -f

# Database logs
kubectl logs -l app.kubernetes.io/component=database -n url-shortener --tail=50

# All namespace events
kubectl get events -n url-shortener --sort-by='.lastTimestamp'
```

## Production Checklist

Before deploying to production:

- [ ] Update all secrets with strong, unique values
- [ ] Configure proper domain names and SSL certificates
- [ ] Set up database backups
- [ ] Configure monitoring and alerting
- [ ] Test disaster recovery procedures
- [ ] Review resource limits and requests
- [ ] Configure log aggregation
- [ ] Set up CI/CD pipeline for updates
- [ ] Document operational procedures
- [ ] Train operations team

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review application logs
3. Check Kubernetes events
4. Consult the main project documentation
5. Open an issue in the project repository

## File Structure

```
k8s/
├── README.md                     # This file
├── deploy.sh                     # Deployment script
├── kustomization.yaml            # Kustomize configuration
├── namespace.yaml                # Namespace and resource quotas
├── configmap.yaml                # Application configuration
├── secrets.yaml                  # Sensitive configuration
├── postgres.yaml                 # PostgreSQL database
├── mongodb.yaml                  # MongoDB database
├── redis.yaml                    # Redis cache
├── app-deployment.yaml           # Application deployment
├── hpa.yaml                      # Horizontal Pod Autoscaler
├── ingress.yaml                  # Ingress and network policies
├── monitoring.yaml               # Prometheus monitoring
├── patches/                      # Kustomize patches
│   ├── production-resources.yaml # Production resource limits
│   └── deployment-replicas.yaml  # Replica count patches
└── transformers/                 # Kustomize transformers
    └── add-labels.yaml           # Label transformers
```