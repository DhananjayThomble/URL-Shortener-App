# Security Policy

## Reporting a Vulnerability

The SnapURL team takes security bugs seriously. We appreciate your efforts to responsibly disclose your findings and will make every effort to acknowledge your contributions.

### How to Report a Security Vulnerability

**DO NOT** create a public GitHub issue for security vulnerabilities.

Instead, please report security vulnerabilities by emailing:

📧 **security@snapurl.in**

### What to Include

Please include the following information in your report:

- **Description**: Clear description of the vulnerability
- **Impact**: Potential impact and severity
- **Steps to Reproduce**: Detailed steps to reproduce the issue
- **Proof of Concept**: Code or screenshots demonstrating the vulnerability (if applicable)
- **Suggested Fix**: Your recommendations for fixing the issue (optional)
- **Your Contact Information**: So we can follow up with you

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days with preliminary assessment
- **Fix Timeline**: Depends on severity:
  - **Critical**: 24-48 hours
  - **High**: 3-7 days
  - **Medium**: 1-2 weeks
  - **Low**: 2-4 weeks

### Disclosure Policy

- We will investigate all legitimate reports and do our best to quickly fix the problem
- We will keep you informed of our progress
- We ask that you do not publicly disclose the vulnerability until we have had a reasonable time to address it
- We will acknowledge your responsible disclosure in our security advisories (if you wish)

## Supported Versions

We release security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | ✅ Yes             |
| 1.x.x   | ❌ No longer supported |

## Security Best Practices

If you're deploying or contributing to SnapURL, please follow these security best practices:

### For Deployments

1. **Use Strong Secrets**
   - Generate strong random secrets for JWT tokens (min 32 characters)
   - Never commit secrets to version control
   - Use environment variables for all sensitive data

2. **Enable HTTPS**
   - Always use HTTPS in production
   - Configure SSL/TLS certificates properly
   - Enable HSTS headers

3. **Database Security**
   - Use strong database passwords
   - Enable SSL for database connections in production
   - Regularly backup databases
   - Restrict database access to application servers only

4. **Keep Dependencies Updated**
   - Regularly run `npm audit` and fix vulnerabilities
   - Update dependencies to latest stable versions
   - Monitor security advisories for critical dependencies

5. **Rate Limiting**
   - Configure appropriate rate limits for your use case
   - Monitor for unusual traffic patterns
   - Implement IP-based blocking for persistent abuse

### For Contributors

1. **Input Validation**
   - Always validate and sanitize user input
   - Use parameterized queries to prevent SQL injection
   - Implement proper authentication checks on all protected endpoints

2. **Code Review**
   - Security-sensitive code requires review by maintainers
   - Test security features thoroughly
   - Follow secure coding practices

3. **Dependencies**
   - Only add necessary dependencies
   - Check dependency security before adding to project
   - Avoid dependencies with known vulnerabilities

## Security Features

SnapURL includes the following security features:

- ✅ **Authentication**: JWT-based with refresh tokens
- ✅ **Authorization**: Role-based access control (RBAC)
- ✅ **Password Security**: bcrypt hashing with 12 rounds
- ✅ **Rate Limiting**: Redis-backed rate limiting per endpoint
- ✅ **Input Validation**: class-validator on all DTOs
- ✅ **Security Headers**: Helmet.js middleware
- ✅ **CORS**: Whitelist-based CORS configuration
- ✅ **SQL Injection Protection**: Parameterized queries via TypeORM
- ✅ **XSS Protection**: Input sanitization and CSP headers
- ✅ **Session Management**: Secure session handling with Redis
- ✅ **Audit Logging**: Comprehensive security event logging

## Known Security Considerations

### Rate Limiting

The application implements rate limiting, but in high-traffic scenarios, you may need to adjust limits or implement additional DDoS protection at the infrastructure level (e.g., CloudFlare, AWS WAF).

### URL Validation

The application validates URLs before shortening, but advanced phishing or malicious URL detection requires additional services. Consider integrating with URL safety APIs like Google Safe Browsing for production deployments.

### Data Privacy

SnapURL collects analytics data including IP addresses (hashed), user agents, and referrers. Ensure your privacy policy accurately reflects this data collection and complies with applicable regulations (GDPR, CCPA, etc.).

## Security Hall of Fame

We recognize security researchers who responsibly disclose vulnerabilities:

_No reports yet. Be the first!_

## Bug Bounty Program

We are planning to launch a bug bounty program. Stay tuned for updates!

## Contact

- **Security Email**: security@snapurl.in
- **General Support**: support@snapurl.in
- **GitHub Security Advisories**: [View Advisories](https://github.com/DhananjayThomble/URL-Shortener-App/security/advisories)

## Further Reading

- [Security Documentation](./docs/SECURITY.md) - Detailed security practices
- [API Security](./docs/API.md#authentication) - API authentication guide
- [Deployment Security](./docs/DEPLOYMENT.md#security-hardening) - Production security hardening

---

**Last Updated**: 2025-12-28  
**Version**: 2.0.0
