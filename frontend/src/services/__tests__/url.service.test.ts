/**
 * URL Service Tests
 * Tests for URL management functionality
 */

import { URLService } from '../url.service';
import { apiClient } from '../api/client';
import { CreateUrlRequest, URL, TagDto } from '../api/dto';
import { URLListParams } from '../api/types';

// Mock the API client
jest.mock('../api/client');
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('URLService', () => {
  let urlService: URLService;

  beforeEach(() => {
    urlService = new URLService();
    jest.clearAllMocks();
  });

  describe('createURL', () => {
    it('should successfully create a URL', async () => {
      const mockCreateRequest: CreateUrlRequest = {
        originalUrl: 'https://example.com',
        customBackHalf: 'test-url',
        category: 'test'
      };

      const mockURL: URL = {
        id: '1',
        shortCode: 'abc123',
        originalUrl: 'https://example.com',
        customBackHalf: 'test-url',
        category: 'test',
        tags: [],
        visitCount: 0,
        isActive: true,
        userId: 'user123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z'
      };

      mockApiClient.post.mockResolvedValue({
        success: true,
        data: mockURL
      });

      const result = await urlService.createURL(mockCreateRequest);

      expect(mockApiClient.post).toHaveBeenCalledWith('/urls', mockCreateRequest);
      expect(result).toEqual(mockURL);
    });

    it('should handle creation failure', async () => {
      const mockCreateRequest: CreateUrlRequest = {
        originalUrl: 'https://example.com'
      };

      mockApiClient.post.mockResolvedValue({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid URL',
          statusCode: 400
        }
      });

      const result = await urlService.createURL(mockCreateRequest);

      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      const mockCreateRequest: CreateUrlRequest = {
        originalUrl: 'https://example.com'
      };

      mockApiClient.post.mockRejectedValue(new Error('Network error'));

      const result = await urlService.createURL(mockCreateRequest);

      expect(result).toBeNull();
    });
  });

  describe('getURLs', () => {
    it('should successfully fetch URLs with default parameters', async () => {
      const mockResponse = {
        data: [
          {
            id: '1',
            shortCode: 'abc123',
            originalUrl: 'https://example.com',
            tags: [],
            visitCount: 5,
            isActive: true,
            userId: 'user123',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z'
          }
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 10,
          pages: 1,
          hasNext: false,
          hasPrev: false
        }
      };

      mockApiClient.get.mockResolvedValue({
        success: true,
        data: mockResponse
      });

      const result = await urlService.getURLs();

      expect(mockApiClient.get).toHaveBeenCalledWith('/urls');
      expect(result).toEqual(mockResponse);
    });

    it('should build query parameters correctly', async () => {
      const params: URLListParams = {
        page: 2,
        limit: 20,
        search: 'test',
        isActive: true,
        tags: ['tag1', 'tag2'],
        tagOperator: 'AND'
      };

      mockApiClient.get.mockResolvedValue({
        success: true,
        data: { data: [], pagination: { total: 0, page: 1, limit: 10, pages: 0, hasNext: false, hasPrev: false } }
      });

      await urlService.getURLs(params);

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/urls?page=2&limit=20&search=test&isActive=true&tags=tag1&tags=tag2&tagOperator=AND'
      );
    });
  });

  describe('getURL', () => {
    it('should successfully fetch a single URL', async () => {
      const mockURL: URL = {
        id: '1',
        shortCode: 'abc123',
        originalUrl: 'https://example.com',
        tags: [],
        visitCount: 5,
        isActive: true,
        userId: 'user123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z'
      };

      mockApiClient.get.mockResolvedValue({
        success: true,
        data: mockURL
      });

      const result = await urlService.getURL('1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/urls/1');
      expect(result).toEqual(mockURL);
    });

    it('should handle URL not found', async () => {
      mockApiClient.get.mockResolvedValue({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'URL not found',
          statusCode: 404
        }
      });

      const result = await urlService.getURL('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateURL', () => {
    it('should successfully update a URL', async () => {
      const updateData = {
        customBackHalf: 'updated-url',
        category: 'updated-category'
      };

      const mockUpdatedURL: URL = {
        id: '1',
        shortCode: 'abc123',
        originalUrl: 'https://example.com',
        customBackHalf: 'updated-url',
        category: 'updated-category',
        tags: [],
        visitCount: 5,
        isActive: true,
        userId: 'user123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z'
      };

      mockApiClient.patch.mockResolvedValue({
        success: true,
        data: mockUpdatedURL
      });

      const result = await urlService.updateURL('1', updateData);

      expect(mockApiClient.patch).toHaveBeenCalledWith('/urls/1', updateData);
      expect(result).toEqual(mockUpdatedURL);
    });
  });

  describe('deleteURL', () => {
    it('should successfully delete a URL', async () => {
      mockApiClient.delete.mockResolvedValue({
        success: true
      });

      const result = await urlService.deleteURL('1');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/urls/1');
      expect(result).toBe(true);
    });

    it('should handle deletion failure', async () => {
      mockApiClient.delete.mockResolvedValue({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'URL not found',
          statusCode: 404
        }
      });

      const result = await urlService.deleteURL('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('searchURLs', () => {
    it('should search URLs with query and filters', async () => {
      const mockResponse = {
        data: [],
        pagination: { total: 0, page: 1, limit: 10, pages: 0, hasNext: false, hasPrev: false }
      };

      mockApiClient.get.mockResolvedValue({
        success: true,
        data: mockResponse
      });

      await urlService.searchURLs('test query', { isActive: true });

      expect(mockApiClient.get).toHaveBeenCalledWith('/urls?search=test+query&isActive=true');
    });
  });

  describe('checkAliasAvailability', () => {
    it('should check if alias is available', async () => {
      mockApiClient.get.mockResolvedValue({
        success: true,
        data: { available: true }
      });

      const result = await urlService.checkAliasAvailability('my-alias');

      expect(mockApiClient.get).toHaveBeenCalledWith('/urls/check-alias/my-alias');
      expect(result).toBe(true);
    });

    it('should handle special characters in alias', async () => {
      mockApiClient.get.mockResolvedValue({
        success: true,
        data: { available: false }
      });

      const result = await urlService.checkAliasAvailability('my alias with spaces');

      expect(mockApiClient.get).toHaveBeenCalledWith('/urls/check-alias/my%20alias%20with%20spaces');
      expect(result).toBe(false);
    });
  });
});
