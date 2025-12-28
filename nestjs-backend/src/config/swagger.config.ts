import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class SwaggerConfig {
  static setup(app: INestApplication, configService: ConfigService): void {
    const isProduction = configService.get('NODE_ENV') === 'production';
    
    // Only enable Swagger in non-production environments for security
    if (isProduction) {
      return;
    }

    const config = new DocumentBuilder()
      .setTitle('SnapURL Enterprise API')
      .setDescription(`
        # SnapURL Enterprise URL Shortener API

        A comprehensive URL shortening service with advanced features including:
        - **Advanced Link Management**: Custom aliases, expiration, device targeting
        - **Password Protection**: Secure links with password authentication
        - **Geo-Targeting**: Location-based URL routing
        - **Analytics**: Comprehensive click tracking and reporting
        - **Bio Pages**: Customizable landing pages with multiple links
        - **Bulk Operations**: CSV import/export functionality
        - **Enterprise Features**: Rate limiting, monitoring, and security

        ## Authentication

        This API uses JWT Bearer token authentication. To authenticate:
        1. Register or login to get an access token
        2. Include the token in the Authorization header: \`Bearer <token>\`
        3. Refresh tokens are used for long-term authentication

        ## Rate Limiting

        API endpoints are rate-limited to prevent abuse:
        - Authentication endpoints: 5 requests per 15 minutes
        - Link creation: 100 requests per hour
        - Analytics: 1000 requests per hour
        - General endpoints: 1000 requests per hour

        ## Error Handling

        All errors follow a consistent format:
        \`\`\`json
        {
          "statusCode": 400,
          "error": "Bad Request",
          "message": "Validation failed",
          "timestamp": "2024-01-01T00:00:00.000Z",
          "path": "/api/v1/links",
          "requestId": "req-123456789"
        }
        \`\`\`

        ## Versioning

        This API uses URL versioning. Current version is v1.
        - Base URL: \`/api/v1\`
        - Future versions will be available at \`/api/v2\`, etc.

        ## Support

        For API support, please contact the development team or check the documentation.
      `)
      .setVersion(configService.get('APP_VERSION', '1.0.0'))
      .setContact(
        'SnapURL Development Team',
        'https://github.com/your-org/snapurl',
        'dev@snapurl.com'
      )
      .setLicense('MIT', 'https://opensource.org/licenses/MIT')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth'
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
          description: 'API Key for service-to-service authentication',
        },
        'API-Key'
      )
      .addServer(
        configService.get('BASE_URL', 'http://localhost:3000'),
        'Development Server'
      )
      .addServer(
        configService.get('STAGING_URL', 'https://staging-api.snapurl.com'),
        'Staging Server'
      )
      .addServer(
        configService.get('PRODUCTION_URL', 'https://api.snapurl.com'),
        'Production Server'
      )
      .addTag('auth', 'Authentication and user management')
      .addTag('enhanced-links', 'Advanced URL shortening with features')
      .addTag('bio-pages', 'Bio pages and link-in-bio functionality')
      .addTag('analytics', 'Click tracking and analytics')
      .addTag('tags', 'Link organization and tagging')
      .addTag('bulk-operations', 'CSV import/export operations')
      .addTag('monitoring', 'Health checks and system metrics')
      .addTag('admin', 'Administrative functions')
      .addTag('utils', 'Utility endpoints and helpers')
      .build();

    const document = SwaggerModule.createDocument(app, config, {
      operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
      deepScanRoutes: true,
    });

    // Add custom CSS for better styling
    const customCss = `
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info { margin: 50px 0; }
      .swagger-ui .info .title { color: #3b82f6; }
      .swagger-ui .scheme-container { background: #f8fafc; padding: 20px; border-radius: 8px; }
      .swagger-ui .auth-wrapper { margin-top: 20px; }
      .swagger-ui .btn.authorize { background-color: #3b82f6; border-color: #3b82f6; }
      .swagger-ui .btn.authorize:hover { background-color: #2563eb; border-color: #2563eb; }
      .swagger-ui .opblock.opblock-post { border-color: #10b981; }
      .swagger-ui .opblock.opblock-post .opblock-summary { border-color: #10b981; }
      .swagger-ui .opblock.opblock-get { border-color: #3b82f6; }
      .swagger-ui .opblock.opblock-get .opblock-summary { border-color: #3b82f6; }
      .swagger-ui .opblock.opblock-put { border-color: #f59e0b; }
      .swagger-ui .opblock.opblock-put .opblock-summary { border-color: #f59e0b; }
      .swagger-ui .opblock.opblock-delete { border-color: #ef4444; }
      .swagger-ui .opblock.opblock-delete .opblock-summary { border-color: #ef4444; }
    `;

    SwaggerModule.setup('docs', app, document, {
      customCss,
      customSiteTitle: 'SnapURL API Documentation',
      customfavIcon: '/favicon.ico',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'none',
        filter: true,
        showRequestHeaders: true,
        tryItOutEnabled: true,
        requestInterceptor: (req: any) => {
          // Add request ID for tracking
          req.headers['X-Request-ID'] = `swagger-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          return req;
        },
        responseInterceptor: (res: any) => {
          // Log response for debugging
          if (configService.get('NODE_ENV') === 'development') {
            console.log('Swagger API Response:', {
              status: res.status,
              url: res.url,
              headers: res.headers,
            });
          }
          return res;
        },
      },
      explorer: true,
      swaggerUrl: '/docs-json',
      customJs: [
        'https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-bundle.js',
        'https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-standalone-preset.js',
      ],
    });

    // Also setup JSON endpoint for programmatic access
    SwaggerModule.setup('docs-json', app, document);
  }

  static getApiExamples() {
    return {
      // Authentication Examples
      registerExample: {
        email: 'user@example.com',
        password: 'SecurePassword123!',
        fullName: 'John Doe',
        username: 'johndoe',
      },
      loginExample: {
        email: 'user@example.com',
        password: 'SecurePassword123!',
      },
      
      // Enhanced Link Examples
      createLinkExample: {
        originalUrl: 'https://example.com/very-long-url-that-needs-shortening',
        customAlias: 'my-custom-link',
        title: 'My Awesome Link',
        expiresAt: '2024-12-31T23:59:59.000Z',
        password: 'secret123',
        passwordHint: 'My favorite number',
        iosUrl: 'https://apps.apple.com/app/my-app',
        androidUrl: 'https://play.google.com/store/apps/details?id=com.myapp',
        utmSource: 'newsletter',
        utmMedium: 'email',
        utmCampaign: 'spring-sale',
        metaPixelId: 'FB_PIXEL_123',
        googleAnalyticsId: 'GA_123456',
        geoRules: [
          {
            countryCode: 'US',
            redirectUrl: 'https://example.com/us-landing',
          },
          {
            countryCode: 'UK',
            redirectUrl: 'https://example.com/uk-landing',
          },
        ],
      },

      // Bio Page Examples
      createBioPageExample: {
        username: 'johndoe',
        title: 'John Doe - Digital Creator',
        bio: 'Welcome to my bio page! Check out my latest content and projects.',
        theme: 'modern',
        backgroundColor: '#ffffff',
        textColor: '#000000',
        buttonStyle: 'rounded',
        isPublic: true,
      },

      createBioLinkExample: {
        title: 'My YouTube Channel',
        url: 'https://youtube.com/@johndoe',
        icon: 'youtube',
        position: 1,
        isActive: true,
      },

      // Analytics Examples
      analyticsQueryExample: {
        linkId: 'link-uuid-here',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        groupBy: 'day',
        metrics: ['clicks', 'uniqueClicks', 'countries', 'devices'],
      },

      // Bulk Operations Examples
      bulkImportExample: {
        file: 'CSV file with columns: originalUrl,customAlias,title,tags',
        duplicateHandling: 'skip',
        validateUrls: true,
      },

      // Error Response Examples
      validationErrorExample: {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        details: [
          {
            field: 'originalUrl',
            value: 'invalid-url',
            constraints: {
              isUrl: 'originalUrl must be a valid URL',
            },
            messages: ['originalUrl must be a valid URL'],
          },
        ],
        timestamp: '2024-01-01T00:00:00.000Z',
        path: '/api/v1/enhanced-links',
        requestId: 'req-123456789',
      },

      unauthorizedErrorExample: {
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired token',
        timestamp: '2024-01-01T00:00:00.000Z',
        path: '/api/v1/enhanced-links',
        requestId: 'req-123456789',
      },

      rateLimitErrorExample: {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Try again in 15 minutes.',
        timestamp: '2024-01-01T00:00:00.000Z',
        path: '/api/v1/auth/login',
        requestId: 'req-123456789',
      },
    };
  }
}