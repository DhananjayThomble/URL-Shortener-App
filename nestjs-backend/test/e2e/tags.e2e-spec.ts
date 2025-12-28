/**
 * Tags End-to-End Tests
 * Tests complete tag management workflows and cross-module integration
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';

describe('Tags (e2e)', () => {
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

  describe('Tag Creation and Management', () => {
    it('should create a tag successfully', async () => {
      const tagData = {
        name: 'Work Projects',
        color: '#3b82f6',
      };

      const response = await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(tagData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe(tagData.name);
      expect(response.body.color).toBe(tagData.color);
      expect(response.body.userId).toBe(userId);
    });

    it('should enforce scoped uniqueness (same user cannot create duplicate tags)', async () => {
      const tagData = {
        name: 'Duplicate Tag',
        color: '#ef4444',
      };

      // Create first tag
      await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(tagData)
        .expect(201);

      // Try to create duplicate tag
      await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(tagData)
        .expect(409); // Conflict
    });

    it('should allow different users to create tags with same name', async () => {
      const tagData = {
        name: 'Common Tag',
        color: '#10b981',
      };

      // Create tag for first user
      await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(tagData)
        .expect(201);

      // Create second user
      const secondUserData = TestDataFactory.createUser({
        email: 'user2@example.com',
        username: 'testuser2',
      });

      const secondUserResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(secondUserData);

      const secondLoginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: secondUserData.email,
          password: secondUserData.password,
        });

      const secondAccessToken = secondLoginResponse.body.accessToken;

      // Create tag with same name for second user (should succeed)
      await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${secondAccessToken}`)
        .send(tagData)
        .expect(201);
    });

    it('should update tag properties', async () => {
      const tagData = {
        name: 'Original Tag',
        color: '#6366f1',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(tagData)
        .expect(201);

      const tagId = createResponse.body.id;

      const updateData = {
        name: 'Updated Tag',
        color: '#f59e0b',
      };

      const updateResponse = await request(app.getHttpServer())
        .patch(`/api/tags/${tagId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updateData)
        .expect(200);

      expect(updateResponse.body.name).toBe(updateData.name);
      expect(updateResponse.body.color).toBe(updateData.color);
    });

    it('should list user tags with pagination', async () => {
      // Create multiple tags
      const tagPromises = Array.from({ length: 15 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/tags')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            name: `Tag ${i}`,
            color: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
          })
      );

      await Promise.all(tagPromises);

      // Get first page
      const response = await request(app.getHttpServer())
        .get('/api/tags?page=1&limit=10')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(10);
      expect(response.body.meta.total).toBe(15);
      expect(response.body.meta.page).toBe(1);
      expect(response.body.meta.totalPages).toBe(2);
    });

    it('should search tags by name', async () => {
      // Create test tags
      await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Work Projects', color: '#3b82f6' });

      await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Personal Tasks', color: '#ef4444' });

      await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Work Meetings', color: '#10b981' });

      // Search for "work"
      const response = await request(app.getHttpServer())
        .get('/api/tags?search=work')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every(tag => 
        tag.name.toLowerCase().includes('work')
      )).toBe(true);
    });
  });

  describe('Link-Tag Associations', () => {
    let linkId: string;
    let tagIds: string[];

    beforeEach(async () => {
      // Create a test link
      const linkResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalUrl: 'https://example.com',
          title: 'Test Link for Tagging',
        });

      linkId = linkResponse.body.id;

      // Create test tags
      const tagPromises = [
        { name: 'Important', color: '#ef4444' },
        { name: 'Work', color: '#3b82f6' },
        { name: 'Archive', color: '#6b7280' },
      ].map(tagData =>
        request(app.getHttpServer())
          .post('/api/tags')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(tagData)
      );

      const tagResponses = await Promise.all(tagPromises);
      tagIds = tagResponses.map(response => response.body.id);
    });

    it('should associate tags with a link', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/links/${linkId}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: [tagIds[0], tagIds[1]] })
        .expect(200);

      expect(response.body.tags).toHaveLength(2);
      expect(response.body.tags.map(t => t.id)).toContain(tagIds[0]);
      expect(response.body.tags.map(t => t.id)).toContain(tagIds[1]);
    });

    it('should remove tags from a link', async () => {
      // First associate tags
      await request(app.getHttpServer())
        .post(`/api/links/${linkId}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: tagIds })
        .expect(200);

      // Remove specific tags
      const response = await request(app.getHttpServer())
        .delete(`/api/links/${linkId}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: [tagIds[0], tagIds[2]] })
        .expect(200);

      expect(response.body.tags).toHaveLength(1);
      expect(response.body.tags[0].id).toBe(tagIds[1]);
    });

    it('should replace all tags on a link', async () => {
      // First associate some tags
      await request(app.getHttpServer())
        .post(`/api/links/${linkId}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: [tagIds[0], tagIds[1]] })
        .expect(200);

      // Replace with different tags
      const response = await request(app.getHttpServer())
        .put(`/api/links/${linkId}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: [tagIds[2]] })
        .expect(200);

      expect(response.body.tags).toHaveLength(1);
      expect(response.body.tags[0].id).toBe(tagIds[2]);
    });

    it('should filter links by tags', async () => {
      // Create multiple links and tag them differently
      const link1Response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ originalUrl: 'https://work1.com', title: 'Work Link 1' });

      const link2Response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ originalUrl: 'https://work2.com', title: 'Work Link 2' });

      const link3Response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ originalUrl: 'https://personal.com', title: 'Personal Link' });

      // Tag the links
      await request(app.getHttpServer())
        .post(`/api/links/${link1Response.body.id}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: [tagIds[1]] }); // Work tag

      await request(app.getHttpServer())
        .post(`/api/links/${link2Response.body.id}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: [tagIds[1], tagIds[0]] }); // Work + Important tags

      await request(app.getHttpServer())
        .post(`/api/links/${link3Response.body.id}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: [tagIds[0]] }); // Important tag only

      // Filter by Work tag
      const workLinksResponse = await request(app.getHttpServer())
        .get(`/api/links?tagIds=${tagIds[1]}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(workLinksResponse.body.data).toHaveLength(2);
      expect(workLinksResponse.body.data.every(link => 
        link.tags.some(tag => tag.id === tagIds[1])
      )).toBe(true);

      // Filter by multiple tags (AND operation)
      const multiTagResponse = await request(app.getHttpServer())
        .get(`/api/links?tagIds=${tagIds[1]},${tagIds[0]}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(multiTagResponse.body.data).toHaveLength(1);
      expect(multiTagResponse.body.data[0].id).toBe(link2Response.body.id);
    });

    it('should get links associated with a specific tag', async () => {
      // Associate the test link with a tag
      await request(app.getHttpServer())
        .post(`/api/links/${linkId}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: [tagIds[0]] })
        .expect(200);

      // Get links for the tag
      const response = await request(app.getHttpServer())
        .get(`/api/tags/${tagIds[0]}/links`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(linkId);
    });
  });

  describe('Tag Deletion and Cascade', () => {
    it('should delete a tag and remove all associations', async () => {
      // Create a tag
      const tagResponse = await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'To Delete', color: '#ef4444' })
        .expect(201);

      const tagId = tagResponse.body.id;

      // Create links and associate with the tag
      const linkPromises = Array.from({ length: 3 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://delete${i}.com`,
            title: `Delete Link ${i}`,
          })
      );

      const linkResponses = await Promise.all(linkPromises);

      // Associate all links with the tag
      for (const linkResponse of linkResponses) {
        await request(app.getHttpServer())
          .post(`/api/links/${linkResponse.body.id}/tags`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ tagIds: [tagId] })
          .expect(200);
      }

      // Verify associations exist
      const tagLinksResponse = await request(app.getHttpServer())
        .get(`/api/tags/${tagId}/links`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(tagLinksResponse.body.data).toHaveLength(3);

      // Delete the tag
      await request(app.getHttpServer())
        .delete(`/api/tags/${tagId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Verify tag is deleted
      await request(app.getHttpServer())
        .get(`/api/tags/${tagId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      // Verify links still exist but without the tag
      for (const linkResponse of linkResponses) {
        const linkDetailResponse = await request(app.getHttpServer())
          .get(`/api/links/${linkResponse.body.id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(linkDetailResponse.body.tags).toHaveLength(0);
      }
    });

    it('should handle bulk tag deletion', async () => {
      // Create multiple tags
      const tagPromises = Array.from({ length: 5 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/tags')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            name: `Bulk Delete ${i}`,
            color: '#6366f1',
          })
      );

      const tagResponses = await Promise.all(tagPromises);
      const tagIds = tagResponses.map(response => response.body.id);

      // Delete multiple tags
      const response = await request(app.getHttpServer())
        .delete('/api/tags/bulk')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: tagIds.slice(0, 3) })
        .expect(200);

      expect(response.body.deletedCount).toBe(3);

      // Verify remaining tags
      const remainingTagsResponse = await request(app.getHttpServer())
        .get('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(remainingTagsResponse.body.data).toHaveLength(2);
    });
  });

  describe('Tag Analytics Integration', () => {
    it('should provide tag usage statistics', async () => {
      // Create tags
      const tagResponse = await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Analytics Tag', color: '#10b981' })
        .expect(201);

      const tagId = tagResponse.body.id;

      // Create links and associate with tag
      const linkPromises = Array.from({ length: 3 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://analytics${i}.com`,
            title: `Analytics Link ${i}`,
          })
      );

      const linkResponses = await Promise.all(linkPromises);

      for (const linkResponse of linkResponses) {
        await request(app.getHttpServer())
          .post(`/api/links/${linkResponse.body.id}/tags`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ tagIds: [tagId] })
          .expect(200);
      }

      // Generate clicks for tagged links
      for (const linkResponse of linkResponses) {
        for (let i = 0; i < 2; i++) {
          await request(app.getHttpServer())
            .get(`/${linkResponse.body.shortCode}`)
            .expect(302);
        }
      }

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get tag analytics
      const analyticsResponse = await request(app.getHttpServer())
        .get(`/api/tags/${tagId}/analytics`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(analyticsResponse.body.linksCount).toBe(3);
      expect(analyticsResponse.body.totalClicks).toBe(6);
      expect(analyticsResponse.body.averageClicksPerLink).toBe(2);
    });

    it('should provide tag performance comparison', async () => {
      // Create multiple tags
      const tagPromises = [
        { name: 'High Performance', color: '#10b981' },
        { name: 'Low Performance', color: '#ef4444' },
      ].map(tagData =>
        request(app.getHttpServer())
          .post('/api/tags')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(tagData)
      );

      const tagResponses = await Promise.all(tagPromises);
      const [highPerfTagId, lowPerfTagId] = tagResponses.map(r => r.body.id);

      // Create links for each tag
      const highPerfLink = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ originalUrl: 'https://high-perf.com', title: 'High Performance Link' });

      const lowPerfLink = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ originalUrl: 'https://low-perf.com', title: 'Low Performance Link' });

      // Associate tags
      await request(app.getHttpServer())
        .post(`/api/links/${highPerfLink.body.id}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: [highPerfTagId] });

      await request(app.getHttpServer())
        .post(`/api/links/${lowPerfLink.body.id}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tagIds: [lowPerfTagId] });

      // Generate different click volumes
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .get(`/${highPerfLink.body.shortCode}`)
          .expect(302);
      }

      for (let i = 0; i < 2; i++) {
        await request(app.getHttpServer())
          .get(`/${lowPerfLink.body.shortCode}`)
          .expect(302);
      }

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get tag comparison
      const comparisonResponse = await request(app.getHttpServer())
        .get(`/api/tags/analytics/comparison?tagIds=${highPerfTagId},${lowPerfTagId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(comparisonResponse.body).toHaveLength(2);
      
      const highPerfStats = comparisonResponse.body.find(t => t.tagId === highPerfTagId);
      const lowPerfStats = comparisonResponse.body.find(t => t.tagId === lowPerfTagId);

      expect(highPerfStats.totalClicks).toBe(10);
      expect(lowPerfStats.totalClicks).toBe(2);
    });
  });

  describe('Tag Color Management', () => {
    it('should validate color format', async () => {
      const invalidColorData = {
        name: 'Invalid Color Tag',
        color: 'not-a-color',
      };

      await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(invalidColorData)
        .expect(400);
    });

    it('should support predefined color palette', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/tags/colors')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.palette).toBeInstanceOf(Array);
      expect(response.body.palette.length).toBeGreaterThan(0);
      expect(response.body.palette[0]).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should suggest colors based on usage', async () => {
      // Create tags with different colors
      const colors = ['#ef4444', '#10b981', '#3b82f6', '#f59e0b'];
      
      for (let i = 0; i < colors.length; i++) {
        await request(app.getHttpServer())
          .post('/api/tags')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            name: `Color Tag ${i}`,
            color: colors[i],
          });
      }

      const response = await request(app.getHttpServer())
        .get('/api/tags/colors/suggestions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.suggested).toBeInstanceOf(Array);
      expect(response.body.used).toBeInstanceOf(Array);
      expect(response.body.used).toEqual(expect.arrayContaining(colors));
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent tag operations', async () => {
      const nonExistentId = '123e4567-e89b-12d3-a456-426614174000';

      await request(app.getHttpServer())
        .get(`/api/tags/${nonExistentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/api/tags/${nonExistentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Updated Name' })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/tags/${nonExistentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('should prevent unauthorized tag access', async () => {
      // Create tag for first user
      const tagResponse = await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Private Tag', color: '#6366f1' })
        .expect(201);

      const tagId = tagResponse.body.id;

      // Create second user
      const secondUserData = TestDataFactory.createUser({
        email: 'unauthorized@example.com',
        username: 'unauthorized',
      });

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(secondUserData);

      const secondLoginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: secondUserData.email,
          password: secondUserData.password,
        });

      const unauthorizedToken = secondLoginResponse.body.accessToken;

      // Try to access first user's tag
      await request(app.getHttpServer())
        .get(`/api/tags/${tagId}`)
        .set('Authorization', `Bearer ${unauthorizedToken}`)
        .expect(404); // Should not reveal existence

      await request(app.getHttpServer())
        .patch(`/api/tags/${tagId}`)
        .set('Authorization', `Bearer ${unauthorizedToken}`)
        .send({ name: 'Hacked Name' })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/tags/${tagId}`)
        .set('Authorization', `Bearer ${unauthorizedToken}`)
        .expect(404);
    });
  });
});