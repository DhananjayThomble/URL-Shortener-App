import { ApiProperty } from '@nestjs/swagger';

export class ApiResponseDto<T = any> {
  @ApiProperty({
    description: 'HTTP status code',
    example: 200,
  })
  statusCode: number;

  @ApiProperty({
    description: 'Response message',
    example: 'Operation completed successfully',
  })
  message: string;

  @ApiProperty({
    description: 'Response data',
    required: false,
  })
  data?: T;

  @ApiProperty({
    description: 'Request timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Request ID for tracking',
    example: 'req-123456789',
    required: false,
  })
  requestId?: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({
    description: 'HTTP status code',
    example: 400,
  })
  statusCode: number;

  @ApiProperty({
    description: 'Error type',
    example: 'Bad Request',
  })
  error: string;

  @ApiProperty({
    description: 'Error message',
    example: 'Validation failed',
  })
  message: string;

  @ApiProperty({
    description: 'Error details',
    required: false,
    example: {
      field: 'email',
      constraints: {
        isEmail: 'email must be a valid email',
      },
    },
  })
  details?: any;

  @ApiProperty({
    description: 'Error timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Request path that caused the error',
    example: '/api/v1/auth/register',
  })
  path: string;

  @ApiProperty({
    description: 'HTTP method',
    example: 'POST',
  })
  method: string;

  @ApiProperty({
    description: 'Request ID for tracking',
    example: 'req-123456789',
    required: false,
  })
  requestId?: string;
}

export class PaginationMetaDto {
  @ApiProperty({
    description: 'Current page number',
    example: 1,
    minimum: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: 10,
    minimum: 1,
    maximum: 100,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of items',
    example: 100,
    minimum: 0,
  })
  total: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 10,
    minimum: 0,
  })
  totalPages: number;

  @ApiProperty({
    description: 'Whether there is a next page',
    example: true,
  })
  hasNext: boolean;

  @ApiProperty({
    description: 'Whether there is a previous page',
    example: false,
  })
  hasPrev: boolean;
}

export class PaginatedResponseDto<T = any> {
  @ApiProperty({
    description: 'Array of items',
    isArray: true,
  })
  items: T[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  meta: PaginationMetaDto;
}

export class HealthCheckResponseDto {
  @ApiProperty({
    description: 'Overall health status',
    example: 'ok',
    enum: ['ok', 'error'],
  })
  status: 'ok' | 'error';

  @ApiProperty({
    description: 'Health check details',
    example: {
      database: { status: 'up', responseTime: 45 },
      redis: { status: 'up', responseTime: 12 },
      mongodb: { status: 'up', responseTime: 23 },
    },
  })
  info: Record<string, any>;

  @ApiProperty({
    description: 'Error details if any',
    required: false,
    example: {
      database: { status: 'down', message: 'Connection timeout' },
    },
  })
  error?: Record<string, any>;

  @ApiProperty({
    description: 'Additional details',
    required: false,
    example: {
      uptime: 3600,
      memory: { used: 123456789, total: 1073741824 },
    },
  })
  details?: Record<string, any>;
}

export class MetricsResponseDto {
  @ApiProperty({
    description: 'Prometheus metrics in text format',
    example: '# HELP http_requests_total Total number of HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total{method="GET",status="200"} 1234',
  })
  metrics: string;
}

export class RateLimitInfoDto {
  @ApiProperty({
    description: 'Rate limit window in seconds',
    example: 3600,
  })
  windowMs: number;

  @ApiProperty({
    description: 'Maximum requests per window',
    example: 100,
  })
  max: number;

  @ApiProperty({
    description: 'Remaining requests in current window',
    example: 95,
  })
  remaining: number;

  @ApiProperty({
    description: 'Time until window resets (in seconds)',
    example: 2400,
  })
  resetTime: number;

  @ApiProperty({
    description: 'Current request count in window',
    example: 5,
  })
  current: number;
}