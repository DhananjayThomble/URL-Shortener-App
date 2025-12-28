import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';

import { UrlsService } from './urls.service';
import { Url, UrlDocument } from './schemas/url.schema';
import { ClickAnalytics, ClickAnalyticsDocument } from './schemas/click-analytics.schema';
import { UrlStats, UrlStatsDocument } from './schemas/url-stats.schema';
import { CacheService } from '../../common/services/cache.service';
import { AuditLogService } from '../users/services/audit-log.service';
import { CreateUrlDto } from './dto/create-url.dto';

describe('UrlsService', () => {
  let service: UrlsService;
  let urlModel: jest.Mocked<Model<UrlDocument>>;
  let clickAnalyticsModel: jest.Mocked<Model<ClickAnalyticsDocument>>;
  let urlStatsModel: jest.Mocked<Model<UrlStatsDocument>>;
  let cacheService: jest.Mocked<CacheService>;
  let auditLogService: jest.Mocked<AuditLogService>;

  const mockUrl = {
    _id: 'mockUrlId',
    userId: 'mockUserId',
    shortCode: 'abc123',
    originalUrl: 'https://example.com',
    visitCount: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    save: jest.fn(),
  };

  const mockCreateUrlDto: CreateUrlDto = {
    originalUrl: 'https://example.com',
    category: 'test',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlsService,
        {
          provide: getModelToken(Url.name),
          useValue: {
            create: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            countDocuments: jest.fn(),
            updateOne: jest.fn(),
            deleteOne: jest.fn(),
            deleteMany: jest.fn(),
            aggregate: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getModelToken(ClickAnalytics.name),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            aggregate: jest.fn(),
          },
        },
        {
          provide: getModelToken(UrlStats.name),
          useValue: {
            updateOne: jest.fn(),
          },
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            generateUrlCacheKey: jest.fn(),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            logUrlCreated: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UrlsService>(UrlsService);
    urlModel = module.get(getModelToken(Url.name));
    clickAnalyticsModel = module.get(getModelToken(ClickAnalytics.name));
    urlStatsModel = module.get(getModelToken(UrlStats.name));
    cacheService = module.get(CacheService);
    auditLogService = module.get(AuditLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new URL successfully', async () => {
      const mockSavedUrl = { ...mockUrl, save: jest.fn().mockResolvedValue(mockUrl) };
      
      urlModel.findOne.mockResolvedValue(null); // No existing URL
      urlModel.create = jest.fn().mockReturnValue(mockSavedUrl);
      cacheService.set.mockResolvedValue();
      cacheService.generateUrlCacheKey.mockReturnValue('url:abc123');
      auditLogService.logUrlCreated.mockResolvedValue();

      const result = await service.create(mockCreateUrlDto, 'mockUserId');

      expect(urlModel.create).toHaveBeenCalled();
      expect(cacheService.set).toHaveBeenCalledWith('url:abc123', mockUrl.originalUrl, 3600);
      expect(auditLogService.logUrlCreated).toHaveBeenCalled();
      expect(result).toEqual(mockUrl);
    });

    it('should throw BadRequestException for invalid URL', async () => {
      const invalidUrlDto = { ...mockCreateUrlDto, originalUrl: 'invalid-url' };

      await expect(service.create(invalidUrlDto, 'mockUserId')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for existing custom back-half', async () => {
      const customUrlDto = { ...mockCreateUrlDto, customBackHalf: 'existing' };
      
      urlModel.findOne.mockResolvedValue(mockUrl as any);

      await expect(service.create(customUrlDto, 'mockUserId')).rejects.toThrow(BadRequestException);
    });

    it('should validate custom back-half format', async () => {
      const invalidCustomUrlDto = { ...mockCreateUrlDto, customBackHalf: 'a' }; // Too short
      
      await expect(service.create(invalidCustomUrlDto, 'mockUserId')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findByShortCode', () => {
    it('should return cached URL if available', async () => {
      const cachedUrl = 'https://cached-example.com';
      
      cacheService.get.mockResolvedValue(cachedUrl);
      cacheService.generateUrlCacheKey.mockReturnValue('url:abc123');

      const result = await service.findByShortCode('abc123');

      expect(result).toBe(cachedUrl);
      expect(cacheService.get).toHaveBeenCalledWith('url:abc123');
      expect(urlModel.findOne).not.toHaveBeenCalled();
    });

    it('should fetch from database and cache if not in cache', async () => {
      cacheService.get.mockResolvedValue(null);
      cacheService.generateUrlCacheKey.mockReturnValue('url:abc123');
      urlModel.findOne.mockResolvedValue(mockUrl as any);
      cacheService.set.mockResolvedValue();

      const result = await service.findByShortCode('abc123');

      expect(result).toBe(mockUrl.originalUrl);
      expect(urlModel.findOne).toHaveBeenCalledWith({
        shortCode: 'abc123',
        isActive: true,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: expect.any(Date) } }
        ]
      });
      expect(cacheService.set).toHaveBeenCalledWith('url:abc123', mockUrl.originalUrl, 3600);
    });

    it('should throw NotFoundException for non-existent URL', async () => {
      cacheService.get.mockResolvedValue(null);
      cacheService.generateUrlCacheKey.mockReturnValue('url:notfound');
      urlModel.findOne.mockResolvedValue(null);

      await expect(service.findByShortCode('notfound')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated URLs for user', async () => {
      const mockUrls = [mockUrl];
      const mockTotal = 1;

      urlModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(mockUrls),
            }),
          }),
        }),
      } as any);

      urlModel.countDocuments.mockResolvedValue(mockTotal);

      const result = await service.findAll('mockUserId', 1, 10);

      expect(result).toEqual({ urls: mockUrls, total: mockTotal });
      expect(urlModel.find).toHaveBeenCalledWith({ userId: 'mockUserId' });
    });
  });

  describe('findOne', () => {
    it('should return URL for valid user and ID', async () => {
      urlModel.findOne.mockResolvedValue(mockUrl as any);

      const result = await service.findOne('mockUrlId', 'mockUserId');

      expect(result).toEqual(mockUrl);
      expect(urlModel.findOne).toHaveBeenCalledWith({ _id: 'mockUrlId', userId: 'mockUserId' });
    });

    it('should throw NotFoundException for non-existent URL', async () => {
      urlModel.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent', 'mockUserId')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update URL successfully', async () => {
      const updateDto = { category: 'updated' };
      const updatedUrl = { ...mockUrl, ...updateDto, save: jest.fn().mockResolvedValue({ ...mockUrl, ...updateDto }) };
      
      jest.spyOn(service, 'findOne').mockResolvedValue(updatedUrl as any);

      const result = await service.update('mockUrlId', updateDto, 'mockUserId');

      expect(service.findOne).toHaveBeenCalledWith('mockUrlId', 'mockUserId');
      expect(updatedUrl.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should remove URL and clear cache', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockUrl as any);
      cacheService.generateUrlCacheKey.mockReturnValue('url:abc123');
      cacheService.del.mockResolvedValue();
      urlModel.deleteOne.mockResolvedValue({ deletedCount: 1 } as any);

      await service.remove('mockUrlId', 'mockUserId');

      expect(service.findOne).toHaveBeenCalledWith('mockUrlId', 'mockUserId');
      expect(cacheService.del).toHaveBeenCalledWith('url:abc123');
      expect(urlModel.deleteOne).toHaveBeenCalledWith({ _id: 'mockUrlId', userId: 'mockUserId' });
    });
  });

  describe('trackClick', () => {
    it('should track click and update statistics', async () => {
      const clickData = {
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        referer: 'https://google.com',
      };

      const mockClickAnalytics = {
        save: jest.fn().mockResolvedValue({}),
      };

      urlModel.findOne.mockResolvedValue(mockUrl as any);
      clickAnalyticsModel.create = jest.fn().mockReturnValue(mockClickAnalytics);
      urlModel.updateOne.mockResolvedValue({} as any);
      urlStatsModel.updateOne.mockResolvedValue({} as any);

      await service.trackClick('abc123', clickData);

      expect(urlModel.findOne).toHaveBeenCalledWith({ shortCode: 'abc123' });
      expect(clickAnalyticsModel.create).toHaveBeenCalled();
      expect(mockClickAnalytics.save).toHaveBeenCalled();
      expect(urlModel.updateOne).toHaveBeenCalledWith(
        { shortCode: 'abc123' },
        { $inc: { visitCount: 1 } }
      );
    });
  });

  describe('getUrlAnalytics', () => {
    it('should return analytics data for URL', async () => {
      const mockAnalyticsData = [
        { date: '2024-01-01', clicks: 10, uniqueClicks: 8 },
      ];

      const mockGeoData = [
        { _id: 'US', count: 5 },
      ];

      const mockDeviceData = [
        { _id: 'Desktop', count: 7 },
      ];

      jest.spyOn(service, 'findOne').mockResolvedValue(mockUrl as any);
      
      clickAnalyticsModel.aggregate
        .mockResolvedValueOnce(mockAnalyticsData)
        .mockResolvedValueOnce(mockGeoData)
        .mockResolvedValueOnce(mockDeviceData);

      const result = await service.getUrlAnalytics('mockUrlId', 'mockUserId', '7d');

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('analytics');
      expect(result.analytics.clicksByDate).toEqual(mockAnalyticsData);
      expect(result.analytics.geoDistribution).toEqual(mockGeoData);
      expect(result.analytics.deviceDistribution).toEqual(mockDeviceData);
    });
  });

  describe('bulkCreate', () => {
    it('should create multiple URLs and handle errors gracefully', async () => {
      const urls = [
        { originalUrl: 'https://example1.com' },
        { originalUrl: 'https://example2.com' },
        { originalUrl: 'invalid-url' }, // This should fail
      ];

      jest.spyOn(service, 'create')
        .mockResolvedValueOnce(mockUrl as any)
        .mockResolvedValueOnce({ ...mockUrl, shortCode: 'def456' } as any)
        .mockRejectedValueOnce(new BadRequestException('Invalid URL'));

      const result = await service.bulkCreate(urls as CreateUrlDto[], 'mockUserId');

      expect(result).toHaveLength(2); // Only successful creations
      expect(service.create).toHaveBeenCalledTimes(3);
    });
  });

  describe('cleanupExpiredUrls', () => {
    it('should delete expired URLs', async () => {
      urlModel.deleteMany.mockResolvedValue({ deletedCount: 5 } as any);

      const result = await service.cleanupExpiredUrls();

      expect(result).toBe(5);
      expect(urlModel.deleteMany).toHaveBeenCalledWith({
        expiresAt: { $lt: expect.any(Date) },
      });
    });
  });

  describe('validateUrlPassword', () => {
    it('should return true for URL without password protection', async () => {
      const urlWithoutPassword = { ...mockUrl, protection: undefined };
      urlModel.findOne.mockResolvedValue(urlWithoutPassword as any);

      const result = await service.validateUrlPassword('abc123', 'anypassword');

      expect(result).toBe(true);
    });

    it('should validate password correctly for protected URL', async () => {
      const hashedPassword = '$2b$10$hashedpassword';
      const urlWithPassword = { 
        ...mockUrl, 
        protection: { password: hashedPassword } 
      };
      
      urlModel.findOne.mockResolvedValue(urlWithPassword as any);
      
      // Mock bcrypt.compare
      const bcrypt = require('bcrypt');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      const result = await service.validateUrlPassword('abc123', 'correctpassword');

      expect(result).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith('correctpassword', hashedPassword);
    });
  });
});