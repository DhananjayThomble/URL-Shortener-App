import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClickEventService } from './click-event.service';
import { ClickEvent, ClickEventDocument } from '../schemas/click-event.schema';
import { CreateClickEventDto } from '../dto/create-click-event.dto';

describe('ClickEventService', () => {
  let service: ClickEventService;
  let model: Model<ClickEventDocument>;

  const mockClickEvent = {
    linkId: '123e4567-e89b-12d3-a456-426614174000',
    userId: '123e4567-e89b-12d3-a456-426614174001',
    clickedAt: new Date(),
    ipHash: 'hashed-ip',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    browser: 'Chrome',
    device: 'desktop',
    os: 'Windows',
    country: 'United States',
    city: 'New York',
    isBot: false,
    sessionId: 'sess_123456789',
    save: jest.fn().mockResolvedValue({
      toObject: () => mockClickEvent,
    }),
  };

  const mockModel = {
    new: jest.fn(),
    constructor: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    distinct: jest.fn(),
    aggregate: jest.fn(),
    deleteMany: jest.fn(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };

  // Mock the model constructor
  const MockModel: any = jest.fn().mockImplementation((data) => ({
    ...data,
    save: jest.fn().mockResolvedValue({
      toObject: () => ({ ...data, ...mockClickEvent }),
    }),
  }));

  // Add static methods to the mock constructor
  MockModel.countDocuments = jest.fn();
  MockModel.distinct = jest.fn();
  MockModel.aggregate = jest.fn();
  MockModel.deleteMany = jest.fn();
  MockModel.find = jest.fn();
  MockModel.findOne = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClickEventService,
        {
          provide: getModelToken(ClickEvent.name),
          useValue: MockModel,
        },
      ],
    }).compile();

    service = module.get<ClickEventService>(ClickEventService);
    model = module.get<Model<ClickEventDocument>>(getModelToken(ClickEvent.name));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createClickEvent', () => {
    it('should create a click event successfully', async () => {
      const createClickEventDto: CreateClickEventDto = {
        linkId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '123e4567-e89b-12d3-a456-426614174001',
        clickedAt: new Date(),
        ipHash: 'hashed-ip',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        browser: 'Chrome',
        device: 'desktop',
        os: 'Windows',
        country: 'United States',
        city: 'New York',
        isBot: false,
        sessionId: 'sess_123456789',
      };

      const result = await service.createClickEvent(createClickEventDto);

      expect(result).toEqual(expect.objectContaining({
        linkId: createClickEventDto.linkId,
        userId: createClickEventDto.userId,
        ipHash: createClickEventDto.ipHash,
      }));
      expect(MockModel).toHaveBeenCalledWith(expect.objectContaining(createClickEventDto));
    });
  });

  describe('getClickCountByLink', () => {
    it('should return click count for a link', async () => {
      const linkId = '123e4567-e89b-12d3-a456-426614174000';
      const expectedCount = 5;

      MockModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(expectedCount),
      });

      const result = await service.getClickCountByLink(linkId);

      expect(result).toBe(expectedCount);
      expect(MockModel.countDocuments).toHaveBeenCalledWith({ linkId });
    });
  });

  describe('getUniqueClickCountByLink', () => {
    it('should return unique click count for a link', async () => {
      const linkId = '123e4567-e89b-12d3-a456-426614174000';
      const uniqueIps = ['ip1', 'ip2', 'ip3'];

      MockModel.distinct.mockReturnValue({
        exec: jest.fn().mockResolvedValue(uniqueIps),
      });

      const result = await service.getUniqueClickCountByLink(linkId);

      expect(result).toBe(uniqueIps.length);
      expect(MockModel.distinct).toHaveBeenCalledWith('ipHash', { linkId });
    });
  });

  describe('getClickEventsByCountry', () => {
    it('should return click events grouped by country', async () => {
      const linkId = '123e4567-e89b-12d3-a456-426614174000';
      const expectedResults = [
        { country: 'United States', count: 10 },
        { country: 'Canada', count: 5 },
      ];

      MockModel.aggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(expectedResults),
      });

      const result = await service.getClickEventsByCountry(linkId);

      expect(result).toEqual(expectedResults);
      expect(MockModel.aggregate).toHaveBeenCalled();
    });
  });
});