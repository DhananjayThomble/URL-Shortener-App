#!/usr/bin/env node

/**
 * Database Seeding Script
 * Seeds the development database with initial data for testing and development
 */

const { DataSource } = require('typeorm');
const { MongoClient } = require('mongodb');
const Redis = require('ioredis');
const bcrypt = require('bcrypt');
const { nanoid } = require('nanoid');
require('dotenv').config();

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
};

// Database configurations
const postgresConfig = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT) || 5432,
  username: process.env.POSTGRES_USER || 'urlshortener',
  password: process.env.POSTGRES_PASSWORD || 'password123',
  database: process.env.POSTGRES_DB || 'urlshortener_dev',
  synchronize: false,
  logging: false,
};

const mongoConfig = {
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/urlshortener_dev',
};

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: 0,
};

// Sample data
const sampleUsers = [
  {
    email: 'admin@urlshortener.com',
    password: 'Admin123!',
    fullName: 'System Administrator',
    username: 'admin',
    isEmailVerified: true,
  },
  {
    email: 'demo@urlshortener.com',
    password: 'Demo123!',
    fullName: 'Demo User',
    username: 'demo',
    isEmailVerified: true,
  },
  {
    email: 'test@urlshortener.com',
    password: 'Test123!',
    fullName: 'Test User',
    username: 'testuser',
    isEmailVerified: true,
  },
];

const sampleLinks = [
  {
    originalUrl: 'https://www.google.com',
    title: 'Google Search',
    customAlias: 'google',
  },
  {
    originalUrl: 'https://github.com/nestjs/nest',
    title: 'NestJS GitHub Repository',
    customAlias: 'nestjs',
  },
  {
    originalUrl: 'https://docs.nestjs.com',
    title: 'NestJS Documentation',
    customAlias: 'nestjs-docs',
  },
  {
    originalUrl: 'https://www.postgresql.org',
    title: 'PostgreSQL Official Website',
    customAlias: 'postgres',
  },
  {
    originalUrl: 'https://redis.io',
    title: 'Redis Official Website',
    customAlias: 'redis',
  },
];

const sampleTags = [
  { name: 'Development', color: '#3b82f6' },
  { name: 'Documentation', color: '#10b981' },
  { name: 'Database', color: '#f59e0b' },
  { name: 'Framework', color: '#8b5cf6' },
  { name: 'Tools', color: '#ef4444' },
];

const sampleBioPages = [
  {
    username: 'admin-bio',
    title: 'System Administrator',
    bio: 'Managing the URL shortener system and ensuring optimal performance.',
    theme: 'professional',
    backgroundColor: '#ffffff',
    textColor: '#000000',
    buttonStyle: 'rounded',
    isPublic: true,
  },
  {
    username: 'demo-bio',
    title: 'Demo User Profile',
    bio: 'This is a demo bio page showcasing the bio page functionality.',
    theme: 'modern',
    backgroundColor: '#f8fafc',
    textColor: '#1e293b',
    buttonStyle: 'square',
    isPublic: true,
  },
];

// Seeding functions
async function seedPostgreSQL() {
  log.info('Connecting to PostgreSQL...');
  
  const dataSource = new DataSource(postgresConfig);
  await dataSource.initialize();
  
  try {
    log.info('Seeding PostgreSQL with sample data...');
    
    // Clear existing data (in reverse order of dependencies)
    await dataSource.query('TRUNCATE TABLE bio_links CASCADE');
    await dataSource.query('TRUNCATE TABLE bio_pages CASCADE');
    await dataSource.query('TRUNCATE TABLE link_tags CASCADE');
    await dataSource.query('TRUNCATE TABLE tags CASCADE');
    await dataSource.query('TRUNCATE TABLE geo_rules CASCADE');
    await dataSource.query('TRUNCATE TABLE links CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    
    // Seed users
    const userIds = [];
    for (const userData of sampleUsers) {
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const result = await dataSource.query(
        `INSERT INTO users (email, password_hash, full_name, username, is_email_verified, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [userData.email, hashedPassword, userData.fullName, userData.username, userData.isEmailVerified]
      );
      userIds.push(result[0].id);
    }
    log.success(`Seeded ${userIds.length} users`);
    
    // Seed tags
    const tagIds = [];
    for (let i = 0; i < sampleTags.length; i++) {
      const tag = sampleTags[i];
      const userId = userIds[i % userIds.length]; // Distribute tags among users
      const result = await dataSource.query(
        `INSERT INTO tags (user_id, name, color, created_at) 
         VALUES ($1, $2, $3, NOW()) RETURNING id`,
        [userId, tag.name, tag.color]
      );
      tagIds.push(result[0].id);
    }
    log.success(`Seeded ${tagIds.length} tags`);
    
    // Seed links
    const linkIds = [];
    for (let i = 0; i < sampleLinks.length; i++) {
      const link = sampleLinks[i];
      const userId = userIds[i % userIds.length]; // Distribute links among users
      const shortCode = nanoid(8);
      
      const result = await dataSource.query(
        `INSERT INTO links (user_id, original_url, short_code, custom_alias, title, is_active, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING id`,
        [userId, link.originalUrl, shortCode, link.customAlias, link.title, true]
      );
      linkIds.push(result[0].id);
      
      // Associate some links with tags
      if (i < tagIds.length) {
        await dataSource.query(
          `INSERT INTO link_tags (link_id, tag_id, created_at) VALUES ($1, $2, NOW())`,
          [result[0].id, tagIds[i]]
        );
      }
    }
    log.success(`Seeded ${linkIds.length} links`);
    
    // Seed bio pages
    for (let i = 0; i < Math.min(sampleBioPages.length, userIds.length); i++) {
      const bioPage = sampleBioPages[i];
      const userId = userIds[i];
      
      const result = await dataSource.query(
        `INSERT INTO bio_pages (user_id, username, title, bio, theme, background_color, text_color, button_style, is_public, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) RETURNING id`,
        [userId, bioPage.username, bioPage.title, bioPage.bio, bioPage.theme, bioPage.backgroundColor, bioPage.textColor, bioPage.buttonStyle, bioPage.isPublic]
      );
      
      // Add some bio links
      const bioLinks = [
        { title: 'GitHub', url: 'https://github.com', icon: 'github', position: 1 },
        { title: 'LinkedIn', url: 'https://linkedin.com', icon: 'linkedin', position: 2 },
        { title: 'Website', url: 'https://example.com', icon: 'globe', position: 3 },
      ];
      
      for (const bioLink of bioLinks) {
        await dataSource.query(
          `INSERT INTO bio_links (bio_page_id, title, url, icon, position, is_active, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [result[0].id, bioLink.title, bioLink.url, bioLink.icon, bioLink.position, true]
        );
      }
    }
    log.success(`Seeded ${sampleBioPages.length} bio pages`);
    
    log.success('PostgreSQL seeding completed');
  } finally {
    await dataSource.destroy();
  }
}

async function seedMongoDB() {
  log.info('Connecting to MongoDB...');
  
  const client = new MongoClient(mongoConfig.uri);
  await client.connect();
  
  try {
    const db = client.db();
    
    log.info('Seeding MongoDB with sample data...');
    
    // Clear existing collections
    await db.collection('clicks').deleteMany({});
    await db.collection('analytics_aggregations').deleteMany({});
    await db.collection('bulk_operations').deleteMany({});
    
    // Generate sample click events
    const sampleClicks = [];
    const countries = ['US', 'GB', 'DE', 'FR', 'CA', 'AU', 'JP', 'BR'];
    const browsers = ['Chrome', 'Firefox', 'Safari', 'Edge'];
    const devices = ['Desktop', 'Mobile', 'Tablet'];
    const referrers = ['google.com', 'twitter.com', 'facebook.com', 'direct'];
    
    for (let i = 0; i < 100; i++) {
      const clickDate = new Date();
      clickDate.setDate(clickDate.getDate() - Math.floor(Math.random() * 30)); // Last 30 days
      
      sampleClicks.push({
        linkId: `link-${Math.floor(Math.random() * 5) + 1}`,
        userId: `user-${Math.floor(Math.random() * 3) + 1}`,
        clickedAt: clickDate,
        ipHash: `hash-${Math.random().toString(36).substring(7)}`,
        userAgent: `Mozilla/5.0 (compatible; Sample/${Math.random()})`,
        browser: browsers[Math.floor(Math.random() * browsers.length)],
        device: devices[Math.floor(Math.random() * devices.length)],
        os: Math.random() > 0.5 ? 'Windows' : 'macOS',
        country: countries[Math.floor(Math.random() * countries.length)],
        city: `City-${Math.floor(Math.random() * 100)}`,
        referrer: referrers[Math.floor(Math.random() * referrers.length)],
        isBot: Math.random() < 0.05, // 5% bots
        sessionId: `session-${Math.random().toString(36).substring(7)}`,
      });
    }
    
    if (sampleClicks.length > 0) {
      await db.collection('clicks').insertMany(sampleClicks);
      log.success(`Seeded ${sampleClicks.length} click events`);
    }
    
    // Generate sample aggregations
    const sampleAggregations = [];
    for (let i = 0; i < 10; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      sampleAggregations.push({
        linkId: `link-${Math.floor(Math.random() * 5) + 1}`,
        userId: `user-${Math.floor(Math.random() * 3) + 1}`,
        date: date,
        period: 'day',
        totalClicks: Math.floor(Math.random() * 100) + 10,
        uniqueClicks: Math.floor(Math.random() * 50) + 5,
        deviceBreakdown: {
          desktop: Math.floor(Math.random() * 40) + 10,
          mobile: Math.floor(Math.random() * 40) + 10,
          tablet: Math.floor(Math.random() * 20) + 5,
        },
        countryBreakdown: {
          US: Math.floor(Math.random() * 30) + 10,
          GB: Math.floor(Math.random() * 20) + 5,
          DE: Math.floor(Math.random() * 15) + 3,
        },
        browserBreakdown: {
          Chrome: Math.floor(Math.random() * 40) + 15,
          Firefox: Math.floor(Math.random() * 20) + 5,
          Safari: Math.floor(Math.random() * 15) + 3,
        },
      });
    }
    
    if (sampleAggregations.length > 0) {
      await db.collection('analytics_aggregations').insertMany(sampleAggregations);
      log.success(`Seeded ${sampleAggregations.length} analytics aggregations`);
    }
    
    log.success('MongoDB seeding completed');
  } finally {
    await client.close();
  }
}

async function seedRedis() {
  log.info('Connecting to Redis...');
  
  const redis = new Redis(redisConfig);
  
  try {
    log.info('Seeding Redis with sample data...');
    
    // Clear existing data
    await redis.flushdb();
    
    // Set some sample cache entries
    const cacheEntries = [
      { key: 'link:google', value: JSON.stringify({ originalUrl: 'https://www.google.com', clicks: 150 }) },
      { key: 'link:nestjs', value: JSON.stringify({ originalUrl: 'https://github.com/nestjs/nest', clicks: 89 }) },
      { key: 'analytics:daily:2024-01-01', value: JSON.stringify({ totalClicks: 1250, uniqueVisitors: 890 }) },
      { key: 'rate_limit:127.0.0.1', value: '10' },
    ];
    
    for (const entry of cacheEntries) {
      await redis.set(entry.key, entry.value, 'EX', 3600); // 1 hour expiry
    }
    
    log.success(`Seeded ${cacheEntries.length} Redis cache entries`);
    log.success('Redis seeding completed');
  } finally {
    redis.disconnect();
  }
}

// Main seeding function
async function main() {
  console.log('='.repeat(50));
  console.log('  Database Seeding Script');
  console.log('='.repeat(50));
  console.log('');
  
  try {
    await seedPostgreSQL();
    await seedMongoDB();
    await seedRedis();
    
    console.log('');
    console.log('='.repeat(50));
    log.success('Database seeding completed successfully!');
    console.log('='.repeat(50));
    console.log('');
    console.log('Sample accounts created:');
    console.log('- admin@urlshortener.com / Admin123!');
    console.log('- demo@urlshortener.com / Demo123!');
    console.log('- test@urlshortener.com / Test123!');
    console.log('');
    console.log('Sample links created with aliases:');
    console.log('- /google -> https://www.google.com');
    console.log('- /nestjs -> https://github.com/nestjs/nest');
    console.log('- /nestjs-docs -> https://docs.nestjs.com');
    console.log('');
    
  } catch (error) {
    log.error(`Seeding failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Handle script interruption
process.on('SIGINT', () => {
  log.warning('Seeding interrupted');
  process.exit(1);
});

process.on('SIGTERM', () => {
  log.warning('Seeding terminated');
  process.exit(1);
});

// Run the seeding script
if (require.main === module) {
  main();
}

module.exports = { main };