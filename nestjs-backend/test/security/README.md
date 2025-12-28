# Security Testing Suite

This directory contains comprehensive security testing scenarios for the NestJS backend, designed to validate security mechanisms and identify potential vulnerabilities.

## Overview

The security testing suite includes:

1. **Authentication Security Tests** - Tests authentication mechanisms and JWT security
2. **Input Validation Security Tests** - Tests input sanitization and injection prevention
3. **Penetration Testing Scenarios** - Simulates real-world attack scenarios

## Test Files

### 1. Authentication Security (`authentication-security.spec.ts`)

Tests authentication and authorization security mechanisms:

#### JWT Token Security
- **Invalid Token Rejection**: Tests rejection of malformed, expired, and invalid JWT tokens
- **Token Signature Validation**: Ensures tokens with invalid signatures are rejected
- **Missing Claims Validation**: Validates required JWT claims (sub, email)
- **Token Expiration**: Tests proper handling of expired tokens

#### Authentication Bypass Prevention
- **Header Manipulation**: Prevents authentication bypass through custom headers
- **SQL Injection in Auth**: Prevents SQL injection in login endpoints
- **NoSQL Injection in Auth**: Prevents NoSQL injection in authentication

#### Brute Force Protection
- **Rate Limiting**: Implements rate limiting for login attempts
- **Account Lockout**: Tests account lockout after multiple failed attempts
- **Progressive Delays**: Validates increasing delays for repeated failures

#### Session Security
- **Token Invalidation**: Ensures tokens are invalidated on logout
- **Token Refresh Security**: Prevents reuse of old tokens after refresh
- **Refresh Token Security**: Prevents refresh token reuse

#### Password Security
- **Strong Password Requirements**: Enforces password complexity rules
- **Secure Password Hashing**: Ensures passwords are properly hashed
- **Password Enumeration Prevention**: Prevents user enumeration through timing

#### Authorization Security
- **Horizontal Privilege Escalation**: Prevents access to other users' data
- **Vertical Privilege Escalation**: Prevents regular users accessing admin functions
- **Resource Ownership Validation**: Ensures users can only access their own resources

### 2. Input Validation Security (`input-validation-security.spec.ts`)

Tests input validation and sanitization mechanisms:

#### SQL Injection Prevention
- **Search Query Injection**: Tests SQL injection in search parameters
- **Sorting Parameter Injection**: Tests SQL injection in sorting parameters
- **Filter Parameter Injection**: Tests SQL injection in filter parameters

#### NoSQL Injection Prevention
- **MongoDB Query Injection**: Tests NoSQL injection in MongoDB queries
- **Complex Object Injection**: Tests injection using MongoDB operators
- **Search Filter Injection**: Tests NoSQL injection in search filters

#### XSS Prevention
- **Script Tag Injection**: Tests XSS prevention in various input fields
- **Event Handler Injection**: Tests prevention of JavaScript event handlers
- **URL-based XSS**: Tests XSS prevention in URL parameters
- **Content Sanitization**: Ensures malicious content is properly sanitized

#### Path Traversal Prevention
- **Directory Traversal**: Tests prevention of directory traversal attacks
- **File Access Attempts**: Tests prevention of unauthorized file access
- **Custom Alias Traversal**: Tests path traversal in custom aliases

#### Command Injection Prevention
- **System Command Injection**: Tests prevention of command injection
- **Shell Metacharacter Filtering**: Tests filtering of dangerous characters
- **Process Execution Prevention**: Tests prevention of arbitrary code execution

#### Additional Security Tests
- **LDAP Injection Prevention**: Tests LDAP injection in directory queries
- **XML/XXE Prevention**: Tests prevention of XML External Entity attacks
- **Header Injection Prevention**: Tests HTTP header injection prevention
- **Mass Assignment Prevention**: Tests prevention of mass assignment vulnerabilities
- **File Upload Security**: Tests file upload validation and security
- **Rate Limiting**: Tests API rate limiting and DoS prevention

### 3. Penetration Testing (`penetration-testing.spec.ts`)

Simulates real-world attack scenarios based on OWASP Top 10:

#### A01: Broken Access Control
- **Unauthorized Admin Access**: Tests prevention of unauthorized admin access
- **Direct Object Reference**: Tests prevention of insecure direct object references
- **Privilege Escalation**: Tests prevention of privilege escalation attacks

#### A02: Cryptographic Failures
- **Secure Password Hashing**: Validates secure password storage
- **JWT Token Security**: Tests JWT token cryptographic security
- **Timing Attack Prevention**: Tests prevention of timing-based attacks

#### A03: Injection Attacks
- **Advanced SQL Injection**: Tests complex SQL injection techniques
- **NoSQL Injection**: Tests advanced NoSQL injection methods
- **LDAP Injection**: Tests LDAP injection in directory services

#### A04: Insecure Design
- **Business Logic Validation**: Tests proper business logic implementation
- **Workflow Bypass Prevention**: Tests prevention of workflow bypass attacks

#### A05: Security Misconfiguration
- **Error Message Security**: Tests that error messages don't expose sensitive info
- **Security Headers**: Validates presence of security HTTP headers
- **Server Information Hiding**: Tests that server information is not exposed

#### A06: Vulnerable Components
- **Malformed Request Handling**: Tests graceful handling of malformed requests
- **Large Payload Handling**: Tests handling of oversized requests

#### A07: Authentication Failures
- **Session Fixation Prevention**: Tests prevention of session fixation attacks
- **Credential Stuffing Prevention**: Tests prevention of credential stuffing

#### A08: Software Integrity Failures
- **File Integrity Validation**: Tests file upload integrity validation

#### A09: Logging Failures
- **Security Event Logging**: Tests proper logging of security events

#### A10: Server-Side Request Forgery (SSRF)
- **SSRF Prevention**: Tests prevention of SSRF attacks in URL validation
- **Redirect-based SSRF**: Tests prevention of SSRF through redirects

#### Advanced Attack Scenarios
- **Race Condition Prevention**: Tests prevention of race condition attacks
- **Cache Poisoning Prevention**: Tests prevention of cache poisoning
- **HTTP Parameter Pollution**: Tests handling of parameter pollution
- **Deserialization Attacks**: Tests prevention of unsafe deserialization

#### Business Logic Security
- **Quota Bypass Prevention**: Tests prevention of resource quota bypass
- **Time Manipulation Prevention**: Tests prevention of time-based attacks

## Configuration

### Jest Configuration (`jest-security.json`)

Specialized Jest configuration for security testing:

- Extended timeout (60 seconds)
- Single worker execution
- ES module support
- Comprehensive test coverage
- Security-focused test environment

### Package.json Scripts

Security testing scripts:

```bash
npm run test:security        # Run all security tests
npm run test:security:auth   # Run authentication security tests
npm run test:security:input  # Run input validation security tests
npm run test:security:pentest # Run penetration testing scenarios
```

## Running Security Tests

### Prerequisites

1. **Database Services**: Ensure PostgreSQL, MongoDB, and Redis are running
2. **Environment Configuration**: Configure `.env.test` with proper settings
3. **Dependencies**: Install all npm dependencies including `cross-env`

### Execution Commands

```bash
# Run all security tests
npm run test:security

# Run specific security test suites
npm run test:security:auth     # Authentication security
npm run test:security:input    # Input validation security
npm run test:security:pentest  # Penetration testing

# Run with custom timeout and verbose output
npm run test:security -- --testTimeout=120000 --verbose
```

## Security Test Categories

### 1. Authentication & Authorization Tests
- JWT token validation and security
- Session management security
- Password security and hashing
- Brute force protection
- Privilege escalation prevention
- Access control validation

### 2. Input Validation & Sanitization Tests
- SQL injection prevention
- NoSQL injection prevention
- XSS prevention and sanitization
- Path traversal prevention
- Command injection prevention
- File upload security

### 3. OWASP Top 10 Security Tests
- Comprehensive coverage of OWASP Top 10 vulnerabilities
- Real-world attack scenario simulation
- Advanced attack technique testing
- Business logic security validation

### 4. Infrastructure Security Tests
- HTTP header security
- Error handling security
- Rate limiting and DoS prevention
- Cache security
- Session security

## Security Assertions and Validations

### Response Validation
- **Status Code Validation**: Ensures proper HTTP status codes for security scenarios
- **Content Validation**: Validates that responses don't contain sensitive information
- **Header Validation**: Checks for proper security headers

### Data Protection Validation
- **Sensitive Data Exposure**: Ensures sensitive data is not exposed in responses
- **Data Sanitization**: Validates that malicious input is properly sanitized
- **Access Control**: Ensures users can only access authorized resources

### Security Mechanism Validation
- **Authentication Enforcement**: Validates that authentication is properly enforced
- **Authorization Checks**: Ensures proper authorization for protected resources
- **Input Validation**: Validates that all input is properly validated and sanitized

## Security Testing Best Practices

### Test Design Principles
1. **Comprehensive Coverage**: Test all attack vectors and vulnerability types
2. **Real-world Scenarios**: Simulate actual attack patterns and techniques
3. **Defense in Depth**: Test multiple layers of security controls
4. **Continuous Testing**: Integrate security tests into CI/CD pipeline

### Attack Simulation
1. **OWASP Top 10**: Cover all OWASP Top 10 vulnerability categories
2. **Advanced Techniques**: Test sophisticated attack methods
3. **Business Logic**: Validate business logic security
4. **Edge Cases**: Test unusual and edge case scenarios

### Validation Strategies
1. **Positive Testing**: Ensure security controls work as expected
2. **Negative Testing**: Ensure attacks are properly blocked
3. **Boundary Testing**: Test limits and edge conditions
4. **Error Handling**: Validate secure error handling

## Security Metrics and Reporting

### Test Coverage Metrics
- **Vulnerability Coverage**: Percentage of known vulnerabilities tested
- **Attack Vector Coverage**: Coverage of different attack methods
- **Endpoint Coverage**: Security testing coverage across all endpoints
- **Authentication Coverage**: Coverage of authentication mechanisms

### Security Assertions
- **Access Control**: 100% of protected endpoints require authentication
- **Input Validation**: 100% of inputs are validated and sanitized
- **Error Handling**: No sensitive information exposed in error messages
- **Security Headers**: All responses include appropriate security headers

### Performance Impact
- **Response Time**: Security controls don't significantly impact performance
- **Resource Usage**: Security tests don't consume excessive resources
- **Scalability**: Security mechanisms scale with application load

## Integration with CI/CD

### Automated Security Testing
- **Pre-commit Hooks**: Run security tests before code commits
- **Pull Request Validation**: Validate security on pull requests
- **Deployment Gates**: Block deployments with security test failures
- **Scheduled Testing**: Regular security test execution

### Security Monitoring
- **Test Result Tracking**: Track security test results over time
- **Vulnerability Detection**: Detect new vulnerabilities early
- **Regression Prevention**: Prevent security regressions
- **Compliance Validation**: Ensure compliance with security standards

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Ensure all database services are running
   - Check connection strings in `.env.test`
   - Verify network connectivity

2. **Authentication Failures**
   - Check JWT secret configuration
   - Verify user creation and login flow
   - Validate token generation and validation

3. **Rate Limiting Issues**
   - Adjust rate limiting configuration for testing
   - Use appropriate delays between requests
   - Consider test isolation requirements

4. **Timeout Issues**
   - Increase Jest timeout for complex security tests
   - Optimize test execution order
   - Consider parallel test execution limitations

### Performance Considerations

1. **Test Execution Time**: Security tests may take longer due to comprehensive validation
2. **Resource Usage**: Some tests may require significant system resources
3. **Database Load**: Security tests may generate substantial database activity
4. **Network Usage**: Some tests may make external network requests

## Security Test Maintenance

### Regular Updates
1. **Vulnerability Database**: Keep attack patterns updated with latest threats
2. **Security Standards**: Update tests based on evolving security standards
3. **Framework Updates**: Maintain compatibility with framework security updates
4. **Compliance Requirements**: Update tests for new compliance requirements

### Test Quality Assurance
1. **False Positive Management**: Minimize false positive security alerts
2. **Test Reliability**: Ensure consistent and reliable test execution
3. **Coverage Analysis**: Regular analysis of security test coverage
4. **Performance Optimization**: Optimize test execution performance

## Conclusion

This comprehensive security testing suite provides:

- **Vulnerability Detection**: Early detection of security vulnerabilities
- **Attack Prevention**: Validation of security controls and defenses
- **Compliance Assurance**: Ensures compliance with security standards
- **Risk Mitigation**: Reduces security risks through thorough testing
- **Continuous Security**: Integrates security testing into development workflow

The suite covers all major security vulnerability categories and provides comprehensive protection against common and advanced attack techniques, ensuring the NestJS backend maintains high security standards.