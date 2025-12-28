import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TagsService } from './tags.service';
import { TagRepository } from '../repositories/tag.repository';
import { CreateTagDto } from '../dto/create-tag.dto';
import { UpdateTagDto } from '../dto/update-tag.dto';

describe('TagsService', () => {
  let service: TagsService;
  let tagRepository: jest.Mocked<TagRepository>;

  const mockTag = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    userId: 'user-123',
    name: 'Marketing',
    color: '#6366f1',
    createdAt: new Date('2023-12-01T10:00:00.000Z'),
    user: null,
    linkTags: [],
  };

  beforeEach(async () => {
    const mockTagRepository = {
      create: jest.fn(),
      findByUserIdAndName: jest.fn(),
      findByUserIdAndId: jest.fn(),
      findAllByUserId: jest.fn(),
      findAllByUserIdWithLinkCount: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findTagsForLink: jest.fn(),
      checkNameUniquenessForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagsService,
        {
          provide: TagRepository,
          useValue: mockTagRepository,
        },
      ],
    }).compile();

    service = module.get<TagsService>(TagsService);
    tagRepository = module.get(TagRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTag', () => {
    it('should create a tag successfully', async () => {
      const createTagDto: CreateTagDto = {
        name: 'Marketing',
        color: '#6366f1',
      };

      tagRepository.checkNameUniquenessForUser.mockResolvedValue(true);
      tagRepository.create.mockResolvedValue(mockTag);

      const result = await service.createTag('user-123', createTagDto);

      expect(result).toEqual({
        id: mockTag.id,
        name: mockTag.name,
        color: mockTag.color,
        createdAt: mockTag.createdAt,
      });
      expect(tagRepository.checkNameUniquenessForUser).toHaveBeenCalledWith('user-123', 'Marketing');
      expect(tagRepository.create).toHaveBeenCalledWith('user-123', createTagDto);
    });

    it('should throw ConflictException when tag name already exists', async () => {
      const createTagDto: CreateTagDto = {
        name: 'Marketing',
        color: '#6366f1',
      };

      tagRepository.checkNameUniquenessForUser.mockResolvedValue(false);

      await expect(service.createTag('user-123', createTagDto)).rejects.toThrow(ConflictException);
      expect(tagRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('getUserTags', () => {
    it('should return user tags without link count', async () => {
      tagRepository.findAllByUserId.mockResolvedValue([mockTag]);

      const result = await service.getUserTags('user-123', false);

      expect(result).toEqual([{
        id: mockTag.id,
        name: mockTag.name,
        color: mockTag.color,
        createdAt: mockTag.createdAt,
      }]);
      expect(tagRepository.findAllByUserId).toHaveBeenCalledWith('user-123');
    });

    it('should return user tags with link count', async () => {
      const tagWithCount = {
        id: mockTag.id,
        name: mockTag.name,
        color: mockTag.color,
        createdAt: mockTag.createdAt,
        linkCount: 5,
      };

      tagRepository.findAllByUserIdWithLinkCount.mockResolvedValue([tagWithCount]);

      const result = await service.getUserTags('user-123', true);

      expect(result).toEqual([tagWithCount]);
      expect(tagRepository.findAllByUserIdWithLinkCount).toHaveBeenCalledWith('user-123');
    });
  });

  describe('getTagById', () => {
    it('should return tag by id', async () => {
      tagRepository.findByUserIdAndId.mockResolvedValue(mockTag);

      const result = await service.getTagById('user-123', mockTag.id);

      expect(result).toEqual({
        id: mockTag.id,
        name: mockTag.name,
        color: mockTag.color,
        createdAt: mockTag.createdAt,
      });
    });

    it('should throw NotFoundException when tag not found', async () => {
      tagRepository.findByUserIdAndId.mockResolvedValue(null);

      await expect(service.getTagById('user-123', 'non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTag', () => {
    it('should update tag successfully', async () => {
      const updateTagDto: UpdateTagDto = {
        name: 'Updated Marketing',
        color: '#ff0000',
      };

      const updatedTag = { ...mockTag, ...updateTagDto };

      tagRepository.findByUserIdAndId.mockResolvedValue(mockTag);
      tagRepository.checkNameUniquenessForUser.mockResolvedValue(true);
      tagRepository.update.mockResolvedValue(updatedTag);

      const result = await service.updateTag('user-123', mockTag.id, updateTagDto);

      expect(result).toEqual({
        id: updatedTag.id,
        name: updatedTag.name,
        color: updatedTag.color,
        createdAt: updatedTag.createdAt,
      });
    });

    it('should throw NotFoundException when tag not found', async () => {
      const updateTagDto: UpdateTagDto = { name: 'Updated' };

      tagRepository.findByUserIdAndId.mockResolvedValue(null);

      await expect(service.updateTag('user-123', 'non-existent', updateTagDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteTag', () => {
    it('should delete tag successfully', async () => {
      tagRepository.findByUserIdAndId.mockResolvedValue(mockTag);
      tagRepository.delete.mockResolvedValue(true);

      await expect(service.deleteTag('user-123', mockTag.id)).resolves.not.toThrow();
    });

    it('should throw NotFoundException when tag not found', async () => {
      tagRepository.findByUserIdAndId.mockResolvedValue(null);

      await expect(service.deleteTag('user-123', 'non-existent')).rejects.toThrow(NotFoundException);
    });
  });
});