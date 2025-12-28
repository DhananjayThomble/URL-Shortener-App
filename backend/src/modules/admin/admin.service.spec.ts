import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getModelToken } from '@nestjs/mongoose';
import { Repository } from 'typeorm';
import { Model } from 'mongoose';

import { AdminService } from './admin.service';
import { AdminUser, AdminPermission } from '../users/entities/admin-user.entity';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from '../users/services/audit-log.service';
import { CacheService } from '../../common/services/cache.service';

describe('AdminService', () => {
  let service: AdminService;
  let module: TestingModule;
  let adminRepository: jest.Mocked<Repository<AdminUser>>;
  let userRepository: jest.Mocked<Repository<User>>;
  let auditLogService: jest.Mocked<AuditLogService>;
  let cacheService: jest.Mocked<CacheService>;

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      count: jest.fn(),
      query: jest.fn(),
    };

    const mockModel = {
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
      findOne: jest.fn(),
    };

    const mockAuditLogService = {
      create: jest.fn(),
    };

    const mockCacheService = {
      invalidateUserCache: jest.fn(),
      getStats: jest.fn(),
      healthCheck: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: getRepositoryToken(AdminUser),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
        {
          provide: getModelToken('Url'),
          useValue: mockModel,
        },
        {
          provide: getModelToken('ClickAnalytics'),
          useValue: mockModel,
        },
        {
          provide: AuditLogService,
          useValue: mockAuditLogService,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    adminRepository = module.get(getRepositoryToken(AdminUser));
    userRepository = module.get(getRepositoryToken(User));
    auditLogService = module.get(AuditLogService);
    cacheService = module.get(CacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createAdmin', () => {
    it('should create a new admin', async () => {
      const createAdminDto = {
        email: 'admin@test.com',
        password: 'password123',
        name: 'Test Admin',
        permissions: [AdminPermission.USER_MANAGEMENT],
      };

      const mockAdmin = {
        id: '1',
        email: createAdminDto.email,
        name: createAdminDto.name,
        permissions: createAdminDto.permissions,
        createdAt: new Date(),
      };

      adminRepository.findOne.mockResolvedValue(null);
      adminRepository.create.mockReturnValue(mockAdmin as any);
      adminRepository.save.mockResolvedValue(mockAdmin as any);
      auditLogService.create.mockResolvedValue({} as any);

      const result = await service.createAdmin(createAdminDto, 'creator-id');

      expect(adminRepository.findOne).toHaveBeenCalledWith({
        where: { email: createAdminDto.email },
      });
      expect(adminRepository.create).toHaveBeenCalled();
      expect(adminRepository.save).toHaveBeenCalled();
      expect(auditLogService.create).toHaveBeenCalled();
      expect(result).toEqual(mockAdmin);
    });

    it('should throw error if admin already exists', async () => {
      const createAdminDto = {
        email: 'admin@test.com',
        password: 'password123',
        name: 'Test Admin',
        permissions: [AdminPermission.USER_MANAGEMENT],
      };

      adminRepository.findOne.mockResolvedValue({} as any);

      await expect(service.createAdmin(createAdminDto, 'creator-id')).rejects.toThrow(
        'Admin with this email already exists',
      );
    });
  });

  describe('hasPermission', () => {
    it('should return true if admin has permission', async () => {
      const mockAdmin = {
        id: '1',
        permissions: [AdminPermission.USER_MANAGEMENT, AdminPermission.ANALYTICS_VIEW],
      };

      adminRepository.findOne.mockResolvedValue(mockAdmin as any);

      const result = await service.hasPermission('1', AdminPermission.USER_MANAGEMENT);

      expect(result).toBe(true);
    });

    it('should return false if admin does not have permission', async () => {
      const mockAdmin = {
        id: '1',
        permissions: [AdminPermission.ANALYTICS_VIEW],
      };

      adminRepository.findOne.mockResolvedValue(mockAdmin as any);

      const result = await service.hasPermission('1', AdminPermission.USER_MANAGEMENT);

      expect(result).toBe(false);
    });
  });

  describe('getDashboardStats', () => {
    it('should return dashboard statistics', async () => {
      // Mock repository counts
      userRepository.count
        .mockResolvedValueOnce(100) // total users
        .mockResolvedValueOnce(80)  // active users
        .mockResolvedValueOnce(10)  // new users this month
        .mockResolvedValueOnce(80); // verified users

      // Mock URL model counts
      const mockUrlModel = module.get(getModelToken('Url'));
      mockUrlModel.countDocuments
        .mockResolvedValueOnce(500) // total URLs
        .mockResolvedValueOnce(450) // active URLs
        .mockResolvedValueOnce(50); // new URLs this month

      // Mock analytics model
      const mockAnalyticsModel = module.get(getModelToken('ClickAnalytics'));
      mockAnalyticsModel.countDocuments
        .mockResolvedValueOnce(1000) // total clicks
        .mockResolvedValueOnce(50)   // clicks today
        .mockResolvedValueOnce(200); // clicks this week

      mockAnalyticsModel.aggregate
        .mockResolvedValueOnce([{ country: 'US', count: 100 }]) // top countries
        .mockResolvedValueOnce([{ device: 'Desktop', count: 150 }]); // top devices

      cacheService.getStats.mockResolvedValue({
        hits: 800,
        misses: 200,
        memory: '10MB',
        keys: 1000,
      });

      const result = await service.getDashboardStats();

      expect(result).toHaveProperty('users');
      expect(result).toHaveProperty('urls');
      expect(result).toHaveProperty('system');
      expect(result).toHaveProperty('analytics');
      expect(result.users.total).toBe(100);
      expect(result.urls.total).toBe(500);
      expect(result.system.cacheHitRate).toBe(80); // 800/(800+200) * 100
    });
  });
});