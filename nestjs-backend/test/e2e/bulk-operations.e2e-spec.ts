/**
 * Bulk Operations End-to-End Tests
 * Tests complete bulk import/export workflows
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';
import * as fs from 'fs';
import * as path from 'path';

describe('Bulk Operations (e2e)', () => {
  let app: INestApplication;
  let module: TestingModule;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clear database before each test
    const dataSource = module.get('DataSource');
    await TestDatabaseUtils.clearDatabase(dataSource);

    // Create and authenticate a test user
    const userData = TestDataFactory.createUser();
    const registerResponse = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(userData);

    userId = registerResponse.body.user.id;

    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: userData.email,
        password: userData.password,
      });

    accessToken = loginResponse.body.accessToken;
  });

  describe('CSV Import', () => {
    it('should import links from valid CSV file', async () => {
      // Create test CSV content
      const csvContent = `originalUrl,title,customAlias,utmSource,utmMedium,utmCampaign
https://example1.com,Example 1,example1,newsletter,email,spring-sale
https://example2.com,Example 2,example2,social,facebook,summer-promo
https://example3.com,Example 3,,blog,organic,content-marketing`;

      // Create temporary CSV file
      const tempFilePath = path.join(__dirname, 'temp-import.csv');
      fs.writeFileSync(tempFilePath, csvContent);

      try {
        // Upload CSV file
        const response = await request(app.getHttpServer())
          .post('/api/bulk/import')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', tempFilePath)
          .expect(202); // Accepted for async processing

        expect(response.body).toHaveProperty('jobId');
        expect(response.body.status).toBe('queued');

        const jobId = response.body.jobId;

        // Poll job status until completion
        let jobStatus = 'queued';
        let attempts = 0;
        while (jobStatus !== 'completed' && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const statusResponse = await request(app.getHttpServer())
            .get(`/api/bulk/jobs/${jobId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

          jobStatus = statusResponse.body.status;
          attempts++;
        }

        expect(jobStatus).toBe('completed');

        // Verify links were created
        const linksResponse = await request(app.getHttpServer())
          .get('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(linksResponse.body.data).toHaveLength(3);
        
        // Verify specific link data
        const link1 = linksResponse.body.data.find(l => l.customAlias === 'example1');
        expect(link1).toBeDefined();
        expect(link1.originalUrl).toBe('https://example1.com');
        expect(link1.title).toBe('Example 1');
        expect(link1.utmSource).toBe('newsletter');
        expect(link1.utmMedium).toBe('email');
        expect(link1.utmCampaign).toBe('spring-sale');

      } finally {
        // Cleanup temp file
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it('should handle CSV import with validation errors', async () => {
      // Create CSV with invalid data
      const csvContent = `originalUrl,title,customAlias
invalid-url,Invalid Link,invalid1
https://example.com,Valid Link,valid1
,Missing URL,missing1
https://example2.com,Duplicate Alias,valid1`;

      const tempFilePath = path.join(__dirname, 'temp-invalid.csv');
      fs.writeFileSync(tempFilePath, csvContent);

      try {
        const response = await request(app.getHttpServer())
          .post('/api/bulk/import')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', tempFilePath)
          .expect(202);

        const jobId = response.body.jobId;

        // Wait for job completion
        let jobStatus = 'queued';
        let attempts = 0;
        while (jobStatus !== 'completed' && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const statusResponse = await request(app.getHttpServer())
            .get(`/api/bulk/jobs/${jobId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

          jobStatus = statusResponse.body.status;
          attempts++;
        }

        // Get job results
        const resultResponse = await request(app.getHttpServer())
          .get(`/api/bulk/jobs/${jobId}/results`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(resultResponse.body.totalProcessed).toBe(4);
        expect(resultResponse.body.successCount).toBe(1); // Only valid link
        expect(resultResponse.body.errorCount).toBe(3);
        expect(resultResponse.body.errors).toHaveLength(3);

        // Verify error details
        const errors = resultResponse.body.errors;
        expect(errors.some(e => e.row === 1 && e.error.includes('invalid URL'))).toBe(true);
        expect(errors.some(e => e.row === 3 && e.error.includes('missing'))).toBe(true);
        expect(errors.some(e => e.row === 4 && e.error.includes('duplicate'))).toBe(true);

      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it('should handle duplicate short codes gracefully', async () => {
      // First, create a link manually
      await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalUrl: 'https://existing.com',
          title: 'Existing Link',
          customAlias: 'existing',
        })
        .expect(201);

      // Create CSV with duplicate alias
      const csvContent = `originalUrl,title,customAlias
https://duplicate.com,Duplicate Link,existing
https://new.com,New Link,newlink`;

      const tempFilePath = path.join(__dirname, 'temp-duplicate.csv');
      fs.writeFileSync(tempFilePath, csvContent);

      try {
        const response = await request(app.getHttpServer())
          .post('/api/bulk/import')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', tempFilePath)
          .expect(202);

        const jobId = response.body.jobId;

        // Wait for completion
        let jobStatus = 'queued';
        let attempts = 0;
        while (jobStatus !== 'completed' && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const statusResponse = await request(app.getHttpServer())
            .get(`/api/bulk/jobs/${jobId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

          jobStatus = statusResponse.body.status;
          attempts++;
        }

        const resultResponse = await request(app.getHttpServer())
          .get(`/api/bulk/jobs/${jobId}/results`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(resultResponse.body.successCount).toBe(1); // Only new link
        expect(resultResponse.body.errorCount).toBe(1); // Duplicate rejected
        expect(resultResponse.body.duplicatesHandled).toBe(1);

      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it('should provide progress tracking for large imports', async () => {
      // Create large CSV file
      const rows = Array.from({ length: 100 }, (_, i) => 
        `https://example${i}.com,Example ${i},example${i}`
      );
      const csvContent = `originalUrl,title,customAlias\n${rows.join('\n')}`;

      const tempFilePath = path.join(__dirname, 'temp-large.csv');
      fs.writeFileSync(tempFilePath, csvContent);

      try {
        const response = await request(app.getHttpServer())
          .post('/api/bulk/import')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', tempFilePath)
          .expect(202);

        const jobId = response.body.jobId;

        // Check progress multiple times
        let progress = 0;
        let attempts = 0;
        while (progress < 100 && attempts < 20) {
          await new Promise(resolve => setTimeout(resolve, 200));
          
          const progressResponse = await request(app.getHttpServer())
            .get(`/api/bulk/jobs/${jobId}/progress`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

          progress = progressResponse.body.progress;
          expect(progressResponse.body).toHaveProperty('processed');
          expect(progressResponse.body).toHaveProperty('total');
          expect(progressResponse.body.total).toBe(100);
          
          attempts++;
        }

        expect(progress).toBe(100);

      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });
  });

  describe('CSV Export', () => {
    beforeEach(async () => {
      // Create test links for export
      const linkPromises = Array.from({ length: 5 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://export${i}.com`,
            title: `Export Link ${i}`,
            customAlias: `export${i}`,
            utmSource: 'test',
            utmMedium: 'export',
            utmCampaign: `campaign${i}`,
          })
      );

      await Promise.all(linkPromises);

      // Generate some clicks for analytics
      const linksResponse = await request(app.getHttpServer())
        .get('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      for (const link of linksResponse.body.data) {
        await request(app.getHttpServer())
          .get(`/${link.shortCode}`)
          .expect(302);
      }

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    it('should export all user links with metadata', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/bulk/export')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ format: 'csv', includeAnalytics: true })
        .expect(202);

      const jobId = response.body.jobId;

      // Wait for export completion
      let jobStatus = 'queued';
      let attempts = 0;
      while (jobStatus !== 'completed' && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const statusResponse = await request(app.getHttpServer())
          .get(`/api/bulk/jobs/${jobId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        jobStatus = statusResponse.body.status;
        attempts++;
      }

      expect(jobStatus).toBe('completed');

      // Download export file
      const downloadResponse = await request(app.getHttpServer())
        .get(`/api/bulk/jobs/${jobId}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(downloadResponse.headers['content-type']).toContain('text/csv');
      expect(downloadResponse.headers['content-disposition']).toContain('attachment');

      const csvContent = downloadResponse.text;
      expect(csvContent).toContain('originalUrl,title,customAlias,shortCode');
      expect(csvContent).toContain('utmSource,utmMedium,utmCampaign');
      expect(csvContent).toContain('totalClicks,uniqueClicks');
      expect(csvContent).toContain('export0,export1,export2,export3,export4');
    });

    it('should export filtered links by date range', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const response = await request(app.getHttpServer())
        .post('/api/bulk/export')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          format: 'csv',
          filters: {
            dateFrom: yesterday.toISOString(),
            dateTo: tomorrow.toISOString(),
          },
        })
        .expect(202);

      const jobId = response.body.jobId;

      // Wait for completion
      let jobStatus = 'queued';
      let attempts = 0;
      while (jobStatus !== 'completed' && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const statusResponse = await request(app.getHttpServer())
          .get(`/api/bulk/jobs/${jobId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        jobStatus = statusResponse.body.status;
        attempts++;
      }

      const downloadResponse = await request(app.getHttpServer())
        .get(`/api/bulk/jobs/${jobId}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const csvContent = downloadResponse.text;
      const lines = csvContent.split('\n').filter(line => line.trim());
      expect(lines.length).toBe(6); // Header + 5 data rows
    });

    it('should export links with tag filters', async () => {
      // Create a tag
      const tagResponse = await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Export Tag', color: '#3b82f6' })
        .expect(201);

      const tagId = tagResponse.body.id;

      // Tag some links
      const linksResponse = await request(app.getHttpServer())
        .get('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const firstTwoLinks = linksResponse.body.data.slice(0, 2);
      for (const link of firstTwoLinks) {
        await request(app.getHttpServer())
          .post(`/api/links/${link.id}/tags`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ tagIds: [tagId] })
          .expect(200);
      }

      // Export only tagged links
      const response = await request(app.getHttpServer())
        .post('/api/bulk/export')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          format: 'csv',
          filters: { tagIds: [tagId] },
        })
        .expect(202);

      const jobId = response.body.jobId;

      // Wait for completion
      let jobStatus = 'queued';
      let attempts = 0;
      while (jobStatus !== 'completed' && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const statusResponse = await request(app.getHttpServer())
          .get(`/api/bulk/jobs/${jobId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        jobStatus = statusResponse.body.status;
        attempts++;
      }

      const downloadResponse = await request(app.getHttpServer())
        .get(`/api/bulk/jobs/${jobId}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const csvContent = downloadResponse.text;
      const lines = csvContent.split('\n').filter(line => line.trim());
      expect(lines.length).toBe(3); // Header + 2 tagged links
    });
  });

  describe('Job Management', () => {
    it('should list user bulk operation jobs', async () => {
      // Create a few jobs
      const csvContent = `originalUrl,title\nhttps://test1.com,Test 1\nhttps://test2.com,Test 2`;
      const tempFilePath = path.join(__dirname, 'temp-jobs.csv');
      fs.writeFileSync(tempFilePath, csvContent);

      try {
        // Create import job
        const importResponse = await request(app.getHttpServer())
          .post('/api/bulk/import')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', tempFilePath)
          .expect(202);

        // Create export job
        const exportResponse = await request(app.getHttpServer())
          .post('/api/bulk/export')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ format: 'csv' })
          .expect(202);

        // List jobs
        const jobsResponse = await request(app.getHttpServer())
          .get('/api/bulk/jobs')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(jobsResponse.body.data).toHaveLength(2);
        expect(jobsResponse.body.data.some(job => job.type === 'import')).toBe(true);
        expect(jobsResponse.body.data.some(job => job.type === 'export')).toBe(true);

      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it('should cancel running jobs', async () => {
      // Create large import job
      const rows = Array.from({ length: 1000 }, (_, i) => 
        `https://cancel${i}.com,Cancel ${i}`
      );
      const csvContent = `originalUrl,title\n${rows.join('\n')}`;
      const tempFilePath = path.join(__dirname, 'temp-cancel.csv');
      fs.writeFileSync(tempFilePath, csvContent);

      try {
        const response = await request(app.getHttpServer())
          .post('/api/bulk/import')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', tempFilePath)
          .expect(202);

        const jobId = response.body.jobId;

        // Cancel job quickly
        await request(app.getHttpServer())
          .post(`/api/bulk/jobs/${jobId}/cancel`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        // Check job status
        const statusResponse = await request(app.getHttpServer())
          .get(`/api/bulk/jobs/${jobId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(['cancelled', 'cancelling']).toContain(statusResponse.body.status);

      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it('should clean up old completed jobs', async () => {
      // This would typically be tested with a scheduled job
      // For now, we'll test the cleanup endpoint
      const response = await request(app.getHttpServer())
        .post('/api/bulk/jobs/cleanup')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ olderThanDays: 30 })
        .expect(200);

      expect(response.body).toHaveProperty('deletedCount');
    });
  });

  describe('Error Handling', () => {
    it('should reject invalid file formats', async () => {
      const txtContent = 'This is not a CSV file';
      const tempFilePath = path.join(__dirname, 'temp-invalid.txt');
      fs.writeFileSync(tempFilePath, txtContent);

      try {
        await request(app.getHttpServer())
          .post('/api/bulk/import')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', tempFilePath)
          .expect(400);

      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it('should reject files that are too large', async () => {
      // Create a very large CSV (this would be configured in the app)
      const largeContent = Array.from({ length: 100000 }, (_, i) => 
        `https://large${i}.com,Large ${i}`
      ).join('\n');
      const csvContent = `originalUrl,title\n${largeContent}`;
      
      const tempFilePath = path.join(__dirname, 'temp-large.csv');
      fs.writeFileSync(tempFilePath, csvContent);

      try {
        await request(app.getHttpServer())
          .post('/api/bulk/import')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', tempFilePath)
          .expect(413); // Payload Too Large

      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it('should handle malformed CSV files', async () => {
      const malformedCsv = `originalUrl,title
https://test.com,"Unclosed quote
https://test2.com,Valid Link`;

      const tempFilePath = path.join(__dirname, 'temp-malformed.csv');
      fs.writeFileSync(tempFilePath, malformedCsv);

      try {
        const response = await request(app.getHttpServer())
          .post('/api/bulk/import')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', tempFilePath)
          .expect(202);

        const jobId = response.body.jobId;

        // Wait for job completion
        let jobStatus = 'queued';
        let attempts = 0;
        while (jobStatus !== 'completed' && jobStatus !== 'failed' && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const statusResponse = await request(app.getHttpServer())
            .get(`/api/bulk/jobs/${jobId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

          jobStatus = statusResponse.body.status;
          attempts++;
        }

        // Should handle malformed CSV gracefully
        expect(['completed', 'failed']).toContain(jobStatus);

      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });
  });
});