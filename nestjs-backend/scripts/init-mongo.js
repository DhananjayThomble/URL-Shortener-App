// MongoDB initialization script for development
db = db.getSiblingDB('url_shortener');

// Create collections with validation
db.createCollection('clicks', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['linkId', 'userId', 'clickedAt', 'ipHash'],
      properties: {
        linkId: {
          bsonType: 'string',
          description: 'Link ID is required and must be a string'
        },
        userId: {
          bsonType: 'string',
          description: 'User ID is required and must be a string'
        },
        clickedAt: {
          bsonType: 'date',
          description: 'Click timestamp is required and must be a date'
        },
        ipHash: {
          bsonType: 'string',
          description: 'IP hash is required and must be a string'
        },
        userAgent: {
          bsonType: 'string'
        },
        browser: {
          bsonType: 'string'
        },
        device: {
          bsonType: 'string'
        },
        os: {
          bsonType: 'string'
        },
        country: {
          bsonType: 'string'
        },
        city: {
          bsonType: 'string'
        },
        referrer: {
          bsonType: 'string'
        },
        utmSource: {
          bsonType: 'string'
        },
        utmMedium: {
          bsonType: 'string'
        },
        utmCampaign: {
          bsonType: 'string'
        },
        isBot: {
          bsonType: 'bool'
        },
        sessionId: {
          bsonType: 'string'
        }
      }
    }
  }
});

// Create indexes for clicks collection
db.clicks.createIndex({ linkId: 1, clickedAt: -1 });
db.clicks.createIndex({ userId: 1, clickedAt: -1 });
db.clicks.createIndex({ clickedAt: -1 });
db.clicks.createIndex({ country: 1 });
db.clicks.createIndex({ device: 1 });
db.clicks.createIndex({ browser: 1 });
db.clicks.createIndex({ sessionId: 1 });

// Create analytics aggregations collection
db.createCollection('analytics_aggregations', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['linkId', 'userId', 'date', 'period'],
      properties: {
        linkId: {
          bsonType: 'string',
          description: 'Link ID is required and must be a string'
        },
        userId: {
          bsonType: 'string',
          description: 'User ID is required and must be a string'
        },
        date: {
          bsonType: 'date',
          description: 'Aggregation date is required and must be a date'
        },
        period: {
          bsonType: 'string',
          enum: ['hour', 'day', 'week', 'month'],
          description: 'Period must be one of: hour, day, week, month'
        },
        totalClicks: {
          bsonType: 'int',
          minimum: 0
        },
        uniqueClicks: {
          bsonType: 'int',
          minimum: 0
        }
      }
    }
  }
});

// Create indexes for analytics aggregations
db.analytics_aggregations.createIndex({ linkId: 1, period: 1, date: -1 });
db.analytics_aggregations.createIndex({ userId: 1, period: 1, date: -1 });
db.analytics_aggregations.createIndex({ date: -1 });

// Create bulk operations collection
db.createCollection('bulk_operations', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'type', 'status', 'createdAt'],
      properties: {
        userId: {
          bsonType: 'string',
          description: 'User ID is required and must be a string'
        },
        type: {
          bsonType: 'string',
          enum: ['import', 'export'],
          description: 'Type must be either import or export'
        },
        status: {
          bsonType: 'string',
          enum: ['pending', 'processing', 'completed', 'failed'],
          description: 'Status must be one of: pending, processing, completed, failed'
        },
        createdAt: {
          bsonType: 'date',
          description: 'Creation timestamp is required and must be a date'
        },
        completedAt: {
          bsonType: 'date'
        },
        progress: {
          bsonType: 'object',
          properties: {
            total: {
              bsonType: 'int',
              minimum: 0
            },
            processed: {
              bsonType: 'int',
              minimum: 0
            },
            errors: {
              bsonType: 'int',
              minimum: 0
            }
          }
        }
      }
    }
  }
});

// Create indexes for bulk operations
db.bulk_operations.createIndex({ userId: 1, createdAt: -1 });
db.bulk_operations.createIndex({ status: 1 });
db.bulk_operations.createIndex({ type: 1 });

print('MongoDB initialization completed successfully');
print('Collections created: clicks, analytics_aggregations, bulk_operations');
print('Indexes created for optimal query performance');