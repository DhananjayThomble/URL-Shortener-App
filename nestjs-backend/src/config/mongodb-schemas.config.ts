import { Schema } from 'mongoose';

/**
 * MongoDB document validation schemas
 * These schemas ensure data integrity at the database level
 */

// Click Event Schema Validation
export const clickEventValidationSchema = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['linkId', 'userId', 'clickedAt', 'ipHash'],
    properties: {
      linkId: {
        bsonType: 'string',
        description: 'Link ID must be a string and is required'
      },
      userId: {
        bsonType: 'string',
        description: 'User ID must be a string and is required'
      },
      clickedAt: {
        bsonType: 'date',
        description: 'Clicked at must be a date and is required'
      },
      ipHash: {
        bsonType: 'string',
        description: 'IP hash must be a string and is required'
      },
      userAgent: {
        bsonType: 'string',
        description: 'User agent must be a string'
      },
      browser: {
        bsonType: 'string',
        description: 'Browser must be a string'
      },
      device: {
        bsonType: 'string',
        description: 'Device must be a string'
      },
      os: {
        bsonType: 'string',
        description: 'OS must be a string'
      },
      country: {
        bsonType: 'string',
        description: 'Country must be a string'
      },
      city: {
        bsonType: 'string',
        description: 'City must be a string'
      },
      referrer: {
        bsonType: 'string',
        description: 'Referrer must be a string'
      },
      utmSource: {
        bsonType: 'string',
        description: 'UTM source must be a string'
      },
      utmMedium: {
        bsonType: 'string',
        description: 'UTM medium must be a string'
      },
      utmCampaign: {
        bsonType: 'string',
        description: 'UTM campaign must be a string'
      },
      isBot: {
        bsonType: 'bool',
        description: 'Is bot must be a boolean'
      },
      sessionId: {
        bsonType: 'string',
        description: 'Session ID must be a string'
      }
    }
  }
};

// Analytics Aggregation Schema Validation
export const analyticsAggregationValidationSchema = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['linkId', 'userId', 'date', 'period', 'totalClicks', 'uniqueClicks'],
    properties: {
      linkId: {
        bsonType: 'string',
        description: 'Link ID must be a string and is required'
      },
      userId: {
        bsonType: 'string',
        description: 'User ID must be a string and is required'
      },
      date: {
        bsonType: 'date',
        description: 'Date must be a date and is required'
      },
      period: {
        bsonType: 'string',
        enum: ['hour', 'day', 'week', 'month'],
        description: 'Period must be one of: hour, day, week, month'
      },
      totalClicks: {
        bsonType: 'int',
        minimum: 0,
        description: 'Total clicks must be a non-negative integer'
      },
      uniqueClicks: {
        bsonType: 'int',
        minimum: 0,
        description: 'Unique clicks must be a non-negative integer'
      },
      deviceBreakdown: {
        bsonType: 'object',
        properties: {
          desktop: { bsonType: 'int', minimum: 0 },
          mobile: { bsonType: 'int', minimum: 0 },
          tablet: { bsonType: 'int', minimum: 0 }
        }
      },
      countryBreakdown: {
        bsonType: 'object',
        description: 'Country breakdown as key-value pairs'
      },
      browserBreakdown: {
        bsonType: 'object',
        description: 'Browser breakdown as key-value pairs'
      },
      referrerBreakdown: {
        bsonType: 'object',
        description: 'Referrer breakdown as key-value pairs'
      }
    }
  }
};

// Bulk Operation Log Schema Validation
export const bulkOperationLogValidationSchema = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['userId', 'operation', 'status', 'createdAt'],
    properties: {
      userId: {
        bsonType: 'string',
        description: 'User ID must be a string and is required'
      },
      operation: {
        bsonType: 'string',
        enum: ['import', 'export'],
        description: 'Operation must be either import or export'
      },
      status: {
        bsonType: 'string',
        enum: ['pending', 'processing', 'completed', 'failed'],
        description: 'Status must be one of: pending, processing, completed, failed'
      },
      fileName: {
        bsonType: 'string',
        description: 'File name must be a string'
      },
      totalRecords: {
        bsonType: 'int',
        minimum: 0,
        description: 'Total records must be a non-negative integer'
      },
      processedRecords: {
        bsonType: 'int',
        minimum: 0,
        description: 'Processed records must be a non-negative integer'
      },
      errorRecords: {
        bsonType: 'int',
        minimum: 0,
        description: 'Error records must be a non-negative integer'
      },
      errors: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          properties: {
            row: { bsonType: 'int', minimum: 0 },
            field: { bsonType: 'string' },
            message: { bsonType: 'string' }
          }
        }
      },
      createdAt: {
        bsonType: 'date',
        description: 'Created at must be a date and is required'
      },
      completedAt: {
        bsonType: 'date',
        description: 'Completed at must be a date'
      }
    }
  }
};

/**
 * Collection indexes for performance optimization
 */
export const mongoIndexes = {
  clicks: [
    { linkId: 1, clickedAt: -1 },
    { userId: 1, clickedAt: -1 },
    { clickedAt: -1 },
    { country: 1, clickedAt: -1 },
    { device: 1, clickedAt: -1 },
    { browser: 1, clickedAt: -1 },
    { sessionId: 1 },
    { ipHash: 1, clickedAt: -1 }
  ],
  analytics_aggregations: [
    { linkId: 1, period: 1, date: -1 },
    { userId: 1, period: 1, date: -1 },
    { date: -1, period: 1 }
  ],
  bulk_operation_logs: [
    { userId: 1, createdAt: -1 },
    { status: 1, createdAt: -1 },
    { operation: 1, createdAt: -1 }
  ]
};