/**
 * Bio Pages End-to-End Tests
 * Tests complete bio page management workflows
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';

describe('Bio Pages (e2e)', () => {
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

  describe('Bio Page Creation', () => {
    it('should create a bio page successfully', async () => {
      const bioPageData = {
        username: 'testbio',
        title: 'Test Bio Page',
        bio: 'This is my test bio page',
        theme: 'default',
        backgroundColor: '#ffffff',
        textColor: '#000000',
        buttonStyle: 'rounded',
        isPublic: true,
      };

      const response = await request(app.getHttpServer())
        .post('/api/bio-pages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(bioPageData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.username).toBe(bioPageData.username);
      expect(response.body.title).toBe(bioPageData.title);
      expect(response.body.bio).toBe(bioPageData.bio);
      expect(response.body.theme).toBe(bioPageData.theme);
      expect(response.body.backgroundColor).toBe(bioPageData.backgroundColor);
      expect(response.body.textColor).toBe(bioPageData.textColor);
      expect(response.body.buttonStyle).toBe(bioPageData.buttonStyle);
      expect(response.body.isPublic).toBe(bioPageData.isPublic);
    });

    it('should reject duplicate username', async () => {
      const bioPageData = {
        username: 'duplicate',
        title: 'First Bio Page',
        bio: 'First bio',
      };

      // Create first bio page
      await request(app.getHttpServer())
        .post('/api/bio-pages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(bioPageData)
        .expect(201);

      // Create second user
      const secondUserData = TestDataFactory.createUser({
        email: 'user2@example.com',
        username: 'testuser2'
      });

      const secondUser = await userRepository.save(secondUserData);
      const secondAccessToken = jwtService.sign({ 
        sub: secondUser.id, 
        email: secondUser.email 
      });

      // Try to create bio page with same username
      await request(app.getHttpServer())
        .post('/api/bio-pages')
        .set('Authorization', `Bearer ${secondAccessToken}`)
        .send(bioPageData)
        .expect(409); // Conflict
    });
  });
});
      