# SnapURL 2.0 - Security Documentation

> **Security-First**: Comprehensive security practices and vulnerability reporting

## Security Overview

SnapURL 2.0 implements enterprise-grade security practices across all layers:

- **Authentication**: JWT tokens with refresh mechanism
- **Authorization**: Role-based access control (RBAC)
- **Data Protection**: Encryption at rest and in transit
- **Input Validation**: Comprehensive validation and sanitization
- **Rate Limiting**: Protection against abuse
- **Monitoring**: Security event logging and alerting

## Reporting Security Vulnerabilities

### Responsible Disclosure

We take security seriously. If you discover a security vulnerability, please follow responsible disclosure:

**DO NOT** open a public GitHub issue for security vulnerabilities.

**Instead:**

1. **Email**: security@snapurl.in
2. **Subject**: [SECURITY] Brief description
3. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (optional)
   - Your contact information

**Response Timeline**:
- Initial response: Within 48 hours
- Status update: Within 7 days
- Fix timeline: Depends on severity (see below)

### Severity Levels

| Severity | Description | Response Time | Bounty |
|----------|-------------|---------------|--------|
| **Critical** | Remote code execution, data breach | 24-48 hours | $500-$1000 |
| **High** | Authentication bypass, SQL injection | 3-7 days | $200-$500 |
| **Medium** | XSS, CSRF, information disclosure | 1-2 weeks | $50-$200 |
| **Low** | Security misconfigurations | 2-4 weeks | $25-$50 |

### Hall of Fame

We recognize security researchers who responsibly disclose vulnerabilities:
- See [SECURITY_HALL_OF_FAME.md](./SECURITY_HALL_OF_FAME.md)

## Authentication & Authorization

### JWT Token Security

**Access Token**:
- Lifetime: 15 minutes
- Algorithm: HS256
- Payload: userId, email, role
- Storage: Frontend memory (not localStorage for XSS protection)

**Refresh Token**:
- Lifetime: 7 days
- Storage: Database + HTTP-only cookie
- Rotation: New token on each refresh
- Revocation: Immediate on logout/security event

**Implementation**:
```typescript
// Token generation
const accessToken = this.jwtService.sign(
  { userId: user.id, email: user.email, role: user.role },
  { secret: process.env.JWT_SECRET, expiresIn: '15m' }
);

// Token verification with guards
@UseGuards(JwtAuthGuard)
@Get('protected')
async protectedRoute(@Request() req) {
  // req.user contains verified token payload
  return { userId: req.user.userId };
}
```

### Password Security

**Hashing**:
- Algorithm: bcrypt
- Rounds: 12 (configurable, minimum 10)
- Salt: Automatically generated per password

**Password Requirements**:
```typescript
// Enforced via class-validator
@Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
  message: 'Password must contain at least 8 characters, including uppercase, lowercase, number, and special character'
})
password: string;
```

**Minimum Requirements**:
- Length: 8+ characters
- Complexity: Uppercase + lowercase + digit + special char
- No common passwords (checked against breach database)

### Role-Based Access Control (RBAC)

**Roles**:
```typescript
enum UserRole {
  USER = 'user',           // Create/manage own URLs
  ADMIN = 'admin',         // Manage users, view all URLs
  SUPER_ADMIN = 'super_admin'  // Full system access
}
```

**Implementation**:
```typescript
// Role guard
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Get('admin/users')
async getAllUsers() {
  // Only admins can access
}
```

**Permission Matrix**:

| Action | User | Admin | Super Admin |
|--------|------|-------|-------------|
| Create URL | ✓ | ✓ | ✓ |
| View own URLs | ✓ | ✓ | ✓ |
| Delete own URLs | ✓ | ✓ | ✓ |
| View all URLs | ✗ | ✓ | ✓ |
| Manage users | ✗ | ✓ | ✓ |
| System config | ✗ | ✗ | ✓ |

## Input Validation & Sanitization

### Validation Strategy

**Backend Validation** (Primary defense):
```typescript
import { IsUrl, IsNotEmpty, IsOptional, Matches } from 'class-validator';

export class CreateUrlDto {
  @IsUrl({}, { message: 'Invalid URL format' })
  @IsNotEmpty()
  originalUrl: string;

  @IsOptional()
  @Matches(/^[a-zA-Z0-9_-]{3,50}$/, {
    message: 'Custom alias must be 3-50 characters, alphanumeric with dash/underscore'
  })
  customAlias?: string;
}
```

**Frontend Validation** (UX improvement):
```typescript
// React Hook Form + Zod
const schema = z.object({
  originalUrl: z.string().url('Please enter a valid URL'),
  customAlias: z.string()
    .regex(/^[a-zA-Z0-9_-]{3,50}$/, 'Invalid alias format')
    .optional()
});
```

### SQL Injection Prevention

**Parameterized Queries** (TypeORM):
```typescript
// ✅ Safe - parameterized
await this.urlRepository.findOne({
  where: { shortCode: shortCode }
});

// ❌ Dangerous - never use raw queries with user input
await this.urlRepository.query(
  `SELECT * FROM urls WHERE shortCode = '${shortCode}'`
);
```

### XSS Prevention

**Output Encoding**:
```typescript
// React automatically escapes
<div>{userInput}</div>  // Safe

// Dangerous - avoid dangerouslySetInnerHTML
<div dangerouslySetInnerHTML={{ __html: userInput }} />
```

**Content Security Policy**:
```typescript
// Helmet middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", process.env.FRONTEND_URL]
    }
  }
}));
```

### URL Validation

**Whitelist Approach**:
```typescript
export class UrlValidator {
  private static BLOCKED_DOMAINS = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    'internal.company.com'
  ];

  private static ALLOWED_PROTOCOLS = ['http:', 'https:'];

  static validate(url: string): boolean {
    try {
      const parsed = new URL(url);
      
      // Check protocol
      if (!this.ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
      
      // Check blocked domains
      if (this.BLOCKED_DOMAINS.some(domain => 
        parsed.hostname.includes(domain)
      )) {
        throw new Error('Domain not allowed');
      }
      
      return true;
    } catch {
      return false;
    }
  }
}
```

## Rate Limiting

### Rate Limit Configuration

**Backend Implementation**:
```typescript
import { ThrottlerModule } from '@nestjs/throttler';

ThrottlerModule.forRoot({
  ttl: 60,        // Time window in seconds
  limit: 100,     // Max requests per window
  storage: new ThrottlerStorageRedisService(redisClient),
});
```

**Per-Endpoint Limits**:
```typescript
// Custom rate limits
@Throttle(10, 60)  // 10 requests per minute
@Post('urls')
async createUrl() {}

@Throttle(5, 60)   // 5 requests per minute
@Post('auth/login')
async login() {}
```

### Rate Limit Matrix

| Endpoint | Authenticated | Anonymous | Window |
|----------|--------------|-----------|--------|
| `POST /auth/login` | N/A | 5 req | 1 min |
| `POST /auth/register` | N/A | 3 req | 1 hour |
| `POST /urls` | 10 req | N/A | 1 min |
| `GET /urls` | 60 req | N/A | 1 min |
| `GET /:shortCode` | 100 req | 100 req | 1 min |
| All other | 60 req | 30 req | 1 min |

**Rate Limit Headers**:
```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1640995200
```

## Data Protection

### Encryption at Rest

**Database Encryption**:
- PostgreSQL: AWS RDS encryption enabled
- MongoDB: Atlas encryption at rest
- Redis: Not storing sensitive data

**Application-Level Encryption**:
```typescript
import { createCipher, createDecipher } from 'crypto';

class EncryptionService {
  private algorithm = 'aes-256-cbc';
  private key = process.env.ENCRYPTION_KEY;

  encrypt(text: string): string {
    const cipher = createCipher(this.algorithm, this.key);
    return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
  }

  decrypt(encrypted: string): string {
    const decipher = createDecipher(this.algorithm, this.key);
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
  }
}
```

### Encryption in Transit

**TLS/SSL**:
- Production: Let's Encrypt SSL certificates
- All API communication over HTTPS
- HSTS enabled: `Strict-Transport-Security: max-age=31536000`

**Database Connections**:
```typescript
// PostgreSQL
DATABASE_URL=postgresql://user:pass@host:5432/db?ssl=true

// MongoDB
MONGODB_URI=mongodb+srv://user:pass@host/db?ssl=true
```

### Sensitive Data Handling

**Environment Variables**:
```bash
# ❌ Never commit to Git
JWT_SECRET=actual-secret-key

# ✅ Use .env.example with placeholders
JWT_SECRET=your-secret-key-here
```

**Git Secrets Prevention**:
```bash
# .gitignore
.env
.env.*
!.env.example
*.pem
*.key
secrets/
```

## Security Headers

### Helmet.js Configuration

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'
  },
  noSniff: true,
  xssFilter: true
}));
```

### CORS Configuration

```typescript
app.enableCors({
  origin: [
    'https://app.snapurl.in',
    'https://snapurl.in',
    process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : ''
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
});
```

## Session Management

### Session Security

**Redis-backed Sessions**:
```typescript
// Session stored in Redis
const session = {
  userId: user.id,
  role: user.role,
  createdAt: Date.now(),
  lastActive: Date.now()
};

await redis.setex(
  `session:${sessionId}`,
  7 * 24 * 60 * 60,  // 7 days
  JSON.stringify(session)
);
```

**Session Invalidation**:
```typescript
// On logout
await redis.del(`session:${sessionId}`);

// On password change
await redis.del(`session:${userId}:*`);

// On security event
await this.invalidateAllUserSessions(userId);
```

## Audit Logging

### Security Event Logging

**Logged Events**:
- User registration
- Login attempts (success/failure)
- Password changes
- Failed authentication
- Permission escalation attempts
- URL creation/deletion
- Admin actions

**Log Format**:
```typescript
logger.log({
  event: 'USER_LOGIN',
  userId: user.id,
  email: user.email,
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  timestamp: new Date(),
  success: true
});
```

**Failed Login Detection**:
```typescript
// Lock account after 5 failed attempts
const failedAttempts = await redis.get(`login:failed:${email}`);
if (failedAttempts >= 5) {
  throw new UnauthorizedException('Account locked. Contact support.');
}
```

## Security Monitoring

### Real-time Monitoring

**Alerts**:
- Multiple failed login attempts
- Unusual API usage patterns
- Database connection failures
- High error rates
- Suspicious URL patterns

**Monitoring Tools**:
- Winston logging → CloudWatch
- Sentry for error tracking
- PM2 for process monitoring
- Custom security dashboard

## Compliance & Best Practices

### OWASP Top 10 Coverage

| Threat | Protection |
|--------|-----------|
| **A01 Broken Access Control** | RBAC, guards, validation |
| **A02 Cryptographic Failures** | bcrypt, TLS, encryption |
| **A03 Injection** | Parameterized queries, validation |
| **A04 Insecure Design** | Security architecture review |
| **A05 Security Misconfiguration** | Helmet, secure defaults |
| **A06 Vulnerable Components** | Regular updates, audits |
| **A07 Auth Failures** | JWT, rate limiting, MFA ready |
| **A08 Data Integrity** | Validation, signing |
| **A09 Logging Failures** | Winston, audit logs |
| **A10 SSRF** | URL validation, allowlists |

### Security Checklist

**Development**:
- [ ] No secrets in code
- [ ] Input validation on all endpoints
- [ ] Parameterized database queries
- [ ] Error messages don't leak info
- [ ] Dependencies are up to date

**Deployment**:
- [ ] HTTPS enabled
- [ ] Security headers configured
- [ ] Rate limiting enabled
- [ ] Monitoring and alerting active
- [ ] Backup strategy in place
- [ ] Incident response plan documented

**Maintenance**:
- [ ] Monthly security audits
- [ ] Quarterly penetration testing
- [ ] Regular dependency updates
- [ ] Security patch reviews
- [ ] Team security training

## Incident Response

### Security Incident Procedure

1. **Detection**: Monitoring alerts or user report
2. **Assessment**: Determine severity and impact
3. **Containment**: Isolate affected systems
4. **Eradication**: Remove threat and vulnerabilities
5. **Recovery**: Restore normal operations
6. **Lessons Learned**: Post-incident review

### Contact Information

**Security Team**:
- Email: security@snapurl.in
- Emergency: +1-XXX-XXX-XXXX (24/7)
- PGP Key: [Download](https://snapurl.in/pgp-key.asc)

## Security Updates

Stay informed about security updates:
- Subscribe to [security mailing list](mailto:security-subscribe@snapurl.in)
- Follow [@SnapURL_Security](https://twitter.com/SnapURL_Security)
- Check [Security Advisories](https://github.com/DhananjayThomble/URL-Shortener-App/security/advisories)

## Security Testing

### Regular Security Testing

**Automated**:
- npm audit (weekly)
- Snyk vulnerability scanning (CI/CD)
- OWASP ZAP automated scans

**Manual**:
- Quarterly penetration testing
- Code security reviews
- Infrastructure audits

**Bug Bounty Program**:
- Coming soon: Public bug bounty program
- Responsible disclosure rewards

## Additional Resources

- **OWASP**: https://owasp.org/
- **CWE Top 25**: https://cwe.mitre.org/top25/
- **NIST Cybersecurity Framework**: https://www.nist.gov/cyberframework

## Cross-References

- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **API Documentation**: [API.md](./API.md)
- **Deployment**: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

**Last Updated**: 2025-12-28  
**Version**: 2.0.0  
**Security Contact**: security@snapurl.in
